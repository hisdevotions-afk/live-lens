// Funções puras: sem DOM, sem Chrome APIs. Testadas por test.mjs.

const MULT = {
  k: 1e3, K: 1e3, mil: 1e3,
  M: 1e6, mi: 1e6, 'milhão': 1e6, 'milhões': 1e6,
  B: 1e9, bi: 1e9, 'bilhão': 1e9, 'bilhões': 1e9,
  '%': 1,
};
const SUFFIX = '%|milh(?:ões|ão)|bilh(?:ões|ão)|mil|mi|bi|k|K|M|B';
const SUFFIX_RE = new RegExp(`\\s?(${SUFFIX})$`);
const TOKEN_RE = new RegExp(
  `(?<![\\w.,])\\(?[-−]?\\s?(?:R\\$|US\\$|\\$|€)?\\s?[-−]?\\d[\\d.,]*(?:\\s?(?:${SUFFIX})(?![A-Za-zÀ-ÿ]))?\\)?`,
  'g',
);
const DATE_RE = /\d{4}-\d{2}-\d{2}|\d{1,4}[\/:]\d{1,4}(?:[\/:]\d{1,4})?/g;

export function detectLocale(text, lang = '') {
  if (/\d\.\d{3},\d/.test(text)) return 'pt';
  if (/\d,\d{3}\.\d/.test(text)) return 'en';
  if (/R\$/.test(text)) return 'pt';
  return lang.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export function parseNumber(token, locale = 'pt') {
  let s = String(token).trim();
  let neg = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    neg = true;
    s = s.slice(1, -1).trim();
  } else {
    s = s.replace(/^\(|\)$/g, '');
  }
  let mult = 1;
  const suf = s.match(SUFFIX_RE);
  if (suf) {
    mult = MULT[suf[1]];
    s = s.slice(0, suf.index);
  }
  s = s.replace(/R\$|US\$|\$|€/g, '').replace(/\s/g, '');
  if (/^[-−]/.test(s)) {
    neg = true;
    s = s.slice(1);
  }
  s = s.replace(/[.,]+$/, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  let dec = null; // caractere decimal, ou null se não houver parte decimal
  if (hasDot && hasComma) {
    dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = s.split(sep);
    if (parts.length > 2) dec = null; // separador repetido = milhar
    else if (parts[1].length === 3) dec = locale === 'pt' ? ',' : '.'; // ambíguo: decide pelo locale
    else dec = sep;
  }
  const clean = dec
    ? s.replaceAll(dec === ',' ? '.' : ',', '').replace(dec, '.')
    : s.replace(/[.,]/g, '');
  const v = Number(clean) * mult;
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

export function extractNumbers(text, locale = 'pt') {
  const noDates = String(text).replace(DATE_RE, ' ');
  const out = [];
  for (const m of noDates.matchAll(TOKEN_RE)) {
    const v = parseNumber(m[0], locale);
    if (v !== null) out.push(v);
  }
  return out;
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function describe(nums) {
  const xs = nums.filter(Number.isFinite);
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const stdev = n > 1 ? Math.sqrt(s.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  let outliers = [];
  if (n >= 4) {
    const q1 = quantile(s, 0.25);
    const q3 = quantile(s, 0.75);
    const iqr = q3 - q1;
    outliers = xs.filter((x) => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr);
  }
  return { n, sum, mean, median: quantile(s, 0.5), min: s[0], max: s[n - 1], stdev, outliers };
}

function firstNumber(cell, locale) {
  const nums = extractNumbers(cell, locale);
  return nums.length ? nums[0] : null;
}

// header: true/false vem do DOM (thead/th); undefined = adivinha pelo conteúdo.
export function tableColumns(table, locale = 'pt', header) {
  if (!Array.isArray(table) || table.length === 0) return [];
  const first = table[0];
  const hasHeader = header ?? first.every((c) => firstNumber(c, locale) === null);
  const rows = hasHeader ? table.slice(1) : table;
  const width = Math.max(...table.map((r) => r.length));
  const out = [];
  for (let c = 0; c < width; c++) {
    const cells = rows.map((r) => (r[c] ?? '').trim()).filter(Boolean);
    const nums = cells.map((x) => firstNumber(x, locale)).filter((v) => v !== null);
    if (cells.length === 0 || nums.length / cells.length < 0.5) continue;
    const name = (hasHeader && first[c]?.trim()) || `Coluna ${c + 1}`;
    out.push({ name, stats: describe(nums) });
  }
  return out;
}

// forcedLocale: o painel trava o locale do 1º snapshot de um pin, para o delta não pular de escala.
export function summarize(snapshot, forcedLocale) {
  const text = snapshot.text ?? '';
  const locale = forcedLocale ?? detectLocale(text, snapshot.lang ?? '');
  let groups = snapshot.table ? tableColumns(snapshot.table, locale, snapshot.header) : [];
  if (groups.length === 0) {
    const stats = describe(extractNumbers(text, locale));
    groups = stats ? [{ name: 'Números', stats }] : [];
  }
  // Com 1 número, sum é o próprio número.
  const primary = groups.length ? groups[0].stats.sum : null;
  return { locale, groups, primary };
}

export function delta(prev, curr) {
  return { abs: curr - prev, pct: prev === 0 ? null : ((curr - prev) / Math.abs(prev)) * 100 };
}

export function changedEnough(prev, curr, threshold = 0.01) {
  if (prev === null || prev === undefined) return true;
  if (prev === 0) return curr !== 0;
  return Math.abs(curr - prev) / Math.abs(prev) > threshold;
}

// ---------- Modo pergunta ----------

const WH = /^["'“(]*(qual|quais|quanto|quanta|quantos|quantas|como|quando|onde|aonde|quem|por\s?que|porque|o\s+que)\b/i;

// Pergunta = curta e termina em "?", ou começa com palavra interrogativa sem outra pontuação de frase.
export function isQuestion(text) {
  const t = String(text).trim();
  if (!t || t.length > 300 || t.split('\n').length > 2) return false;
  if (/\?["'”)\]]*$/.test(t)) return true;
  const semSeparadores = t.replace(/(?<=\d)[.,](?=\d)/g, ''); // 1.234,56 não é ponto final
  return WH.test(t) && t.length <= 140 && !/[.!;]/.test(semSeparadores);
}

// Conta feita em código: "X% de Y" e cadeias com + - × ÷ e parênteses. Sem eval.
const NUM = String.raw`(?:R\$|US\$|\$|€)?\s?\d[\d.,]*(?:\s?(?:mil|mi|bi|k|K|M|B)(?![A-Za-zÀ-ÿ]))?`;
const OP = String.raw`(?:[+×÷*/x]|\s[-−]\s)`;
const PCT_RE = new RegExp(`(${NUM})\\s*%\\s*(?:de|do|da|dos|das|sobre)\\s+(${NUM})`, 'i');
const EXPR_RE = new RegExp(String.raw`(?:\(\s*)*${NUM}(?:\s*\))*(?:\s*${OP}\s*(?:\(\s*)*${NUM}(?:\s*\))*)+`);
const TOKEN = new RegExp(String.raw`\s*(${NUM}|[+\-−×÷*/x()])`, 'y');
const CALENDAR_RE = /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}/g; // datas não são divisões

function evaluate(expr, locale) {
  const toks = [];
  TOKEN.lastIndex = 0;
  for (let m; (m = TOKEN.exec(expr)); ) toks.push(m[1]);
  let i = 0;
  const factor = () => {
    const t = toks[i++];
    if (t === '(') {
      const v = sum();
      if (toks[i++] !== ')') throw new Error('parênteses');
      return v;
    }
    const v = parseNumber(t ?? '', locale);
    if (v === null) throw new Error('número');
    return v;
  };
  const product = () => {
    let v = factor();
    while (['*', '×', 'x', '/', '÷'].includes(toks[i])) {
      const op = toks[i++];
      const r = factor();
      v = op === '/' || op === '÷' ? v / r : v * r;
    }
    return v;
  };
  const sum = () => {
    let v = product();
    while (['+', '-', '−'].includes(toks[i])) v = toks[i++] === '+' ? v + product() : v - product();
    return v;
  };
  const v = sum();
  if (i !== toks.length) throw new Error('sobrou');
  return v;
}

export function calc(text, locale = 'pt') {
  const t = String(text).replace(CALENDAR_RE, ' ');
  const pm = t.match(PCT_RE);
  if (pm) {
    const a = parseNumber(pm[1], locale);
    const b = parseNumber(pm[2], locale);
    const resto = t.slice(pm.index + pm[0].length);
    if (/^\s*[+×÷*/x]|^\s[-−]\s/.test(resto)) return null; // "15% de 200 + 10": não calcula pela metade
    if (a !== null && b !== null) return { expr: pm[0].trim(), value: (a / 100) * b };
  }
  const m = t.match(EXPR_RE);
  if (!m) return null;
  try {
    const value = evaluate(m[0], locale);
    return Number.isFinite(value) ? { expr: m[0].trim().replace(/\s+/g, ' '), value } : null;
  } catch {
    return null;
  }
}

const ENDS_Q = /\?["'”)\]]*$/;

// Acha a pergunta dentro de uma seleção. { question, rest } (rest = os dados que vieram junto) ou null.
export function splitQuestion(text) {
  const t = String(text).trim();
  if (!t) return null;
  const lines = t.split('\n');
  // Pergunta numa linha própria (a última, ou a primeira, com os dados nas outras).
  for (let i = lines.length - 1; i >= 0 && lines.length > 1; i--) {
    const ln = lines[i].trim();
    if (ln.length <= 300 && ENDS_Q.test(ln)) {
      const rest = lines.filter((_, j) => j !== i).join('\n').trim();
      return { question: ln, rest };
    }
  }
  // Pergunta como última frase de um parágrafo ("... 980,00. Qual mês vendeu mais?"). Decimais não têm espaço depois.
  if (lines.length === 1 && ENDS_Q.test(t)) {
    const pieces = t.split(/(?<=[.!])\s+(?=[A-ZÀ-Ú])/);
    const last = pieces.at(-1).trim();
    if (pieces.length > 1 && last.length <= 300) return { question: last, rest: pieces.slice(0, -1).join(' ').trim() };
  }
  return isQuestion(t) ? { question: t, rest: '' } : null; // pergunta sozinha
}
