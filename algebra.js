// Equações de uma variável e suficiência de dados (GMAT). Funções puras, sem eval.
// As raízes são achadas numericamente (varredura + bisseção + mínimo local) e verificadas na equação.

const FUNCS = { sqrt: Math.sqrt, abs: Math.abs };

// ---------- Leitura da equação ----------

function tokenize(text, splitVars = null) {
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
      else if (splitVars && [...low].every((ch) => splitVars.has(ch))) for (const ch of low) toks.push({ k: 'var', v: ch }); // xy = x·y
      else return null; // "Receita": não é uma variável só
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
    if (t.k === 'var') { vars.add(t.v); return { t: 'var', name: t.v }; }
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
    case 'var': return (x) => (typeof x === 'number' ? x : x[n.name]);
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

// "3x - 9 = 0" → { variable, L, R } ou null se não entender.
function compileEquation(text) {
  const toks = tokenize(text);
  if (!toks || toks.filter((t) => t.k === '=').length !== 1) return null;
  const eq = toks.findIndex((t) => t.k === '=');
  const vars = new Set();
  try {
    const L = compile(parse(toks.slice(0, eq), vars));
    const R = compile(parse(toks.slice(eq + 1), vars));
    return vars.size === 1 ? { variable: [...vars][0], L, R } : null;
  } catch {
    return null;
  }
}

// "3x - 9 = 0" → { variable, kind: 'values'|'none'|'all', values, text } ou null se não entender.
export function solve(text) {
  const c = compileEquation(text);
  if (!c) return null;
  const { variable } = c;
  const found = findRoots(c.L, c.R);
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

// Que tipo de conclusão uma alternativa da página expressa (A–E na convenção padrão)?
function optionKind(text) {
  const t = text.toLowerCase();
  if (/cada\b[^.]*sozinh/.test(t)) return 'D';
  if (/juntas?[^.]*suficientes?[^.]*(?:mas|por[ée]m)[^.]*nenhum/.test(t)) return 'C';
  if (/\(1\)[^.]*sozinh[ao][^.]*suficiente[^.]*(?:mas|por[ée]m)[^.]*\(2\)[^.]*n[ãa]o/.test(t)) return 'A';
  if (/\(2\)[^.]*sozinh[ao][^.]*suficiente[^.]*(?:mas|por[ée]m)[^.]*\(1\)[^.]*n[ãa]o/.test(t)) return 'B';
  if (/juntas?[^.]*n[ãa]o[^.]*suficientes?/.test(t)) return 'E';
  return null;
}

// A letra vem das alternativas da própria página (mesmo embaralhadas); sem as cinco, vale a convenção padrão.
function finalAnswer(kind, rest) {
  const found = {};
  for (const m of rest.matchAll(/^\s*([A-E])[.)]\s*(.+)$/gm)) {
    const k = optionKind(m[2]);
    if (k && !found[k]) found[k] = { letter: m[1], text: m[2].trim() };
  }
  const all = Object.keys(found).length === 5 && new Set(Object.values(found).map((o) => o.letter)).size === 5;
  const o = all ? found[kind] : { letter: kind, text: OPTIONS[kind] };
  return { letter: o.letter, line: `Resposta: ${o.letter} — ${o.text}`, text: o.text };
}

const sufficient = (s) => s.kind === 'values' && s.values.length === 1;
const same = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));

function intersect(a, b) {
  if (a.kind === 'all') return b;
  if (b.kind === 'all') return a;
  const snaps = (a.snaps ?? []).filter((x) => (b.snaps ?? []).some((y) => same(x.v, y.v)));
  return { kind: snaps.length ? 'values' : 'none', values: snaps.map((s) => s.v), snaps };
}

function extractStatements(rest) {
  // Corta antes das alternativas ("Alternativas padrão GMAT:", "A) ...").
  const body = rest.split(/\n\s*(?:(?:alternativas|op[çc][õo]es)\b[^\n]*|[A-E][.)]\s)/i)[0];
  const marks = [...body.matchAll(/(?<![\w)])\(\s*([1-9])\s*\)/g)];
  if (marks.length < 2) return [];
  return marks.map((m, i) => ({
    label: m[1],
    text: body.slice(m.index + m[0].length, marks[i + 1]?.index ?? body.length).trim().replace(/[.;,]+$/, ''),
  }));
}

