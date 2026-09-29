import assert from 'node:assert/strict';
import {
  detectLocale, parseNumber, extractNumbers, describe,
  tableColumns, summarize, delta, changedEnough, isQuestion, calc, splitQuestion, cleanMath, looksLikeMath,
} from './stats.js';

// detectLocale
assert.equal(detectLocale('Total 1.234,56', 'en'), 'pt');
assert.equal(detectLocale('Total 1,234.56', 'pt-BR'), 'en');
assert.equal(detectLocale('Total 12', 'pt-BR'), 'pt');
assert.equal(detectLocale('Total 12', ''), 'en');

// parseNumber: separadores
assert.equal(parseNumber('1.234,56', 'pt'), 1234.56);
assert.equal(parseNumber('1,234.56', 'en'), 1234.56);
assert.equal(parseNumber('1.234.567', 'en'), 1234567);   // repetido = milhar
assert.equal(parseNumber('1,5', 'en'), 1.5);             // 1 dígito = decimal
assert.equal(parseNumber('1.234', 'pt'), 1234);          // ambíguo, pt
assert.equal(parseNumber('1.234', 'en'), 1.234);         // ambíguo, en
assert.equal(parseNumber('1,234', 'pt'), 1.234);
assert.equal(parseNumber('1,234', 'en'), 1234);
assert.equal(parseNumber('42', 'pt'), 42);
// moeda, sinal, parênteses, sufixos
assert.equal(parseNumber('R$ 1.234,56', 'pt'), 1234.56);
assert.equal(parseNumber('US$ 10', 'en'), 10);
assert.equal(parseNumber('-5', 'pt'), -5);
assert.equal(parseNumber('−5', 'pt'), -5);
assert.equal(parseNumber('(1.200)', 'pt'), -1200);
assert.equal(parseNumber('12,5%', 'pt'), 12.5);
assert.equal(parseNumber('1,5k', 'pt'), 1500);
assert.equal(parseNumber('3 mi', 'pt'), 3e6);
assert.equal(parseNumber('2 milhões', 'pt'), 2e6);
assert.equal(parseNumber('2B', 'en'), 2e9);
assert.equal(parseNumber('abc', 'pt'), null);
assert.equal(parseNumber('', 'pt'), null);

// extractNumbers
assert.deepEqual(extractNumbers('Receita R$ 1.234,56 e custo R$ 200,00.', 'pt'), [1234.56, 200]);
assert.deepEqual(extractNumbers('Em 29/09/2026 às 14:30 vendemos 15 unidades', 'pt'), [15]);
assert.deepEqual(extractNumbers('Q3 cresceu 12% (antes 10%)', 'pt'), [12, 10]);
assert.deepEqual(extractNumbers('Perda (500) no mês', 'pt'), [-500]);
assert.deepEqual(extractNumbers('3 milhas', 'pt'), [3]);  // "mi" não é sufixo aqui
assert.deepEqual(extractNumbers('sem números aqui', 'pt'), []);

// describe
assert.equal(describe([]), null);
const d1 = describe([7]);
assert.deepEqual(d1, { n: 1, sum: 7, mean: 7, median: 7, min: 7, max: 7, stdev: 0, outliers: [] });
const d2 = describe([1, 2, 3, 4]);
assert.equal(d2.sum, 10);
assert.equal(d2.mean, 2.5);
assert.equal(d2.median, 2.5);
assert.ok(Math.abs(d2.stdev - 1.2909944) < 1e-6);
assert.deepEqual(d2.outliers, []);
assert.deepEqual(describe([10, 11, 12, 13, 100]).outliers, [100]);
assert.deepEqual(describe([1, 2, 100]).outliers, []);    // n < 4: sem outliers

