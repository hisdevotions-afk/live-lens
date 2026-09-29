import { summarize, delta, changedEnough, splitQuestion, calc, detectLocale, cleanMath, looksLikeMath } from './stats.js';
import { analyze } from './llm.js';
import { resolve } from './algebra.js';

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
  raw: '',            // texto bruto da resposta do LLM (renderizado por renderAnalysis)
  copyText: '',       // comando do erro atual, para o botão Copiar
  debug: null,        // o que a última seleção/pergunta foi (aba Diagnóstico das configurações)
  model: DEFAULT_MODEL,
};

const VERSION = chrome.runtime.getManifest?.().version ?? '';
$('ver').textContent = VERSION ? `v${VERSION}` : '';
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
  document.body.dataset.pinned = String(!!pinned);
  $('pick-label').textContent = pinned ? 'Trocar' : 'Fixar elemento';
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

function setDebug(info) {
  state.debug = { ...info, versao: VERSION };
  $('debug').textContent = JSON.stringify(state.debug, null, 2);
}

// dados: snapshot que veio junto com a pergunta (ou null: usa o elemento fixado, se houver, ou nada).
function newAnswer(question, data, lang = '') {
  return {
    question,
    calc: calc(question, state.pinLocale ?? detectLocale(question, lang)),
    data,
    dataSummary: data ? (looksLikeMath(data.text) ? { locale: 'pt', groups: [], primary: null } : summarize(data)) : null,
    resolution: resolve(question, data ? data.text : ''), // equações e suficiência de dados resolvidas em código
  };
}

// Pergunta digitada: usa como dados a seleção atual (ou os dados da pergunta anterior); senão, o elemento fixado; senão, nada.
function newTypedAnswer(question) {
  const cur = state.current;
  const data = state.answer ? state.answer.data : cur?.source === 'selection' ? cur : null;
  state.answer = newAnswer(question, data, cur?.lang);
  setDebug({ modo: 'pergunta digitada', pergunta: question, dados: data ? data.text : cur?.source === 'pin' ? '(elemento fixado)' : null, resolucao: state.answer.resolution?.lines });
  state.summary = data ? (state.answer.dataSummary) : state.pinSummary;
  renderCalc();
  renderOrigin();
  renderStats();
}

