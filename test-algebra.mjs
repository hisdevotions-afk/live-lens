import assert from 'node:assert/strict';
import { solve, resolve } from './algebra.js';

const v = (t) => { const r = solve(t); return r && r.kind === 'values' ? r.values.map((x) => Math.round(x * 1e6) / 1e6) : r && r.kind; };
const txt = (t) => solve(t)?.text;

// ---- solve: equações de uma variável ----
assert.deepEqual(v('3x - 9 = 0'), [3]);
assert.deepEqual(v('x^2 = 9'), [-3, 3]);
assert.deepEqual(v('x² = 9'), [-3, 3]);
assert.deepEqual(v('3x − 9 = 0'), [3]);                      // menos unicode
assert.deepEqual(v('x/(3x - 9) = 0'), [0]);                  // o polo em x = 3 não é solução
assert.deepEqual(v('(x)/(3x - 9) = 0'), [0]);
assert.deepEqual(v('x^2/9 = 9'), [-9, 9]);
assert.deepEqual(v('x^2 = 0'), [0]);                         // raiz dupla
assert.deepEqual(v('(x - 1/3)^2 = 0'), [0.333333]);          // raiz dupla fora da grade
assert.equal(v('x^2 + 1 = 0'), 'none');
assert.equal(v('x = x'), 'all');
assert.equal(v('1/x = 0'), 'none');                          // só há polo
assert.deepEqual(v('2(x + 1) = 8'), [3]);                    // multiplicação implícita
assert.deepEqual(v('(x - 1)(x + 2) = 0'), [-2, 1]);
assert.deepEqual(v('x^2 - 5x + 6 = 0'), [2, 3]);
assert.deepEqual(v('2x + 3 = 4'), [0.5]);
assert.deepEqual(v('0,5x = 2'), [4]);                        // vírgula decimal
assert.deepEqual(v('0.5x = 2'), [4]);
assert.deepEqual(v('x^3 = 8'), [2]);
assert.deepEqual(v('sqrt(x) = 3'), [9]);
assert.deepEqual(v('√x = 3'), [9]);
assert.deepEqual(v('abs(x) = 3'), [-3, 3]);
assert.deepEqual(v('3·x = 9'), [3]);
assert.deepEqual(v('2×x = 6'), [3]);
assert.deepEqual(v('6 ÷ x = 2'), [3]);
assert.deepEqual(v('x/1000 = 5000'), [5000000]);             // fora da faixa densa
assert.deepEqual(v('x = -250000'), [-250000]);
assert.deepEqual(v('-x^2 = -9'), [-3, 3]);                   // -x^2 = -(x^2)
assert.deepEqual(v('2x^2 = 8'), [-2, 2]);
// texto
assert.equal(txt('3x - 9 = 0'), 'x = 3');
assert.equal(txt('x^2 = 9'), 'x = -3 ou x = 3');
assert.equal(txt('2x + 3 = 4'), 'x = 1/2');
assert.equal(txt('x^2 = 2'), 'x ≈ -1,4142 ou x ≈ 1,4142');
assert.equal(txt('x^2 + 1 = 0'), 'nenhum valor real de x');
assert.equal(txt('x = x'), 'qualquer valor real de x');
// não entende → null (o LLM assume)
for (const t of ['x + y = 3', '3 = 3', 'x é positivo', 'x > 0', 'x^2 = 9 e y = 2', 'Receita = 100', '3x - 9', '', 'x = = 3', '(x + 1 = 3', 'xy = 6']) assert.equal(solve(t), null, t);

// ---- resolve: suficiência de dados (GMAT) ----
const Q = 'Se x é um número real, qual é o valor de x?';
const r1 = resolve(Q, '1.\n(1) 3x - 9 = 0\n(2) x^2 = 9');
assert.equal(r1.letter, 'A');
assert.equal(r1.complete, true);
assert.equal(r1.variable, 'x');
assert.deepEqual(r1.statements.map((s) => [s.label, s.sufficient, s.answer]), [['1', true, 'x = 3'], ['2', false, 'x = -3 ou x = 3']]);
assert.deepEqual(r1.lines, [
  '(1) 3x - 9 = 0 → x = 3 → suficiente',
  '(2) x^2 = 9 → x = -3 ou x = 3 → insuficiente',
  'Resposta: A — A declaração (1) sozinha é suficiente, mas a declaração (2) sozinha não é suficiente.',
]);
const withOptions = resolve(Q, '(1) 3x - 9 = 0\n(2) x^2 = 9\nA. A declaração (1) sozinha é suficiente, mas a declaração (2) sozinha não é suficiente.\nB. A declaração (2) sozinha é suficiente, mas a declaração (1) sozinha não é suficiente.');
assert.equal(withOptions.letter, 'A');
assert.equal(resolve(Q, '(1) x^2 = 9 (2) x^3 = 27').letter, 'B');
assert.equal(resolve(Q, '(1) 2x = 6\n(2) 3x = 9').letter, 'D');
assert.equal(resolve(Q, '(1) x^2 = 9\n(2) x^2 = 4').letter, 'E');                 // juntas: contradição
assert.equal(resolve(Q, '(1) x^2 = 9\n(2) x^2 = 9').letter, 'E');
assert.equal(resolve(Q, '(1) x^2 = 9\n(2) (x - 3)(x - 5) = 0').letter, 'C');    // {±3} ∩ {3, 5} = {3}
assert.equal(resolve(Q, '(1) (x - 3)(x + 3) = 0 (2) x + 3 = 6').letter, 'B');
assert.equal(resolve('Qual é o valor de x?', '(1) x/(3x - 9) = 0 (2) x^2/9 = 9').letter, 'A');
const c = resolve(Q, '(1) x^2 = 9\n(2) (x - 3)(x - 5) = 0');
assert.ok(c.lines.some((l) => l.startsWith('Juntas: x = 3')), c.lines.join(' | '));
// não dá para decidir → null
assert.equal(resolve(Q, '(1) x + y = 3\n(2) x = 1'), null);
assert.equal(resolve(Q, '(1) x é positivo\n(2) x^2 = 9'), null);
assert.equal(resolve(Q, '(1) x > 0\n(2) x^2 = 9'), null);
assert.equal(resolve('Qual a receita total?', 'Ana 10\nBruno 20'), null);
assert.equal(resolve(Q, ''), null);
// sem afirmações: equação única, só quando a pergunta pede para resolver/achar
const s1 = resolve('Qual é o valor de x em 2x + 3 = 7?', '');
assert.equal(s1.complete, true); assert.equal(s1.letter, null); assert.deepEqual(s1.lines, ['2x + 3 = 7 → x = 2']);
assert.equal(resolve('Resolva 2x + 3 = 7', '').lines[0], '2x + 3 = 7 → x = 2');
assert.equal(resolve('Se a = 5, o que acontece?', ''), null);                     // não pede para resolver
assert.equal(resolve('Receita = 100. Qual o valor?', ''), null);

console.log('OK: todos os testes de algebra.js passaram');
