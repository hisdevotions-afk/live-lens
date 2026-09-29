import { summarize, delta, changedEnough } from './stats.js';
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
  liveDelta: null,    // delta(anterior, atual) do elemento fixado
  lastLlmAt: 0,
  lastLlmPrimary: null,
  lastLlmText: '',
  controller: null,   // AbortController do LLM em andamento
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
  state.liveDelta = null;
  renderLive();
}

function renderPin(pinned, label) {
  $('pin-status').textContent = pinned ? `Fixado: ${label}` : 'Nada fixado';
  $('unpin').disabled = !pinned;
}

async function refreshPinState() {
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

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab?.active || sender.tab.windowId !== myWindowId) return;
  if (msg.type === 'pin-state') {
    renderPin(msg.pinned, msg.label);
    if (msg.reason === 'picked' || !msg.pinned) resetLive();
    if (msg.reason === 'removed') $('pin-status').textContent = 'Elemento sumiu da página. Desfixado.';
  }
  if (msg.type === 'snapshot') onSnapshot(msg);
});

// ---------- Snapshot → stats → LLM ----------

function onSnapshot(snap) {
  state.current = snap;
  state.summary = summarize(snap);
  const primary = state.summary.primary;
  if (snap.source === 'pin' && primary !== null) {
    const prev = state.history.at(-1);
    state.liveDelta = prev === undefined ? null : delta(prev, primary);
    state.history.push(primary);
    if (state.history.length > HISTORY_MAX) state.history.shift();
  }
  renderOrigin();
  renderStats();
  renderLive();
  if (snap.source === 'selection') {
    if (!state.paused) runLlm();
  } else {
    maybeRunLlmForPin();
  }
}

function maybeRunLlmForPin() {
  clearTimeout(state.pendingTimer);
  const snap = state.current;
  if (state.paused || !snap || snap.source !== 'pin') return;
  const primary = state.summary.primary;
  const changed = primary === null
    ? snap.text !== state.lastLlmText
    : changedEnough(state.lastLlmPrimary, primary);
  if (!changed) return;
  const wait = LLM_WINDOW_MS - (Date.now() - state.lastLlmAt);
  if (wait > 0) {
    state.pendingTimer = setTimeout(maybeRunLlmForPin, wait);
    return;
  }
  runLlm();
}

async function runLlm(question = '') {
  clearTimeout(state.pendingTimer);
  state.controller?.abort();
  const snap = state.current;
  if (!snap) {
    setLlmStatus('Selecione algo na página primeiro.');
    return;
  }
  const controller = new AbortController();
  state.controller = controller;
  state.lastLlmAt = Date.now();
  state.lastLlmPrimary = state.summary.primary;
  state.lastLlmText = snap.text;
  $('analysis').textContent = '';
  setLlmStatus('analisando…');
  try {
    const chunks = analyze({ model: state.model, snapshot: snap, summary: state.summary, question, signal: controller.signal });
    for await (const chunk of chunks) $('analysis').textContent += chunk;
    setLlmStatus(`análise de ${time(state.lastLlmAt)}`);
  } catch (e) {
    if (e.name === 'AbortError') return; // cancelamento é normal
    setLlmStatus(errorText(e.message));
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

function renderStats() {
  const box = $('stats');
  box.replaceChildren();
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