// O texto tem cara de problema de suficiência de dados ((1), (2) e alternativas)? Serve para procurar a pergunta acima.
export function isDataSufficiencyShape(text) {
  const t = String(text);
  const body = `\n${t}`.split(/\n\s*(?:(?:alternativas|op[çc][õo]es)\b[^\n]*|[A-E][.)]\s)/i)[0];
  if ([...body.matchAll(/(?<![\w)])\(\s*[1-9]\s*\)/g)].length < 2) return false;
  const options = [...t.matchAll(/^\s*([A-E])[.)]\s*(.+)$/gm)].filter((m) => optionKind(m[2])).length;
  return options >= 3 || /suficien/i.test(t);
}

// Convenção padrão do GMAT: qual letra segue de "a afirmação basta sozinha?".
const dsKind = (s1, s2, together) => (s1 && s2 ? 'D' : s1 ? 'A' : s2 ? 'B' : together ? 'C' : 'E');

function resolveStatements(question, stmts, rest) {
  const sols = stmts.map((s) => solve(s.text));
  if (sols.some((s) => !s) || new Set(sols.map((s) => s.variable)).size !== 1) return null;
  const variable = sols[0].variable;
  const statements = stmts.map((s, i) => ({ label: s.label, text: s.text, kind: sols[i].kind, values: sols[i].values, answer: sols[i].text, sufficient: sufficient(sols[i]) }));
  const lines = statements.map((s) => `(${s.label}) ${s.text} → ${s.answer} → ${s.sufficient ? 'suficiente' : 'insuficiente'}`);
  const asksValue = new RegExp(`valor\\s+d[eo]\\s+${variable}\\b`, 'i').test(question);
  if (stmts.length !== 2 || !asksValue) return { variable, statements, together: null, letter: null, lines, complete: false };
  const [s1, s2] = statements;
  let together = null;
  if (!s1.sufficient && !s2.sufficient) {
    together = intersect(sols[0], sols[1]);
    lines.push(`Juntas: ${describeSolution(together.kind, together.snaps ?? [], variable)} → ${sufficient(together) ? 'suficiente' : 'insuficiente'}`);
  }
  const ans = finalAnswer(dsKind(s1.sufficient, s2.sufficient, together && sufficient(together)), rest);
  lines.push(ans.line);
  const why = (kind, values, text, ok) => (ok ? `dá ${text}, um único valor: basta.` : kind === 'none' ? 'não tem solução real: não basta.' : kind === 'all' ? 'vale para qualquer valor real: não basta.' : `dá ${text}, mais de um valor: não basta.`);
  const explanation = ['Resolvi cada equação em números reais.', ...statements.map((s) => `(${s.label}) ${s.text}: ${why(s.kind, s.values, s.answer, s.sufficient)}`)];
  if (together) explanation.push(`Juntas: ${sufficient(together) ? `dão ${describeSolution(together.kind, together.snaps ?? [], variable)}, um único valor: basta.` : `dão ${describeSolution(together.kind, together.snaps ?? [], variable)}: não basta.`}`);
  explanation.push(`Portanto: ${ans.text}`);
  return { variable, statements, together, letter: ans.letter, lines, explanation, complete: true };
}

// ---------- Inteiros: divisibilidade, paridade, primo, comparações (verificação por enumeração) ----------

