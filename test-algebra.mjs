import assert from 'node:assert/strict';
import { solve, resolve, isDataSufficiencyShape } from './algebra.js';

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


// ---- propriedades de números inteiros (divisibilidade, paridade, primo, comparações) ----
const QN = 'Um número inteiro positivo n é divisível por 6?';
const OPTS = `Alternativas padrão GMAT:
A) A afirmação (1) sozinha é suficiente, mas (2) sozinha não é.
B) A afirmação (2) sozinha é suficiente, mas (1) sozinha não é.
C) As duas afirmações juntas são suficientes, mas nenhuma sozinha é suficiente.
D) Cada afirmação sozinha é suficiente.
E) Mesmo juntas, as afirmações não são suficientes.`;
const n1 = resolve(QN, `(1) n é divisível por 3.\n(2) n é par.\n${OPTS}`);   // o caso reportado
assert.equal(n1.letter, 'C');
assert.equal(n1.complete, true);
assert.deepEqual(n1.lines, [
  'Domínio: inteiros positivos (verificado de 1 a 5000).',
  '(1) n é divisível por 3 → insuficiente (n = 3: não; n = 6: sim)',
  '(2) n é par → insuficiente (n = 2: não; n = 6: sim)',
  'Juntas: n é divisível por 3 e n é par → sempre sim → suficiente',
  'Resposta: C — As duas afirmações juntas são suficientes, mas nenhuma sozinha é suficiente.',
]);
assert.equal(resolve(QN, '(1) n é divisível por 3\n(2) n é ímpar').letter, 'B');          // ímpar ⇒ nunca divisível por 6
assert.equal(resolve(QN, '(1) n é múltiplo de 12\n(2) n é par').letter, 'A');
assert.equal(resolve(QN, '(1) n é divisível por 12\n(2) n é múltiplo de 18').letter, 'D');
assert.equal(resolve(QN, '(1) n é par\n(2) n é maior que 10').letter, 'E');
assert.equal(resolve('Se n é um inteiro positivo, qual é o valor de n?', '(1) n^2 = 9\n(2) n > 2').letter, 'A'); // no domínio inteiro positivo, n² = 9 ⇒ n = 3
assert.equal(resolve('Se x é um inteiro, qual é o valor de x?', '(1) x^2 = 9\n(2) x > 0').letter, 'C');
assert.equal(resolve('Um inteiro positivo p é primo?', '(1) p é par\n(2) p > 2').letter, 'C');   // par e > 2 ⇒ nunca primo
assert.equal(resolve('Um inteiro positivo n é par?', '(1) n é divisível por 4\n(2) n = 7').letter, 'D');
assert.match(resolve('Se x é um inteiro, qual é o valor de x?', '(1) x^2 = 9\n(2) x > 0').lines.join('|'), /x = 3/);
// não entende tudo → null (o LLM assume, nunca uma resposta confiante errada)
assert.equal(resolve(QN, '(1) n é um número triangular\n(2) n é par'), null);
assert.equal(resolve(QN, '(1) n é divisível por 3 ou por 5\n(2) n é par'), null);
assert.equal(resolve('Um número positivo n é divisível por 6?', '(1) n é divisível por 3\n(2) n é par'), null);  // "positivo" sem "inteiro": domínio real
assert.equal(resolve('Um número natural n é par?', '(1) n é divisível por 4\n(2) n = 7'), null);                // "natural" é ambíguo (0?)
// as letras vêm das alternativas da própria página (mesmo embaralhadas)
const shuffled = `(1) n é divisível por 3\n(2) n é par\nA) Cada afirmação sozinha é suficiente.\nB) Mesmo juntas, as afirmações não são suficientes.\nC) As duas afirmações juntas são suficientes, mas nenhuma sozinha é suficiente.\nD) A afirmação (1) sozinha é suficiente, mas (2) sozinha não é.\nE) A afirmação (2) sozinha é suficiente, mas (1) sozinha não é.`;
assert.equal(resolve(QN, shuffled).letter, 'C');
assert.equal(resolve(QN, shuffled.replace('C) As duas', 'X) As duas').replace('D) A afirmação (1)', 'C) A afirmação (1)')).letter, 'C'); // alternativas incompletas: convenção padrão
const shuf2 = `(1) n é divisível por 12\n(2) n é par\nA) Cada afirmação sozinha é suficiente.\nB) Mesmo juntas, as afirmações não são suficientes.\nC) As duas afirmações juntas são suficientes, mas nenhuma sozinha é suficiente.\nD) A afirmação (1) sozinha é suficiente, mas (2) sozinha não é.\nE) A afirmação (2) sozinha é suficiente, mas (1) sozinha não é.`;
const s2 = resolve(QN, shuf2);
assert.equal(s2.letter, 'D');                                                    // (1) sozinha basta ⇒ a página chama isso de D
assert.ok(s2.lines.at(-1).startsWith('Resposta: D — A afirmação (1) sozinha é suficiente'), s2.lines.at(-1));
// a linha "Alternativas..." não contamina a afirmação (2)
assert.equal(resolve('Se x é um número real, qual é o valor de x?', '(1) 3x - 9 = 0\n(2) x^2 = 9\nAlternativas padrão GMAT:\nA) A afirmação (1) sozinha é suficiente, mas (2) sozinha não é.').letter, 'A');


