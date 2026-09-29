import assert from 'node:assert/strict';
import {
  detectLocale, parseNumber, extractNumbers, describe,
  tableColumns, summarize, delta, changedEnough,
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

console.log('OK: todos os testes de stats.js passaram');
