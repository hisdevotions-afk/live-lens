import { summarize, delta, changedEnough, splitQuestion, calc, detectLocale } from './stats.js';
import { analyze } from './llm.js';

const LLM_WINDOW_MS = 15000; // pin: no máximo 1 análise do LLM a cada 15s
const HISTORY_MAX = 50;      // pontos da sparkline
const DEFAULT_MODEL = 'qwen2.5:3b';

const $ = (id) => document.getElementById(id);
const fmt = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const time = (ts) => new Date(ts).toLocaleTimeString('pt-BR');

const state = {
  current: null,      // último snapshot recebido
  summary: null,      // summarize(current)
  history: [],        // valores primary do elemento fixado
  pinSnap: null,      // último snapshot do elemento fixado (dados para responder perguntas)
  pinSummary: null,
  answer: null,       // modo pergunta: { question, calc, data, dataSummary } (data = seleção que veio junto, ou null)
  pinLocale: null,    // locale do 1º snapshot do pin (não muda enquanto o pin durar)
  liveDelta: null,    // delta(anterior, atual) do elemento fixado
  lastLlmAt: 0,       // início da última análise (só para exibir)
  lastLlmEnd: 0,      // fim da última análise: a janela de 15s conta a partir daqui
  lastLlmPrimary: null,
  lastLlmText: '',
  controller: null,   // AbortController do LLM em andamento
  busy: false,        // há análise do LLM em andamento
  runKind: null,      // 'pin' (automática) | 'user' (seleção, pergunta, reanalisar)
  pendingTimer: null, // reavaliação quando a janela de 15s abrir
  paused: false,
  model: DEFAULT_MODEL,
};

const myWindowId = (await chrome.windows.getCurrent()).id;

// ---------- Modelo ----------

const saved = await chrome.storage.local.get('model');
if (saved.model) state.model = saved.model;
$('model').value = state.model;
$('model').addEventListener('change', () => {
  state.model = $('model').value.trim() || DEFAULT_MODEL;
  chrome.storage.local.set({ model: state.model });
});

// ---------- Comunicação com a aba ----------

async function sendToTab(msg) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    $('pin-status').textContent = 'Página não suportada (ou recarregue a aba)';
    return null;
  }
}

function resetLive() {
  state.history = [];
  state.pinSnap = null;
  state.pinSummary = null;
  state.pinLocale = null;
  state.liveDelta = null;
  if (state.answer) {
    state.summary = state.answer.dataSummary; // sem dados próprios, perdeu os do elemento fixado
    renderStats();
  }
  renderLive();
}

function renderPin(pinned, label) {
  $('pin-status').textContent = pinned ? `Fixado: ${label}` : 'Nada fixado';
  $('unpin').disabled = !pinned;
}

async function refreshPinState() {
  stopAuto();
  const r = await sendToTab({ type: 'get-state' });
  if (!r) return;
  renderPin(r.pinned, r.label);
  resetLive();
}

$('pick').addEventListener('click', async () => {
  const r = await sendToTab({ type: 'start-pick' });
  if (r) $('pin-status').textContent = 'Clique num elemento da página (Esc cancela)';
});
$('unpin').addEventListener('click', () => sendToTab({ type: 'unpin' }));

chrome.tabs.onActivated.addListener(({ windowId }) => {
  if (windowId === myWindowId) refreshPinState();
});

// Recarregar ou navegar destrói o content script (e o pin com ele); nenhum pin-state chega.
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (!tab.active || tab.windowId !== myWindowId) return;
  if (info.status === 'loading') {
    stopAuto();
    renderPin(false, '');
    resetLive();
  } else if (info.status === 'complete') {
    refreshPinState();
  }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab?.active || sender.tab.windowId !== myWindowId) return;
  if (msg.type === 'pin-state') {
    renderPin(msg.pinned, msg.label);
    if (msg.reason === 'picked') {
      resetLive();
      state.current = null; // pin novo retoma a tela (uma seleção deixa de ter prioridade)
      state.answer = null;
      renderCalc();
    }
    if (!msg.pinned) {
      stopAuto();
      resetLive();
    }
    if (msg.reason === 'removed') $('pin-status').textContent = 'Elemento sumiu da página. Desfixado.';
  }
  if (msg.type === 'snapshot') onSnapshot(msg);
});

// ---------- Snapshot → stats → LLM ----------

