// Equações de uma variável e suficiência de dados (GMAT). Funções puras, sem eval.
// As raízes são achadas numericamente (varredura + bisseção + mínimo local) e verificadas na equação.

const FUNCS = { sqrt: Math.sqrt, abs: Math.abs };

// ---------- Leitura da equação ----------

function tokenize(text) {
  const t = String(text)
    .replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/[−–]/g, '-').replace(/[×·⋅]/g, '*').replace(/÷/g, '/').replace(/√/g, ' sqrt ')
    .replace(/(\d),(\d)/g, '$1.$2')
    .trim().replace(/[.;]+$/, '');
  if (!t || /[^\s0-9a-zA-Z+\-*/^().=]/.test(t)) return null; // palavras acentuadas, >, <, etc.
  const re = /\s*(\d+\.?\d*|\.\d+|[a-zA-Z]+|[-+*/^()=])/y;
  const toks = [];
  let pos = 0;
  while (pos < t.length) {
    re.lastIndex = pos;
    const m = re.exec(t);
    if (!m) return /^\s*$/.test(t.slice(pos)) ? toks : null;
    pos = re.lastIndex;
    const s = m[1];
    if (/^[\d.]/.test(s)) toks.push({ k: 'num', v: parseFloat(s) });
    else if (/^[a-zA-Z]+$/.test(s)) {
      const low = s.toLowerCase();
      if (FUNCS[low]) toks.push({ k: 'fn', v: low });
      else if (s.length === 1) toks.push({ k: 'var', v: low });
      else return null; // "xy", "Receita": não é uma variável só
    } else toks.push({ k: s });
  }
  return toks;
}

function parse(toks, vars) {
  let i = 0;
  const peek = () => toks[i];
  const eat = (k) => (toks[i]?.k === k ? toks[i++] : null);
  const startsAtom = (t) => t && (t.k === 'var' || t.k === 'fn' || t.k === '(');
  const bad = () => { throw new Error('sintaxe'); };

  function expr() {
    let n = term();
    while (peek() && (peek().k === '+' || peek().k === '-')) n = { t: 'bin', op: toks[i++].k, a: n, b: term() };
    return n;
  }
  function term() {
    let n = unary();
    for (;;) {
      const p = peek();
      if (p && (p.k === '*' || p.k === '/')) { i++; n = { t: 'bin', op: p.k, a: n, b: unary() }; }
      else if (startsAtom(p)) n = { t: 'bin', op: '*', a: n, b: unary() }; // 3x, 2(x+1), x(x-1)
      else return n;
    }
  }
  function unary() {
    if (eat('-')) return { t: 'neg', a: unary() };
    if (eat('+')) return unary();
    return power();
  }
  function power() {
    const base = atom();
    return eat('^') ? { t: 'bin', op: '^', a: base, b: unary() } : base;
  }
  function atom() {
    const t = toks[i++];
    if (!t) bad();
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'var') { vars.add(t.v); return { t: 'var' }; }
    if (t.k === 'fn') return { t: 'fn', f: t.v, a: atom() };
    if (t.k === '(') {
      const n = expr();
      if (!eat(')')) bad();
      return n;
    }
    return bad();
  }
  const n = expr();
  if (i !== toks.length) bad();
  return n;
}

function compile(n) {
  switch (n.t) {
    case 'num': return () => n.v;
    case 'var': return (x) => x;
    case 'neg': { const a = compile(n.a); return (x) => -a(x); }
    case 'fn': { const a = compile(n.a); const f = FUNCS[n.f]; return (x) => f(a(x)); }
    default: {
      const a = compile(n.a);
      const b = compile(n.b);
      switch (n.op) {
        case '+': return (x) => a(x) + b(x);
        case '-': return (x) => a(x) - b(x);
        case '*': return (x) => a(x) * b(x);
        case '/': return (x) => { const d = b(x); return d === 0 ? NaN : a(x) / d; };
        default: return (x) => Math.pow(a(x), b(x));
      }
    }
  }
}

// ---------- Raízes ----------

function grid() {
  const xs = [];
  for (let k = 1e9; k > 1e3; k /= 1.02) xs.push(-k); // cauda negativa (geométrica)
  for (let k = 0; k <= 100000; k++) xs.push(-1000 + k * 0.02);
  for (let k = 1e3 * 1.02; k < 1e9; k *= 1.02) xs.push(k);
  return xs;
}

