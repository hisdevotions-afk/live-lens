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

function sendSnapshot(source, text, table, header, extra = {}) {
  send({
    type: 'snapshot',
    source,
    text,
    table,
    header,
    ...extra,
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

// Linhas de dados: a linha de totais (tfoot) fica de fora para não dobrar somas.
const dataRows = (table) => [...table.rows].filter((tr) => tr.parentElement.tagName !== 'TFOOT');
// Cabeçalho de verdade = thead ou 1ª linha só de <th>. Sem isso, a 1ª linha é dado.
const hasHeader = (table) => !!table.tHead || (!!table.rows[0] && [...table.rows[0].cells].every((c) => c.tagName === 'TH'));
const gridOf = (table) => dataRows(table).map((tr) => [...tr.cells].map((c) => c.innerText.trim()));

function tableFromSelection(range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
  const table = node?.closest('table');
  if (!table) return null;
  const all = dataRows(table);
  // 1ª passada: quais linhas e colunas a seleção toca.
  const hit = [];
  const cols = new Set();
  for (const tr of all) {
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
  const grid = hit.map((tr) => idx.map((i) => cellText(tr, i)));
  const header = hasHeader(table);
  if (header && !hit.includes(all[0])) grid.unshift(idx.map((i) => all[0].cells[i]?.innerText.trim() ?? ''));
  return { grid, header };
}

// ---------- Texto da seleção, com a matemática ----------
// Renderizadores de fórmulas (MathJax, KaTeX, imagens) deixam a fórmula FORA do texto selecionado:
// selection.toString() devolve só quebras de linha no lugar dela. A fórmula continua no DOM
// (MathML assistivo, anotação TeX, alt da imagem); aqui ela é lida de lá.

const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'TR', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'HR']);
const MO_SPACED = new Set(['=', '+', '-', '×', '÷', '<', '>', '≤', '≥', '≠', '±', '≈', '·', '*', '/']);
const MATHY_ALT = /[=^_\\{}]/; // alt de imagem que parece fórmula (ex.: Wikipedia: {\displaystyle x^{2}})

// MathML → texto simples: 3x − 9 = 0, x^2, (a)/(b), √(x)
function mml(el) {
  const kids = () => [...el.children].map(mml);
  const wrap = (t) => (t.length > 1 ? `(${t})` : t);
  switch (el.localName) {
    case 'annotation':
    case 'annotation-xml':
      return '';
    case 'mfrac': { const [a = '', b = ''] = kids(); return `(${a})/(${b})`; }
    case 'msqrt': return `√(${kids().join('')})`;
    case 'msup': { const [a = '', b = ''] = kids(); return `${a}^${wrap(b)}`; }
    case 'msub': { const [a = '', b = ''] = kids(); return `${a}_${wrap(b)}`; }
    default: {
      if (!el.children.length) return el.textContent.trim();
      let out = '';
      [...el.children].forEach((c, i, all) => {
        if (c.localName !== 'mo') { out += mml(c); return; }
        const op = c.textContent.trim().replace('−', '-');
        const prev = all[i - 1];
        const unary = (op === '-' || op === '+') && (!prev || prev.localName === 'mo'); // "x = -3"
        out += MO_SPACED.has(op) && !unary ? ` ${op} ` : op;
      });
      return out;
    }
  }
}

function mathText(n) {
  const tex = n.querySelector?.('annotation[encoding="application/x-tex"], annotation[encoding="text/plain"]'); // KaTeX: TeX; Google: texto puro
  if (tex) return tex.textContent.trim();
  const m = n.localName === 'math' ? n : n.querySelector?.('math'); // MathJax: MathML assistivo
  if (m) return mml(m).trim();
  return (n.getAttribute?.('aria-label') || n.textContent || '').trim();
}

// Renderizador de fórmulas do Google (data-xpm-*): o TeX está no atributo; o SVG só tem glifos (𝑥).
function xpmText(n) {
  return n.getAttribute('data-xpm-latex')
    || n.querySelector('annotation[encoding="text/plain"]')?.textContent
    || n.querySelector('[data-xpm-latex]')?.getAttribute('data-xpm-latex')
    || mathText(n);
}

function walk(n, out) {
  if (n.nodeType === Node.TEXT_NODE) { out.push(n.nodeValue); return; }
  if (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  const tag = n.localName;
  if (tag === 'script') { if (/^math\/tex/.test(n.type)) out.push(' ', n.textContent.trim(), ' '); return; } // MathJax v2
  if (tag === 'style' || tag === 'noscript') return;
  if (n.hasAttribute?.('data-xpm-copy-root')) { out.push(' ', xpmText(n).trim(), ' '); return; }
  if (tag === 'mjx-container' || tag === 'math' || n.classList?.contains('katex')) { out.push(' ', mathText(n), ' '); return; }
  if (tag === 'svg') { const t = n.getAttribute('aria-label') || n.querySelector(':scope > title')?.textContent; if (t) out.push(' ', t, ' '); return; } // o texto dentro de SVG é só glifo
  if (n.classList?.contains('MathJax') || n.classList?.contains('MathJax_Preview')) return; // v2: vale o <script> ao lado
  if (tag === 'img') { const alt = n.getAttribute('alt') || ''; if (MATHY_ALT.test(alt)) out.push(' ', alt, ' '); return; }
  if (tag === 'br') { out.push('\n'); return; }
  const block = BLOCK.has(n.tagName);
  if (block) out.push('\n');
  for (const c of n.childNodes) walk(c, out);
  if (block) out.push('\n');
  else if (tag === 'td' || tag === 'th') out.push('\t');
}

// Conta o que a seleção tem de "visual": também alimenta o Diagnóstico do painel.
function describeVisual(frag) {
  const count = (sel) => frag.querySelectorAll(sel).length;
  const mathImg = [...frag.querySelectorAll('img[alt]')].filter((i) => MATHY_ALT.test(i.getAttribute('alt'))).length;
  return {
    mjx: count('mjx-container'), katex: count('.katex'), xpm: count('[data-xpm-copy-root]'), math: count('math'), tex: count('script[type^="math/tex"]'),
    mathImg, img: count('img'), svg: count('svg'), canvas: count('canvas'),
  };
}

// Trecho do HTML da seleção para o Diagnóstico: sem o miolo dos SVG, sem estilos e sem src (podem ser enormes).
function htmlSnippet(frag) {
  const box = document.createElement('div');
  box.append(frag.cloneNode(true));
  box.querySelectorAll('svg').forEach((s) => s.replaceChildren());
  box.querySelectorAll('[style]').forEach((e) => e.removeAttribute('style'));
  box.querySelectorAll('[src],[srcset]').forEach((e) => { e.removeAttribute('src'); e.removeAttribute('srcset'); });
  return box.innerHTML.replace(/\s+/g, ' ').slice(0, 6000);
}

function selectionText(range, raw) {
  const frag = range.cloneContents();
  const visual = describeVisual(frag);
  const html = Object.values(visual).some(Boolean) ? htmlSnippet(frag) : undefined;
  if (!(visual.mjx || visual.katex || visual.xpm || visual.math || visual.tex || visual.mathImg)) return { text: raw, visual, html };
  const parts = [];
  walk(frag, parts);
  const text = parts.join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([?,;:.!])/g, '$1') // "x ?" → "x?"
    .replace(/\( +/g, '(').replace(/ +\)/g, ')')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => c.normalize('NFKC')) // 𝑥 → x, 𝟐 → 2 (só as letras matemáticas; ² fica)
    .trim();
  return { text, visual, html };
}

let lastSelText = '';
let selTimer;

function onSelection() {
  if (picking) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const raw = sel.toString().trim();
  const { text, visual, html } = selectionText(range, raw);
  if (!text || text === lastSelText) return;
  lastSelText = text;
  const t = tableFromSelection(range);
  sendSnapshot('selection', text, t?.grid ?? null, t?.header ?? false, { raw, visual, html });
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

// A página não pode reagir ao clique de fixar (botões costumam agir em pointerdown/mouseup).
const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup'];

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
  // Clicar numa célula fixa a tabela toda; Shift+clique fixa o elemento exato.
  const el = e.shiftKey ? e.target : (e.target.closest('td,th,tr,thead,tbody,tfoot')?.closest('table') ?? e.target);
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
  for (const t of BLOCKED) document.addEventListener(t, blockEvent, true);
  document.addEventListener('click', onPickClick, true);
  document.addEventListener('keydown', onPickKey, true);
}

function stopPick() {
  picking = false;
  hovered?.classList.remove('ll-hover');
  hovered = null;
  document.removeEventListener('mouseover', onHover, true);
  for (const t of BLOCKED) document.removeEventListener(t, blockEvent, true);
  document.removeEventListener('click', onPickClick, true);
  document.removeEventListener('keydown', onPickKey, true);
}

function checkPin() {
  if (!pinned) return;
  if (!document.contains(pinned)) {
    unpin('removed');
    return;
  }
  const text = (pinned.innerText ?? pinned.textContent ?? '').trim();
  if (text === lastPinText) return;
  lastPinText = text;
  const table = pinned.tagName === 'TABLE' ? pinned : pinned.querySelector('table');
  sendSnapshot('pin', text, table ? gridOf(table) : null, table ? hasHeader(table) : false);
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