const N1 = 5000; // uma variável: de 1 a 5000
const N2 = 100;  // duas variáveis: de 1 a 100 cada
const isInt = Number.isInteger;
const VERB = '(?:é|for|seja|possui|tem|têm)';
const IS_PRED = new RegExp(`\\s${VERB}\\s`);
const numDivisors = (n) => { if (!isInt(n) || n < 1) return NaN; let c = 0; for (let d = 1; d * d <= n; d++) if (n % d === 0) c += d * d === n ? 1 : 2; return c; };
const primeFactors = (n) => { if (!isInt(n) || n < 2) return 0; let c = 0; for (let d = 2; d * d <= n; d++) if (n % d === 0) { c++; while (n % d === 0) n /= d; } return c + (n > 1 ? 1 : 0); };
const isPrime = (n) => { if (!isInt(n) || n < 2) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; };
const REL = { '>': (a, b) => a > b, '<': (a, b) => a < b, '>=': (a, b) => a >= b, '≥': (a, b) => a >= b, '<=': (a, b) => a <= b, '≤': (a, b) => a <= b,
  '=': (a, b) => Math.abs(a - b) <= 1e-9 * (Math.abs(a) + Math.abs(b)) + 1e-12, '!=': (a, b) => a !== b, '≠': (a, b) => a !== b };

// Predicado sobre um número ("divisível por 3", "par", "> 2", "maior que 10"); null se não entender TUDO.
function parsePredicate(raw) {
  const s0 = raw.trim().toLowerCase().replace(/[.?;]+$/, '').trim();
  const parts = s0.split(/\s+e\s+/);
  if (parts.length > 1) {
    const ps = parts.map(parsePredicate);
    return ps.every(Boolean) ? (n) => ps.every((p) => p(n)) : null;
  }
  const s = s0.replace(new RegExp(`^(?:${VERB.slice(3, -1)}|era)\\s+`), '').replace(/^(?:um|uma)\s+/, '').replace(/^número\s+/, '');
  let m;
  if ((m = s.match(/^(?:divisível\s+por|múltiplo\s+de)\s+(\d+)$/))) { const k = Number(m[1]); return k > 0 ? (n) => isInt(n) && n % k === 0 : null; }
  if ((m = s.match(/^(?:exatamente\s+)?(\d+)\s+divisores(?:\s+positivos)?$/))) { const k = Number(m[1]); return (n) => numDivisors(n) === k; }
  if ((m = s.match(/^(?:divisível\s+por\s+)?exatamente\s+(\d+)\s+(?:números\s+|fatores\s+)?primos(?:\s+distintos)?$/)) || (m = s.match(/^(\d+)\s+(?:números\s+|fatores\s+)?primos\s+distintos$/))) { const k = Number(m[1]); return (n) => primeFactors(n) === k; }
  if (s === 'quadrado perfeito') return (n) => isInt(n) && n >= 0 && isInt(Math.sqrt(n));
  if (s === 'cubo perfeito') return (n) => isInt(n) && Math.round(Math.cbrt(n)) ** 3 === n;
  if (s === 'par') return (n) => isInt(n) && n % 2 === 0;
  if (s === 'ímpar') return (n) => isInt(n) && n % 2 !== 0;
  if (s === 'primo') return isPrime;
  if (s === 'inteiro') return isInt;
  if (s === 'positivo') return (n) => n > 0;
  if (s === 'negativo') return (n) => n < 0;
  if ((m = s.match(/^(maior|menor)\s+(ou\s+igual\s+)?(?:que|a|do\s+que)\s+(-?\d+)$/))) {
    const k = Number(m[3]);
    const big = m[1] === 'maior';
    return m[2] ? (big ? (n) => n >= k : (n) => n <= k) : (big ? (n) => n > k : (n) => n < k);
  }
  if ((m = s.match(/^(>=|≥|<=|≤|>|<|=|igual\s+a)\s*(-?\d+)$/))) {
    const k = Number(m[2]);
    const cmp = REL[m[1]] ?? REL['='];
    return (n) => cmp(n, k);
  }
  return null;
}

// Expressão aritmética nas variáveis permitidas → { fn(env), vars } ou null.
function compileExpr(text, allowed) {
  const toks = tokenize(text, allowed);
  if (!toks || !toks.length || toks.some((t) => t.k === '=')) return null;
  const vars = new Set();
  try {
    const fn = compile(parse(toks, vars));
    return [...vars].every((v) => allowed.has(v)) ? { fn, vars } : null;
  } catch {
    return null;
  }
}

