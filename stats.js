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
const DATE_RE = /\d{1,4}[\/:]\d{1,2}(?:[\/:]\d{1,4})?/g;

export function detectLocale(text, lang = '') {
  if (/\d\.\d{3},\d/.test(text)) return 'pt';
  if (/\d,\d{3}\.\d/.test(text)) return 'en';
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

export function tableColumns(table, locale = 'pt') {
  if (!Array.isArray(table) || table.length === 0) return [];
  const first = table[0];
  const hasHeader = first.every((c) => firstNumber(c, locale) === null);
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

export function summarize(snapshot) {
  const text = snapshot.text ?? '';
  const locale = detectLocale(text, snapshot.lang ?? '');
  let groups = snapshot.table ? tableColumns(snapshot.table, locale) : [];
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