// tableColumns
const withHeader = [
  ['Produto', 'Qtd', 'Receita'],
  ['A', '10', 'R$ 1.000,00'],
  ['B', '20', 'R$ 2.500,50'],
  ['C', '', 'R$ 500,00'],
];
const cols = tableColumns(withHeader, 'pt');
assert.deepEqual(cols.map((c) => c.name), ['Qtd', 'Receita']);
assert.equal(cols[0].stats.sum, 30);
assert.equal(cols[1].stats.sum, 4000.5);
const noHeader = [['1', 'x'], ['2', 'y'], ['3', 'z']];
const cols2 = tableColumns(noHeader, 'pt');
assert.deepEqual(cols2.map((c) => c.name), ['Coluna 1']);
assert.equal(cols2[0].stats.sum, 6);
assert.deepEqual(tableColumns([], 'pt'), []);
assert.deepEqual(tableColumns(null, 'pt'), []);

// summarize
const s1 = summarize({ text: 'KPI: 1.234,5', table: null, lang: 'pt-BR' });
assert.equal(s1.locale, 'pt');
assert.equal(s1.primary, 1234.5);
assert.equal(s1.groups[0].name, 'Números');
const s2 = summarize({ text: 'x', table: withHeader, lang: 'pt' });
assert.equal(s2.groups.length, 2);
assert.equal(s2.primary, 30);
const s3 = summarize({ text: 'só texto', table: null, lang: '' });
assert.deepEqual(s3.groups, []);
assert.equal(s3.primary, null);
// tabela sem colunas numéricas cai para o texto
const s4 = summarize({ text: 'a 5 b 7', table: [['a', 'b']], lang: 'pt' });
assert.equal(s4.primary, 12);

// delta / changedEnough
assert.deepEqual(delta(100, 110), { abs: 10, pct: 10 });
assert.deepEqual(delta(0, 5), { abs: 5, pct: null });
assert.deepEqual(delta(-100, -50), { abs: 50, pct: 50 });
assert.equal(changedEnough(null, 5), true);
assert.equal(changedEnough(100, 100.5), false);
assert.equal(changedEnough(100, 102), true);
assert.equal(changedEnough(0, 0), false);
assert.equal(changedEnough(0, 1), true);


// --- correções da revisão final ---
// I1: datas MM/AAAA e ISO não viram números; coluna de mês some
assert.deepEqual(extractNumbers('12/2025', 'pt'), []);
assert.deepEqual(extractNumbers('Em 2026-09-29 vendemos 15', 'pt'), [15]);
assert.deepEqual(
  tableColumns([['Mês', 'Receita'], ['01/2025', '1.000'], ['02/2025', '2.000']], 'pt').map((c) => c.name),
  ['Receita'],
);
// I2: cabeçalho de anos só é cabeçalho se o snapshot disser (header=true); sem a dica, cai na heurística
const yearTable = [['Produto', '2024', '2025'], ['A', '1.000', '2.000'], ['B', '3.000', '4.000']];
const yc = tableColumns(yearTable, 'pt', true);
assert.deepEqual(yc.map((c) => [c.name, c.stats.sum]), [['2024', 4000], ['2025', 6000]]);
assert.equal(summarize({ text: 'x', table: yearTable, header: true, lang: 'pt' }).groups[0].stats.sum, 4000);
assert.deepEqual(tableColumns([['1', 'x'], ['2', 'y']], 'pt', false).map((c) => c.stats.n), [2]); // header=false: 1ª linha é dado
// I3: R$ é pt mesmo sem lang; locale pode ser forçado (o pin mantém o locale do 1º snapshot)
assert.equal(detectLocale('R$ 1.500', ''), 'pt');
assert.equal(detectLocale('R$ 1.500', 'en'), 'pt');
assert.equal(summarize({ text: 'R$ 1.500', table: null, lang: '' }).primary, 1500);
assert.equal(summarize({ text: '1.500', table: null, lang: 'en' }, 'pt').primary, 1500);
assert.equal(summarize({ text: '1.500', table: null, lang: 'en' }, 'pt').locale, 'pt');


// --- modo pergunta ---
// isQuestion: só perguntas curtas; frase comum que começa com "Como" não conta
for (const q of ['Qual a receita total?', 'quanto é 15% de R$ 1.234,56?', 'Qual produto vende mais', 'Por que a receita caiu',
  'O que significa esse número?', 'Receita subiu?', 'Quanto é R$ 1.234,56', '"A receita caiu?"']) assert.equal(isQuestion(q), true, q);
