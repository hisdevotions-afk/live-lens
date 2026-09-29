// Live Lens: captura a seleção e o elemento fixado e envia snapshots ao painel.
// Não calcula nada e não acessa a rede.

const style = document.createElement('style');
style.textContent =
  '.ll-hover{outline:2px dashed #f59e0b !important;outline-offset:2px}' +
  '.ll-pin{outline:2px solid #f59e0b !important;outline-offset:2px}';
document.documentElement.appendChild(style);

function send(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {}); // painel fechado: ignora
  } catch {
    // extensão recarregada: este content script ficou órfão, ignora
  }
}

function sendSnapshot(source, text, table) {
  send({
    type: 'snapshot',
    source,
    text,
    table,
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang || '',
    ts: Date.now(),
  });
}

function labelOf(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = [...el.classList].find((c) => !c.startsWith('ll-'));
  return cls ? `${tag}.${cls}` : tag;
}

// ---------- Seleção ----------

function tableFromSelection(range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const table = node?.closest('table');
  if (!table) return null;
  // 1ª passada: quais linhas e colunas a seleção toca.
  const hit = [];
  const cols = new Set();
  for (const tr of table.rows) {
    const cells = [...tr.cells].filter((c) => range.intersectsNode(c));
    if (cells.length === 0) continue;
    cells.forEach((c) => cols.add(c.cellIndex));
    hit.push(tr);
  }
  if (hit.length === 0) return null;
  // 2ª passada: grade alinhada por coluna. Arrastar pra baixo seleciona linhas parciais,
  // então célula fora da seleção vira '' para não desalinhar as colunas.
  const idx = [...cols].sort((a, b) => a - b);
  const cellText = (tr, i) => {
    const c = tr.cells[i];
    return c && range.intersectsNode(c) ? c.innerText.trim() : '';
  };
  const rows = hit.map((tr) => idx.map((i) => cellText(tr, i)));
  const header = table.rows[0];
  if (!hit.includes(header)) rows.unshift(idx.map((i) => header.cells[i]?.innerText.trim() ?? ''));
  return rows;
}

let lastSelText = '';
let selTimer;

function onSelection() {
  if (picking) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const text = sel.toString().trim();
  if (!text || text === lastSelText) return;
  lastSelText = text;
  sendSnapshot('selection', text, tableFromSelection(sel.getRangeAt(0)));
}

document.addEventListener('selectionchange', () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(onSelection, 400);
});

// ---------- Fixar elemento ----------

let picking = false;
let hovered = null;
let pinned = null;
let observer = null;
let aliveTimer = null;
let pinTimer = null;
let lastPinText = '';

function onHover(e) {
  hovered?.classList.remove('ll-hover');
  hovered = e.target;
  hovered.classList.add('ll-hover');
}

function blockEvent(e) {
  e.preventDefault();
  e.stopPropagation();
}

function onPickClick(e) {
  blockEvent(e);
  const el = e.target;
  stopPick();
  pin(el);
}

function onPickKey(e) {
  if (e.key !== 'Escape') return;
  stopPick();
  send({ type: 'pin-state', pinned: !!pinned, label: pinned ? labelOf(pinned) : '', reason: 'cancelled' });
}

function startPick() {
  stopPick();
  picking = true;
  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('mousedown', blockEvent, true);
  document.addEventListener('click', onPickClick, true);
  document.addEventListener('keydown', onPickKey, true);
}

function stopPick() {
  picking = false;
  hovered?.classList.remove('ll-hover');
  hovered = null;
  document.removeEventListener('mouseover', onHover, true);
  document.removeEventListener('mousedown', blockEvent, true);
  document.removeEventListener('click', onPickClick, true);
  document.removeEventListener('keydown', onPickKey, true);
}

function checkPin() {
  if (!pinned) return;
  if (!document.contains(pinned)) {
    unpin('removed');
    return;
  }
  const text = pinned.innerText.trim();
  if (text === lastPinText) return;
  lastPinText = text;
  const table = pinned.tagName === 'TABLE' ? pinned : pinned.querySelector('table');
  const grid = table ? [...table.rows].map((tr) => [...tr.cells].map((c) => c.innerText.trim())) : null;
  sendSnapshot('pin', text, grid);
}

function pin(el) {
  unpin(null);
  pinned = el;
  pinned.classList.add('ll-pin');
  lastPinText = '';
  observer = new MutationObserver(() => {
    clearTimeout(pinTimer);
    pinTimer = setTimeout(checkPin, 1000);
  });
  observer.observe(el, { subtree: true, childList: true, characterData: true });
  aliveTimer = setInterval(checkPin, 2000); // também detecta elemento removido
  send({ type: 'pin-state', pinned: true, label: labelOf(el), reason: 'picked' });
  checkPin();
}

// reason: 'user' | 'removed' | null (null = troca silenciosa por outro pin)
function unpin(reason) {
  if (!pinned) return;
  observer?.disconnect();
  observer = null;
  clearInterval(aliveTimer);
  clearTimeout(pinTimer);
  pinned.classList.remove('ll-pin');
  pinned = null;
  if (reason) send({ type: 'pin-state', pinned: false, label: '', reason });
}

// ---------- Comandos do painel ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'start-pick') startPick();
  else if (msg.type === 'unpin') unpin('user');
  // 'get-state' só precisa da resposta abaixo
  sendResponse({ pinned: !!pinned, label: pinned ? labelOf(pinned) : '' });
});