// "x é divisível por 3", "x + y = 3", "x>y" → { fn(env), text } ou null.
function parseStatement(text, allowed) {
  const t = text.trim().replace(/[.;]+$/, '');
  const rel = t.match(/^(.+?)(>=|≥|<=|≤|!=|≠|=|>|<)(.+)$/);
  const isPred = IS_PRED.test(t);
  if (rel && !isPred) {
    const l = compileExpr(rel[1], allowed);
    const r = compileExpr(rel[3], allowed);
    if (!l || !r) return null;
    const cmp = REL[rel[2]];
    return { fn: (env) => { const a = l.fn(env); const b = r.fn(env); return Number.isFinite(a) && Number.isFinite(b) && cmp(a, b); }, text: `${rel[1].trim()} ${rel[2]} ${rel[3].trim()}` };
  }
  const m = t.match(new RegExp(`^(.+?)\\s+${VERB}\\s+(.+)$`));
  if (!m) return null;
  const subj = compileExpr(m[1], allowed);
  const pred = parsePredicate(m[2]);
  if (!subj || !pred) return null;
  return { fn: (env) => { const v = subj.fn(env); return Number.isFinite(v) && pred(v); }, text: t };
}

// O sujeito da pergunta ("x−y é divisível por 6"): o maior trecho de expressão logo antes de " é ".
function parseAsk(clause, allowed) {
  const t = clause.trim();
  const rel = parseStatement(t, allowed);
  if (rel && !IS_PRED.test(t)) return rel;
  for (const m of [...t.matchAll(new RegExp(`\\s+${VERB}\\s+`, 'g'))].reverse()) {
    const pred = parsePredicate(t.slice(m.index + m[0].length));
    if (!pred) continue;
    const words = t.slice(0, m.index).split(/\s+/);
    let best = null;
    for (let k = words.length - 1; k >= 0; k--) {
      const c = compileExpr(words.slice(k).join(' '), allowed);
      if (!c) break;
      best = c;
    }
    if (best && best.vars.size) return { fn: (env) => { const v = best.fn(env); return Number.isFinite(v) && pred(v); }, text: t };
  }
  return null;
}