function onSnapshot(snap) {
  if (snap.source === 'selection') {
    const textoOriginal = snap.text;
    snap = { ...snap, text: cleanMath(snap.text) }; // LaTeX colado como texto vira símbolos legíveis
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
    setDebug({
      modo: sq ? 'pergunta' : 'análise',
      textoNavegador: snap.raw !== undefined && snap.raw !== textoOriginal ? snap.raw : undefined, // o que selection.toString() deu, se a extensão leu outra coisa do DOM
      textoOriginal,
      textoLimpo: snap.text,
      pergunta: sq?.question ?? null,
      dados: sq ? sq.rest : null,
      tabela: !!snap.table,
      visual: snap.visual,
      html: snap.html, // estrutura real da página, para diagnosticar leituras estranhas
      resolucao: state.answer?.resolution?.lines,
    });
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

async function runLlm(question = '', kind = 'user', force = false) {
  clearTimeout(state.pendingTimer);
  state.controller?.abort();
  if (question) newTypedAnswer(question); // pergunta digitada no painel
  const snap = state.current;
  const answer = state.answer;
  if (!snap && !answer) {
    setLlmStatus('Selecione algo na página ou digite uma pergunta.');
    return;
  }
  if (answer?.resolution?.complete && !force) {
    // Já resolvido em código (exato): o LLM só entra se o usuário pedir a explicação (Reanalisar).
    state.busy = false;
    $('asked').hidden = false;
    $('asked').textContent = answer.question;
    setAnalysis('');
    setLlmStatus('resolvido em código');
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
  $('asked').hidden = !answer;
  $('asked').textContent = answer?.question ?? '';
  setAnalysis('');
  setLlmStatus('analisando…');
  try {
    const chunks = answer
      ? analyze({ model: state.model, snapshot: answer.data ?? state.pinSnap, summary: answer.dataSummary ?? state.pinSummary, question: answer.question, answer: true, calc: answer.calc, resolution: answer.resolution?.lines, signal: controller.signal })
      : analyze({ model: state.model, snapshot: snap, summary: state.summary, question, signal: controller.signal });
    for await (const chunk of chunks) appendAnalysis(chunk);
    ensureAlternative(answer);
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

// Estado visual do resultado a partir do texto (o texto em si é o contrato com os testes e o usuário).
function setLlmStatus(text) {
  const el = $('llm-status');
  const kind = /…$/.test(text) ? 'busy' : /^(análise|resposta) de |^resolvido em código/.test(text) ? 'done' : /^(Ollama|Modelo|Erro)/.test(text) ? 'error' : 'idle';
  const cmd = kind === 'error' ? text.match(/^(.*?Rode: )(.+)$/) : null; // comando vira <code> copiável
  el.replaceChildren();
  if (cmd) {
    const code = document.createElement('code');
    code.textContent = cmd[2];
    el.append(cmd[1], code);
  } else {
    el.textContent = text;
  }
  state.copyText = cmd ? cmd[2] : '';
  $('copy').hidden = !cmd;
  $('result').dataset.state = kind;
  $('analysis').setAttribute('aria-busy', String(kind === 'busy'));
}

// Resposta do LLM: bullets e **negrito** viram elementos; todo texto entra por textContent.
function inline(el, text) {
  for (const part of text.split(/(\*\*[^*]+\*\*)/)) {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      const b = document.createElement('strong');
      b.textContent = part.slice(2, -2);
      el.append(b);
    } else if (part) {
      el.append(part);
    }
  }
}

function renderAnalysis() {
  const box = $('analysis');
  box.replaceChildren();
  let list = null;
  for (const line of cleanMath(state.raw).split('\n')) { // o modelo às vezes devolve LaTeX cru
    const t = line.trim();
    if (!t) { list = null; continue; }
    const m = t.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) {
      if (!list) { list = document.createElement('ul'); box.append(list); }
      const li = document.createElement('li');
      inline(li, m[1]);
      list.append(li);
    } else {
      list = null;
      const p = document.createElement('p');
      inline(p, t);
      box.append(p);
    }
  }
}

// A explicação termina com a alternativa que o código calculou: se o modelo esqueceu ou errou a letra, vale a do código.
function ensureAlternative(answer) {
  const letter = answer?.resolution?.letter;
  if (!letter) return;
  const lines = state.raw.replace(/\s+$/, '').split('\n');
  if (/^\**\s*Alternativa\s*:/i.test(lines.at(-1) ?? '')) lines.pop();
  state.raw = `${lines.join('\n').replace(/\s+$/, '')}\n\n**Alternativa: ${letter}**`;
  renderAnalysis();
}

function setAnalysis(text) {
  state.raw = text;
  renderAnalysis();
}

function appendAnalysis(chunk) {
  state.raw += chunk;
  renderAnalysis();
}

$('pause').addEventListener('click', () => {
  state.paused = !state.paused;
  $('pause-label').textContent = state.paused ? 'Retomar LLM' : 'Pausar LLM';
  $('pause').setAttribute('aria-pressed', String(state.paused));
  if (state.paused) {
    clearTimeout(state.pendingTimer);
    state.controller?.abort();
    setLlmStatus('pausado');
  }
});
$('rerun').addEventListener('click', () => runLlm('', 'user', true));

function sendQuestion() {
  const q = $('question').value.trim();
  if (!q) return;
  $('question').value = '';
  runLlm(q);
}
$('ask').addEventListener('click', sendQuestion);
$('question').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) sendQuestion();
});

$('gear').addEventListener('click', () => {
  const open = $('settings').hidden;
  $('settings').hidden = !open;
  $('gear').setAttribute('aria-expanded', String(open));
  if (open) $('model').focus();
});

$('copy-debug').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('debug').textContent);
    $('copy-debug').textContent = 'Copiado!';
    setTimeout(() => ($('copy-debug').textContent = 'Copiar diagnóstico'), 1500);
  } catch {
    // sem permissão de área de transferência: o texto continua visível para copiar à mão
  }
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.copyText);
    $('copy').title = 'Copiado!';
    setTimeout(() => ($('copy').title = 'Copiar comando'), 1500);
  } catch {
    // sem permissão de área de transferência: o comando continua visível para copiar à mão
  }
});