for (const q of ['', '   ', 'Receita total R$ 1.234,56', 'Como resultado, a receita subiu 10%.', 'Qual a receita. Depois somamos.',
  'a'.repeat(400) + '?', 'linha 1\nlinha 2\nlinha 3?', 'Qual ' + 'x'.repeat(200)]) assert.equal(isQuestion(q), false, q);

// calc: conta feita em código (sem eval)
const near = (a, b) => Math.abs(a - b) < 1e-9;
let c = calc('quanto é 15% de R$ 1.234,56?');
assert.ok(c && near(c.value, 185.184) && c.expr === '15% de R$ 1.234,56', JSON.stringify(c));
assert.equal(calc('Quanto é 20% de 50?').value, 10);
assert.equal(calc('Quanto é 10 + 5 * 2?').value, 20);            // precedência
assert.equal(calc('(100 - 20) / 4').value, 20);
assert.equal(calc('12,5 x 4').value, 50);
assert.equal(calc('3 × 4').value, 12);
assert.equal(calc('R$ 1.000 - R$ 250').value, 750);
assert.equal(calc('quanto é 1,5k + 500?').value, 2000);
assert.equal(calc('quanto é 10/4?').value, 2.5);
assert.ok(near(calc('1.234,56 + 10').value, 1244.56));
assert.equal(calc('10 ÷ 4').value, 2.5);
assert.equal(calc('Quanto é 15% de 200 + 10?'), null);   // conta composta com %: não calcula pela metade
assert.equal(calc('15% de 200 e mais 10?').value, 30);
for (const q of ['Qual a receita?', 'quanto é 10/0?', 'receita em 29/09/2026?', 'em 12/2025?', 'vendas de 98765-4321?',
  'máximo de 5?', '2 xícaras de 3?', '2 + ', '(2 + 3', '']) assert.equal(calc(q), null, q);


// splitQuestion: pergunta sozinha, ou pergunta + dados na mesma seleção
assert.deepEqual(splitQuestion('Qual a receita?'), { question: 'Qual a receita?', rest: '' });
assert.deepEqual(splitQuestion('Qual produto vende mais'), { question: 'Qual produto vende mais', rest: '' });
assert.deepEqual(splitQuestion('Produto\tQtd\nA\t10\nB\t20\nQual produto vende mais?'),
  { question: 'Qual produto vende mais?', rest: 'Produto\tQtd\nA\t10\nB\t20' });
assert.deepEqual(splitQuestion('Qual produto vende mais?\nA 10\nB 20'), { question: 'Qual produto vende mais?', rest: 'A 10\nB 20' });
assert.deepEqual(splitQuestion('Receita em março: R$ 1.500,00. Em abril: R$ 980,00. Qual mês vendeu mais?'),
  { question: 'Qual mês vendeu mais?', rest: 'Receita em março: R$ 1.500,00. Em abril: R$ 980,00.' });
assert.deepEqual(splitQuestion('  Ana\t10\n\nQuanto é o total?  \n'), { question: 'Quanto é o total?', rest: 'Ana\t10' });
assert.equal(splitQuestion('Receita total R$ 1.234,56'), null);
assert.equal(splitQuestion('Como resultado, a receita subiu 10%.'), null);
assert.equal(splitQuestion('linha 1\nlinha 2\nlinha 3'), null);
assert.equal(splitQuestion(''), null);
assert.equal(splitQuestion('dados\n' + 'q'.repeat(400) + '?'), null);              // "pergunta" longa demais não conta
assert.equal(splitQuestion('x'.repeat(5000) + '\nQual o maior?').rest.length, 5000);  // dados grandes ficam inteiros