// ---- duas variáveis inteiras (o caso reportado: x − y divisível por 6) ----
const Q2 = 'Se x e y são números inteiros positivos, x>y, então x−y é divisível por 6?';
const OPT5 = `A) A afirmação (1) sozinha é suficiente, mas (2) sozinha não é.
B) A afirmação (2) sozinha é suficiente, mas (1) sozinha não é.
C) As duas afirmações juntas são suficientes, mas nenhuma sozinha é suficiente.
D) Cada afirmação sozinha é suficiente.
E) Mesmo juntas, as afirmações não são suficientes.`;
const two = resolve(Q2, `(1) x é divisível por 3.\n(2) y é divisível por 2.\n${OPT5}`);
assert.equal(two.letter, 'E');
assert.equal(two.complete, true);
assert.match(two.lines[0], /^Domínio: inteiros positivos, x > y \(verificado de 1 a 100 para cada variável\)\.$/);
assert.match(two.lines[1], /^\(1\) x é divisível por 3 → insuficiente \(x = 3, y = 1: não; x = 9, y = 3: sim\)$/);
assert.match(two.lines[2], /^\(2\) y é divisível por 2 → insuficiente \(/);
assert.match(two.lines[3], /^Juntas: x é divisível por 3 e y é divisível por 2 → insuficiente \(/);
assert.equal(two.lines[4], 'Resposta: E — Mesmo juntas, as afirmações não são suficientes.');
assert.equal(resolve('Se x e y são números inteiros positivos, então x+y é par?', '(1) x é par\n(2) y é par').letter, 'C');   // par + par
assert.equal(resolve('Se x e y são inteiros positivos, xy é ímpar?', '(1) x é ímpar\n(2) y é ímpar').letter, 'C');           // "xy" = x·y
assert.equal(resolve('Se x e y são inteiros positivos, x>y, então x−y é positivo?', '(1) x = 5\n(2) y = 2').letter, 'D');     // a restrição x > y já basta em cada uma
assert.equal(resolve('Se x e y são inteiros positivos, então x/y é um inteiro?', '(1) x = 6\n(2) y = 3').letter, 'C');
assert.equal(resolve('Se x e y são inteiros positivos, qual é o valor de x?', '(1) x + y = 3\n(2) x > y').letter, 'C');       // valor de x com duas variáveis
assert.equal(resolve('Se x e y são inteiros positivos, então x+y é par?', '(1) x é par\n(2) z é par'), null);                 // variável fora do enunciado
assert.equal(resolve('Se x, y e z são inteiros positivos, então x+y+z é par?', '(1) x é par\n(2) y é par'), null);            // 3 variáveis: não decido
assert.equal(resolve('Se x e y são inteiros positivos, então x+y é par?', '(1) x é par\n(2) y é triangular'), null);


// ---- novas propriedades: divisores, primos distintos, quadrado/cubo perfeito ----
assert.equal(resolve('Um inteiro positivo n é um quadrado perfeito?', '(1) n possui exatamente 3 divisores positivos\n(2) n é par').letter, 'A'); // 3 divisores ⇒ p²
assert.equal(resolve('Um inteiro positivo n é divisível por 12?', '(1) n possui exatamente 6 divisores positivos.\n(2) n é divisível por exatamente 2 números primos distintos.').letter, 'E');
assert.equal(resolve('Um inteiro positivo n é ímpar?', '(1) n é um cubo perfeito\n(2) n é um quadrado perfeito').letter, 'E');
assert.equal(resolve('Um inteiro positivo n é primo?', '(1) n tem exatamente 2 divisores positivos\n(2) n é par').letter, 'A');
assert.equal(resolve('Um inteiro positivo n é um quadrado perfeito?', '(1) n possui exatamente 7 divisores\n(2) n é ímpar').letter, 'A');    // 7 divisores ⇒ p⁶ ⇒ quadrado perfeito
// ---- forma de "suficiência de dados" (para saber quando procurar a pergunta acima da seleção) ----
const OPT = 'A) A afirmação (1) sozinha é suficiente, mas (2) sozinha não é.\nB) A afirmação (2) sozinha é suficiente, mas (1) sozinha não é.\nC) As duas afirmações juntas são suficientes, mas nenhuma sozinha é suficiente.\nD) Cada afirmação sozinha é suficiente.\nE) Mesmo juntas, as afirmações não são suficientes.';
assert.equal(isDataSufficiencyShape(`(1) n possui exatamente 6 divisores positivos.\n(2) n é divisível por exatamente 2 números primos distintos.\n${OPT}`), true);
assert.equal(isDataSufficiencyShape('(1) 3x - 9 = 0\n(2) x^2 = 9\nAs duas juntas são suficientes'), true);
assert.equal(isDataSufficiencyShape('(1) n é par\n(2) n é primo'), false);              // sem alternativas nem "suficiente": não arrisco
assert.equal(isDataSufficiencyShape('Receita 1500 e custo 900'), false);
assert.equal(isDataSufficiencyShape(OPT), false);                                        // alternativas sozinhas, sem afirmações

console.log('OK: todos os testes de algebra.js passaram');