// dados: snapshot que veio junto com a pergunta (ou null: usa o elemento fixado, se houver, ou nada).
function newAnswer(question, data, lang = '') {
  return {
    question,
    calc: calc(question, state.pinLocale ?? detectLocale(question, lang)),
    data,
    dataSummary: data ? summarize(data) : null,
  };
}

// Pergunta digitada: usa como dados a seleção atual (ou os dados da pergunta anterior); senão, o elemento fixado; senão, nada.
function newTypedAnswer(question) {
  const cur = state.current;
  const data = state.answer ? state.answer.data : cur?.source === 'selection' ? cur : null;
  state.answer = newAnswer(question, data, cur?.lang);
  state.summary = data ? (state.answer.dataSummary) : state.pinSummary;
  renderCalc();
  renderOrigin();
  renderStats();
}

function onSnapshot(snap) {
  if (snap.source === 'selection') {
    state.current = snap;
    const sq = splitQuestion(snap.text);
    if (sq) {
      // Pergunta (com ou sem dados na mesma seleção): o cálculo sai na hora, em código.
      state.answer = newAnswer(sq.question, sq.rest ? { ...snap, text: sq.rest } : null, snap.lang);
      state.summary = state.answer.dataSummary ?? state.pinSummary;
    } else {
      state.answer = null;
      state.summary = summarize(snap);
    }
    renderCalc();
    renderOrigin();
    renderStats();
    if (!state.paused) runLlm('', 'user');
    return;
  }
  // Pin: sempre alimenta histórico e variação...
  const summary = summarize(snap, state.pinLocale ?? undefined);
  state.pinLocale ??= summary.locale;
  if (summary.primary !== null) {
    const prev = state.history.at(-1);
    state.liveDelta = prev === undefined ? null : delta(prev, summary.primary);
    state.history.push(summary.primary);
    if (state.history.length > HISTORY_MAX) state.history.shift();
  }
  renderLive();
  state.pinSnap = snap;
  state.pinSummary = summary;
  if (state.answer) {
    if (!state.answer.dataSummary) {
      state.summary = summary;
      renderStats();
    }
    return; // uma pergunta na tela não é re-respondida sozinha
  }
  // ...mas não tira da tela uma seleção que o usuário está lendo.
  if (state.current?.source === 'selection') return;
  state.current = snap;
  state.summary = summary;
  renderOrigin();
  renderStats();
  maybeRunLlmForPin();
}

// Cancela só o que é automático (pin); análise pedida pelo usuário segue.
function stopAuto() {
  clearTimeout(state.pendingTimer);
  if (state.busy && state.runKind === 'pin') {
    state.controller?.abort();
    setLlmStatus('cancelado');
  }
  if (state.current?.source === 'pin') state.current = null;
}

function maybeRunLlmForPin() {
  clearTimeout(state.pendingTimer);
  const snap = state.current;
  if (state.paused || !snap || snap.source !== 'pin') return;
  if (state.busy) return; // não interrompe análise em andamento; o finally de runLlm reavalia
  const primary = state.summary.primary;
  const changed = primary === null
    ? snap.text !== state.lastLlmText
    : changedEnough(state.lastLlmPrimary, primary);
  if (!changed) return;
  const wait = LLM_WINDOW_MS - (Date.now() - state.lastLlmEnd);
  if (wait > 0) {
    state.pendingTimer = setTimeout(maybeRunLlmForPin, wait);
    return;
  }
  runLlm('', 'pin');
}

async function runLlm(question = '', kind = 'user') {
  clearTimeout(state.pendingTimer);
  state.controller?.abort();
  if (question) newTypedAnswer(question); // pergunta digitada no painel
  const snap = state.current;
  const answer = state.answer;
  if (!snap && !answer) {
    setLlmStatus('Selecione algo na página ou digite uma pergunta.');
    return;
  }
  const controller = new AbortController();
  state.controller = controller;
  state.runKind = kind;
  state.busy = true;
  state.lastLlmAt = Date.now();
  if (kind === 'pin') {
    state.lastLlmPrimary = state.summary.primary;
    state.lastLlmText = snap.text;
  }
  $('analysis').textContent = '';
  setLlmStatus('analisando…');
  try {
    const chunks = answer
      ? analyze({ model: state.model, snapshot: answer.data ?? state.pinSnap, summary: answer.dataSummary ?? state.pinSummary, question: answer.question, answer: true, calc: answer.calc, signal: controller.signal })
      : analyze({ model: state.model, snapshot: snap, summary: state.summary, question, signal: controller.signal });
    for await (const chunk of chunks) $('analysis').textContent += chunk;
    setLlmStatus(`${answer ? 'resposta' : 'análise'} de ${time(state.lastLlmAt)}`);
  } catch (e) {
    if (e.name === 'AbortError') return; // cancelamento é normal
    setLlmStatus(errorText(e.message));
  } finally {
    if (state.controller === controller) {
      state.busy = false;
      state.lastLlmEnd = Date.now();
      maybeRunLlmForPin(); // mudanças que chegaram durante a análise
    }
  }
}