// --- problema com pergunta no meio (ex.: questão de matemática com LaTeX) ---
const RAW = 'Se \\[x\\] é um número real, qual é o valor de \\[x\\]?(1) \\(3x - 9 = 0\\)(2) \\(x^2 = 9\\)';
assert.equal(cleanMath(RAW), 'Se x é um número real, qual é o valor de x? (1) 3x - 9 = 0 (2) x^2 = 9');
assert.equal(cleanMath('2 \\times 3 \\div 4'), '2 × 3 ÷ 4');
assert.equal(cleanMath('\\frac{1}{2} + \\sqrt{9} + x^{2}'), '(1)/(2) + √(9) + x^2');
assert.equal(cleanMath('\\left( a \\right) \\le b'), '( a ) ≤ b');
for (const t of ['Receita 1.234,56 ?', 'veja https://x.com/?q=1', 'Ana Recife 10\nBruno Natal 20']) assert.equal(cleanMath(t), t); // sem LaTeX, nada muda
assert.equal(looksLikeMath('(1) 3x - 9 = 0 (2) x^2 = 9'), true);
assert.equal(looksLikeMath('2x + 3 = 7'), true);
assert.equal(looksLikeMath('x² > 4'), true);
assert.equal(looksLikeMath('Ana Recife 10\nBruno Natal 20'), false);
assert.equal(looksLikeMath('Receita R$ 1.500,00 em março'), false);
assert.deepEqual(splitQuestion(cleanMath(RAW)),
  { question: 'Se x é um número real, qual é o valor de x?', rest: '(1) 3x - 9 = 0 (2) x^2 = 9' });
assert.deepEqual(splitQuestion('Considere A e B. Qual é maior? A = 10; B = 20'),
  { question: 'Qual é maior?', rest: 'Considere A e B. A = 10; B = 20' });
assert.deepEqual(splitQuestion('Se x é real, qual é x?\n(1) 3x - 9 = 0\n(2) x^2 = 9'),
  { question: 'Se x é real, qual é x?', rest: '(1) 3x - 9 = 0\n(2) x^2 = 9' });
assert.equal(splitQuestion('veja https://x.com/?q=1 e 10'), null);                      // "?" dentro de URL não é pergunta
assert.equal(splitQuestion('Ana Recife 10 Bruno Natal 20'), null);


// LaTeX na resposta do modelo (blocos \[ \], \text, quebras \\)
assert.equal(cleanMath('Como \\(3x = 9\\), temos \\[ x = \\frac{9}{3} \\] e x = \\pm 3.'), 'Como 3x = 9, temos x = (9)/(3) e x = ± 3.');
assert.equal(cleanMath('\\[\n3x = 9 \\\\\nx = 3\n\\]'), '3x = 9\nx = 3');
assert.equal(cleanMath('\\text{Portanto } x = 3'), 'Portanto x = 3');

// variações reais de seleção: numeração antes, alternativas coladas no "?", URL não é pergunta
assert.deepEqual(splitQuestion('1. Se x é um número real, qual é o valor de x?(1) 3x - 9 = 0 (2) x^2 = 9'),
  { question: 'Se x é um número real, qual é o valor de x?', rest: '1. (1) 3x - 9 = 0 (2) x^2 = 9' });
assert.deepEqual(splitQuestion('Qual é x?A) 3 B) 9'), { question: 'Qual é x?', rest: 'A) 3 B) 9' });
assert.deepEqual(splitQuestion('Questão 1\nSe x é real, qual é x?(1) 3x - 9 = 0 (2) x^2 = 9'),
  { question: 'Se x é real, qual é x?', rest: 'Questão 1\n(1) 3x - 9 = 0 (2) x^2 = 9' });
assert.equal(splitQuestion('veja x.com/?id=1 e 10'), null);
assert.equal(splitQuestion('abrir ?ID=5&x=1 agora'), null);

// TeX vindo de anotação do KaTeX / alt de imagem (Wikipedia): chaves e \displaystyle
assert.equal(cleanMath('x^{2}'), 'x^2');
assert.equal(cleanMath('{\\displaystyle x^{2}=9}'), 'x^2=9');
assert.equal(cleanMath('3x_{1} - 9'), '3x_1 - 9');
console.log('OK: todos os testes de stats.js passaram');