function findRoots(L, R) {
  const f = (x) => L(x) - R(x);
  const tolAt = (scale) => 1e-9 * scale + 1e-12; // relativa ao tamanho dos termos, com piso minúsculo (1/x = 0 não tem raiz)
  const isRoot = (r) => { const y = f(r); return Number.isFinite(y) && Math.abs(y) <= tolAt(Math.abs(L(r)) + Math.abs(R(r))); };
  const roots = [];
  const add = (r) => { if (isRoot(r) && !roots.some((q) => Math.abs(q - r) <= 1e-6 * Math.max(1, Math.abs(r)))) roots.push(r); };
  const xs = grid();
  const n = xs.length;
  const fs = new Float64Array(n);
  const sc = new Float64Array(n); // |L| + |R| em cada ponto
  for (let i = 0; i < n; i++) {
    const l = L(xs[i]);
    const r = R(xs[i]);
    fs[i] = l - r;
    sc[i] = Math.abs(l) + Math.abs(r);
  }
  let finite = 0;
  let zeros = 0;
  for (let i = 0; i < n; i++) {
    const y = fs[i];
    if (!Number.isFinite(y)) continue;
    finite++;
    if (Math.abs(y) <= tolAt(sc[i])) {
      zeros++;
      if (!(i > 0 && Math.abs(fs[i - 1]) <= tolAt(sc[i - 1]))) add(xs[i]); // trecho todo zerado = identidade, não raízes isoladas
      continue;
    }
    const next = i + 1 < n ? fs[i + 1] : NaN;
    if (Number.isFinite(next) && y * next < 0) { // troca de sinal: bisseção (polo ou buraco abortam)
      let lo = xs[i], hi = xs[i + 1], flo = y, ok = true;
      for (let k = 0; k < 100; k++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (!Number.isFinite(fm)) { ok = false; break; }
        if (fm === 0) { lo = hi = mid; break; }
        if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
      }
      if (ok) add((lo + hi) / 2);
    }
    const prev = i > 0 ? fs[i - 1] : NaN;
    if (Number.isFinite(prev) && Number.isFinite(next) && y * prev > 0 && y * next > 0
      && Math.abs(y) < Math.abs(prev) && Math.abs(y) <= Math.abs(next) && Math.abs(y) < 0.05 * (1 + sc[i])) { // raiz dupla: mínimo de |f| perto de zero
      let a = xs[i - 1], b = xs[i + 1];
      for (let k = 0; k < 200; k++) {
        const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
        if (Math.abs(f(m1)) < Math.abs(f(m2))) b = m2; else a = m1;
      }
      add((a + b) / 2);
    }
  }
  if (finite > 0 && zeros === finite) return 'all';
  return roots.sort((p, q) => p - q);
}

// r → { v, exact, num, den }: inteiro ou fração de denominador ≤ 1000 quando bate; senão, aproximado.
function snap(r) {
  for (let den = 1; den <= 1000; den++) {
    const num = Math.round(r * den);
    if (Math.abs(r - num / den) <= 1e-7 * Math.max(1, Math.abs(r))) return { v: num / den, exact: true, num, den };
  }
  return { v: r, exact: false };
}

const fmtRoot = (s) => (s.exact ? (s.den === 1 ? String(s.num) : `${s.num}/${s.den}`) : String(Number(s.v.toFixed(4))).replace('.', ','));

function describeSolution(kind, snaps, name) {
  if (kind === 'none') return `nenhum valor real de ${name}`;
  if (kind === 'all') return `qualquer valor real de ${name}`;
  return snaps.map((s) => `${name} ${s.exact ? '=' : '≈'} ${fmtRoot(s)}`).join(' ou ');
}

// ---------- API ----------

// "3x - 9 = 0" → { variable, kind: 'values'|'none'|'all', values, text } ou null se não entender.
export function solve(text) {
  const toks = tokenize(text);
  if (!toks || toks.filter((t) => t.k === '=').length !== 1) return null;
  const eq = toks.findIndex((t) => t.k === '=');
  const vars = new Set();
  let L, R;
  try {
    L = compile(parse(toks.slice(0, eq), vars));
    R = compile(parse(toks.slice(eq + 1), vars));
  } catch {
    return null;
  }
  if (vars.size !== 1) return null;
  const [variable] = vars;
  const found = findRoots(L, R);
  if (found === 'all') return { variable, kind: 'all', values: [], text: describeSolution('all', [], variable) };
  const snaps = [];
  for (const r of found) {
    const s = snap(r);
    if (!snaps.some((q) => Math.abs(q.v - s.v) <= 1e-6 * Math.max(1, Math.abs(s.v)))) snaps.push(s);
  }
  const kind = snaps.length ? 'values' : 'none';
  return { variable, kind, values: snaps.map((s) => s.v), text: describeSolution(kind, snaps, variable), snaps };
}