function resolveIntegers(question, stmts, rest) {
  const q = question;
  if (!/inteir/i.test(q) || /n[ãa]o\s+(?:negativ|positiv)/i.test(q) || /natura/i.test(q) || /\breais?\b/i.test(q)) return null;
  const domain = /inteiros?\s+positivos?/i.test(q) ? 'pos' : /inteiros?\s+negativos?/i.test(q) ? 'neg' : 'int';
  const letters = [...new Set([...q.matchAll(/(?<![\p{L}\d_])[a-z](?![\p{L}\d_])/gu)].map((m) => m[0]))].filter((c) => !['a', 'e', 'o'].includes(c));
  if (letters.length < 1 || letters.length > 2 || stmts.length !== 2) return null;
  const allowed = new Set(letters);
  const clauses = q.replace(/\?+\s*$/, '').split(/\s*,\s*/).map((c) => c.trim().replace(/^ent[ãa]o\s+/i, '')).filter(Boolean);
  const last = clauses.at(-1);
  // restrições entre o domínio e a pergunta ("x>y"): se não entendo alguma, não decido.
  const constraints = [];
  for (const c of clauses.slice(1, -1)) {
    const p = parseStatement(c, allowed);
    if (!p) return null;
    constraints.push(p);
  }
  const valueVar = last.match(/valor\s+d[eo]\s+([a-z])\b/i)?.[1]?.toLowerCase();
  let asks = null;
  if (valueVar) { if (!allowed.has(valueVar)) return null; }
  else { asks = parseAsk(last, allowed); if (!asks) return null; }
  const preds = stmts.map((s) => parseStatement(s.text, allowed));
  if (preds.some((p) => !p)) return null;

  const limit = letters.length === 1 ? N1 : N2;
  const lo = domain === 'pos' ? 1 : -limit;
  const hi = domain === 'neg' ? -1 : limit;
  const range = []; for (let n = lo; n <= hi; n++) range.push(n);
  const envs = function* () {
    if (letters.length === 1) for (const a of range) yield { [letters[0]]: a };
    else for (const a of range) for (const b of range) yield { [letters[0]]: a, [letters[1]]: b };
  };
  const show = (env) => letters.map((v) => `${v} = ${env[v]}`).join(', ');

  const check = (p) => {
    let count = 0, yes, no;
    const vals = new Set();
    for (const env of envs()) {
      if (!constraints.every((c) => c.fn(env)) || !p(env)) continue;
      count++;
      if (valueVar) vals.add(env[valueVar]);
      else if (asks.fn(env)) yes ??= { env, order: count }; else no ??= { env, order: count };
    }
    if (!count) return null; // afirmação impossível no domínio: não decido
    if (valueVar) {
      const list = [...vals];
      return list.length === 1 ? { ok: true, text: `${valueVar} = ${list[0]}` } : { ok: false, text: `${list.slice(0, 3).map((x) => `${valueVar} = ${x}`).join(', ')}${list.length > 3 ? ', …' : ''}` };
    }
    if (!yes || !no) return { ok: true, text: yes ? 'sempre sim' : 'sempre não' };
    const w = [[no, 'não'], [yes, 'sim']].sort((a, b) => a[0].order - b[0].order);
    return { ok: false, text: w.map(([x, r]) => `${show(x.env)}: ${r}`).join('; ') };
  };
  const rs = preds.map((p) => check(p.fn));
  if (rs.some((r) => !r)) return null;
  const label = (r) => (r.ok ? `${r.text} → suficiente` : `insuficiente (${r.text})`);
  const what = domain === 'pos' ? 'inteiros positivos' : domain === 'neg' ? 'inteiros negativos' : 'inteiros';
  const cons = constraints.map((c) => `, ${c.text}`).join('');
  const span = `de ${lo} a ${hi}${letters.length === 1 ? '' : ' para cada variável'}`;
  const lines = [`Domínio: ${what}${cons} (verificado ${span}).`, ...stmts.map((s, i) => `(${s.label}) ${s.text} → ${label(rs[i])}`)];
  let together = null;
  if (!rs[0].ok && !rs[1].ok) {
    together = check((env) => preds[0].fn(env) && preds[1].fn(env));
    if (!together) return null;
    lines.push(`Juntas: ${stmts[0].text} e ${stmts[1].text} → ${label(together)}`);
  }
  const ans = finalAnswer(dsKind(rs[0].ok, rs[1].ok, together?.ok), rest);
  lines.push(ans.line);
  const why = (r) => {
    if (valueVar) return r.ok ? `só existe um valor possível (${r.text}): basta.` : `há mais de um valor possível (${r.text}): não basta.`;
    return r.ok ? `a resposta é ${r.text.replace('sempre ', 'sempre "')}" em todos os casos verificados: basta.` : `há casos com respostas diferentes (${r.text}): não basta.`;
  };
  const withCons = constraints.length ? `${what} (com ${constraints.map((c) => c.text).join(' e ')})` : what;
  const explanation = [`Conferi por enumeração os ${withCons} ${span}.`, ...stmts.map((s, i) => `(${s.label}) ${s.text}: ${why(rs[i])}`)];
  if (together) explanation.push(`Juntas: ${stmts[0].text} e ${stmts[1].text}: ${why(together)}`);
  explanation.push(`Portanto: ${ans.text}`);
  return { variable: letters.join(','), statements: stmts.map((s, i) => ({ label: s.label, text: s.text, sufficient: rs[i].ok })), together, letter: ans.letter, lines, explanation, complete: true };
}

// ---------- Equação única ----------

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
  if (stmts.length < 2) return resolveSingle(q, r);
  // "inteiro", "positivo"...: o domínio muda a resposta (n² = 9 ⇒ n = 3), então a enumeração assume.
  return /inteir|natura|positiv|negativ/i.test(q) ? resolveIntegers(q, stmts, r) : resolveStatements(q, stmts, r);
}