function errorText(code) {
  if (code === 'OLLAMA_OFFLINE') return 'Ollama não está rodando. Rode: ollama serve';
  if (code === 'OLLAMA_CORS') return 'Ollama bloqueou a extensão (CORS). Veja README → "Liberar CORS".';
  if (code === 'OLLAMA_NO_MODEL') return `Modelo não encontrado. Rode: ollama pull ${state.model}`;
  return `Erro do Ollama: ${code}`;
}

function setLlmStatus(text) {
  $('llm-status').textContent = text;
}

$('pause').addEventListener('click', () => {
  state.paused = !state.paused;
  $('pause').textContent = state.paused ? 'Retomar LLM' : 'Pausar LLM';
  if (state.paused) {
    clearTimeout(state.pendingTimer);
    state.controller?.abort();
    setLlmStatus('pausado');
  }
});
$('rerun').addEventListener('click', () => runLlm($('question').value.trim()));
$('question').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runLlm($('question').value.trim());
});

// ---------- Render (sempre textContent, nunca innerHTML) ----------

function renderOrigin() {
  const s = state.current;
  const a = state.answer;
  if (a) {
    const sobre = a.data ? 'sobre a seleção' : state.pinSnap ? 'sobre o elemento fixado' : 'pergunta geral';
    $('origin').textContent = `Pergunta · ${sobre} · ${time(s?.ts ?? Date.now())}`;
    return;
  }
  const origem = s.source === 'pin' ? 'Elemento fixado' : 'Seleção';
  $('origin').textContent = `${origem} · ${time(s.ts)} · ${s.title}`;
}

const LABELS = [
  ['n', 'n'], ['sum', 'soma'], ['mean', 'média'], ['median', 'mediana'],
  ['min', 'min'], ['max', 'max'], ['stdev', 'desvio'],
];

function addRow(table, label, value) {
  const tr = table.insertRow();
  tr.insertCell().textContent = label;
  tr.insertCell().textContent = value;
}

function renderCalc() {
  const c = state.answer?.calc;
  $('calc').hidden = !c;
  $('calc').textContent = c ? `Cálculo: ${c.expr} = ${c.value.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}` : '';
}

function renderStats() {
  const box = $('stats');
  box.replaceChildren();
  if (!state.summary) return; // pergunta sem elemento fixado: não há dados a resumir
  if (state.summary.groups.length === 0) {
    box.textContent = 'Sem números aqui.';
    return;
  }
  for (const { name, stats } of state.summary.groups) {
    const h = document.createElement('h3');
    h.textContent = name;
    const table = document.createElement('table');
    for (const [key, label] of LABELS) addRow(table, label, fmt(stats[key]));
    addRow(table, 'outliers', stats.outliers.length ? stats.outliers.map(fmt).join('; ') : '—');
    box.append(h, table);
  }
}

function sparkPoints(values, w, h) {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ');
}

function renderLive() {
  $('live').hidden = state.history.length === 0;
  if ($('live').hidden) return;
  $('live-value').textContent = fmt(state.history.at(-1));
  const d = state.liveDelta;
  const el = $('delta');
  if (!d) {
    el.textContent = '';
    el.className = '';
  } else {
    const sign = d.abs > 0 ? '+' : '';
    el.textContent = `${sign}${fmt(d.abs)}` + (d.pct === null ? '' : ` (${sign}${fmt(d.pct)}%)`);
    el.className = d.abs > 0 ? 'up' : d.abs < 0 ? 'down' : '';
  }
  $('spark').setAttribute('points', sparkPoints(state.history, 280, 40));
}

refreshPinState();