const OPTIONS = {
  A: 'A declaração (1) sozinha é suficiente, mas a declaração (2) sozinha não é suficiente.',
  B: 'A declaração (2) sozinha é suficiente, mas a declaração (1) sozinha não é suficiente.',
  C: 'Ambas as declarações juntas são suficientes, mas nenhuma delas sozinha é suficiente.',
  D: 'Cada declaração sozinha é suficiente.',
  E: 'As declarações (1) e (2) juntas não são suficientes.',
};

const sufficient = (s) => s.kind === 'values' && s.values.length === 1;
const same = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));

function intersect(a, b) {
  if (a.kind === 'all') return b;
  if (b.kind === 'all') return a;
  const snaps = (a.snaps ?? []).filter((x) => (b.snaps ?? []).some((y) => same(x.v, y.v)));
  return { kind: snaps.length ? 'values' : 'none', values: snaps.map((s) => s.v), snaps };
}

function extractStatements(rest) {
  const body = rest.split(/\n\s*[A-E][.)]\s/)[0]; // as alternativas A–E ficam de fora
  const marks = [...body.matchAll(/(?<![\w)])\(\s*([1-9])\s*\)/g)];
  if (marks.length < 2) return [];
  return marks.map((m, i) => ({
    label: m[1],
    text: body.slice(m.index + m[0].length, marks[i + 1]?.index ?? body.length).trim().replace(/[.;,]+$/, ''),
  }));
}

function resolveStatements(question, stmts) {
  const sols = stmts.map((s) => solve(s.text));
  if (sols.some((s) => !s) || new Set(sols.map((s) => s.variable)).size !== 1) return null;
  const variable = sols[0].variable;
  const statements = stmts.map((s, i) => ({ label: s.label, text: s.text, kind: sols[i].kind, values: sols[i].values, answer: sols[i].text, sufficient: sufficient(sols[i]) }));
  const lines = statements.map((s) => `(${s.label}) ${s.text} → ${s.answer} → ${s.sufficient ? 'suficiente' : 'insuficiente'}`);
  const asksValue = new RegExp(`valor\\s+d[eo]\\s+${variable}\\b`, 'i').test(question);
  if (stmts.length !== 2 || !asksValue) return { variable, statements, together: null, letter: null, lines, complete: false };
  const [s1, s2] = statements;
  let letter;
  let together = null;
  if (s1.sufficient && s2.sufficient) letter = 'D';
  else if (s1.sufficient) letter = 'A';
  else if (s2.sufficient) letter = 'B';
  else {
    together = intersect(sols[0], sols[1]);
    letter = sufficient(together) ? 'C' : 'E';
    lines.push(`Juntas: ${describeSolution(together.kind, together.snaps ?? [], variable)} → ${sufficient(together) ? 'suficiente' : 'insuficiente'}`);
  }
  lines.push(`Resposta: ${letter} — ${OPTIONS[letter]}`);
  return { variable, statements, together, letter, lines, complete: true };
}

const ASKS_TO_SOLVE = /resolv|valor\s+d[eo]|encontr|calcul|determin|ra[ií]z|ra[ií]zes|solu[çc]/i;

function resolveSingle(question, rest) {
  if (!ASKS_TO_SOLVE.test(question)) return null;
  for (const m of `${question}\n${rest}`.matchAll(/[0-9a-zA-Z+\-*/^().,\s²³−×÷√]*=[0-9a-zA-Z+\-*/^().,\s²³−×÷√]*/g)) {
    const words = m[0].trim().split(/\s+/);
    for (let a = 0; a < words.length; a++) {
      for (let b = words.length; b > a; b--) { // tira palavras soltas antes/depois ("valor de x em 2x + 3 = 7")
        const cand = words.slice(a, b).join(' ');
        if (!cand.includes('=')) continue;
        const sol = solve(cand);
        if (sol) return { variable: sol.variable, statements: [], together: null, letter: null, lines: [`${cand} → ${sol.text}`], complete: true };
      }
    }
  }
  return null;
}

// Resolve o que dá para resolver em código. null = não entendi (o LLM assume).
export function resolve(question, rest = '') {
  const q = String(question);
  const r = String(rest);
  const stmts = extractStatements(r);
  return stmts.length >= 2 ? resolveStatements(q, stmts) : resolveSingle(q, r);
}