// ---------- Render (sempre textContent, nunca innerHTML) ----------

function syncView() {
  const main = document.querySelector('main');
  main.dataset.empty = String(!(state.current || state.answer || state.history.length));
  main.dataset.mode = state.answer ? 'answer' : 'analysis';
}

function setOrigin(kind, meta) {
  const kindEl = document.createElement('span');
  kindEl.className = 'kind';
  kindEl.textContent = kind;
  const metaEl = document.createElement('span');
  metaEl.className = 'meta';
  metaEl.textContent = meta;
  $('origin').replaceChildren(kindEl, metaEl);
  syncView();
}

function renderOrigin() {
  const s = state.current;
  const a = state.answer;
  if (a) {
    const sobre = a.data ? 'sobre a seleção' : state.pinSnap ? 'sobre o elemento fixado' : 'pergunta geral';
    setOrigin('Pergunta', `${sobre} · ${time(s?.ts ?? Date.now())}`);
    return;
  }
  setOrigin(s.source === 'pin' ? 'Elemento fixado' : 'Seleção', `${time(s.ts)} · ${s.title}`);
}

const METRICS = [['sum', 'soma'], ['mean', 'média'], ['median', 'mediana'], ['min', 'mín'], ['max', 'máx'], ['stdev', 'desvio']];

function renderCalc() {
  const res = state.answer?.resolution;
  const c = state.answer?.calc;
  const box = $('calc');
  box.hidden = !(res || c);
  box.replaceChildren();
  const part = (cls, text) => Object.assign(document.createElement('span'), { className: cls, textContent: text });
  if (res) {
    box.append(part('lbl', 'Resolução (feita em código)'));
    for (const line of res.lines) {
      box.append('\n');
      if (line.startsWith('Resposta:')) {
        const [head, ...tail] = line.split(' — ');
        box.append(part('answer', head), part('dash', ' — '), part('why', tail.join(' — ')));
      } else {
        box.append(part('line', line));
      }
    }
  } else if (c) {
    box.append(part('lbl', 'Cálculo:'), ' ', part('expr', c.expr), ' = ', part('val', c.value.toLocaleString('pt-BR', { maximumFractionDigits: 4 })));
  }
  syncView();
}

function renderStats() {
  const box = $('stats');
  box.replaceChildren();
  syncView();
  if (!state.summary) return; // pergunta sem elemento fixado: não há dados a resumir
  if (state.summary.groups.length === 0) {
    if (!state.answer) box.textContent = 'Sem números aqui.';
    return;
  }
  // Elemento fixado com um número só: o valor ao vivo (acima) já o mostra; repetir aqui é ruído.
  const repetido = state.current?.source === 'pin' && !state.answer && state.summary.groups.every((g) => g.stats.n === 1);
  if (repetido) return;
  for (const { name, stats } of state.summary.groups) {
    const group = document.createElement('div');
    group.className = 'group';
    const h = document.createElement('h3');
    h.textContent = name;
    h.append(Object.assign(document.createElement('span'), { textContent: `${stats.n} ${stats.n === 1 ? 'valor' : 'valores'}` }));
    group.append(h);
    if (stats.n === 1) {
      group.append(Object.assign(document.createElement('div'), { className: 'single', textContent: fmt(stats.sum) }));
    } else {
      const dl = document.createElement('dl');
      for (const [key, label] of METRICS) {
        const cell = document.createElement('div');
        cell.append(Object.assign(document.createElement('dt'), { textContent: label }), Object.assign(document.createElement('dd'), { textContent: fmt(stats[key]) }));
        dl.append(cell);
      }
      group.append(dl);
    }
    if (stats.outliers.length) {
      group.append(Object.assign(document.createElement('p'), { className: 'outliers', textContent: `Fora do padrão: ${stats.outliers.map(fmt).join('; ')}` }));
    }
    box.append(group);
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
  syncView();
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
  const pts = sparkPoints(state.history, 280, 40);
  $('spark').setAttribute('points', pts);
  $('spark-area').setAttribute('points', `${pts} 280,44 0,44`);
}

syncView();
refreshPinState();
