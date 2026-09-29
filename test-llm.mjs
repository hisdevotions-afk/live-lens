import assert from 'node:assert/strict';
import { analyze, buildMessages } from './llm.js';

const snap = { type: 'snapshot', source: 'pin', text: 'Receita 1.234,56', table: null, url: 'http://x', title: 'Dash', lang: 'pt-BR', ts: 0 };
const summary = { locale: 'pt', groups: [{ name: 'Números', stats: { n: 1, sum: 1234.56789, mean: 1234.56789, median: 1, min: 1, max: 1, stdev: 0, outliers: [] } }], primary: 1234.56789 };

// buildMessages
const [sys, user] = buildMessages({ snapshot: snap, summary, question: '' });
assert.equal(sys.role, 'system');
assert.match(sys.content, /NÃO recalcule/);
assert.match(user.content, /ORIGEM: elemento fixado/);
assert.match(user.content, /"sum": 1234.5679/);
assert.match(user.content, /PERGUNTA: Analise os dados\./);
const long = buildMessages({ snapshot: { ...snap, source: 'selection', text: 'a'.repeat(5000) }, summary, question: 'Por quê?' })[1].content;
assert.match(long, /ORIGEM: seleção/);
assert.match(long, /\[truncado\]/);
assert.match(long, /PERGUNTA: Por quê\?/);
assert.ok(!long.includes('a'.repeat(4001)));

// analyze com fetch simulado
const enc = (s) => new TextEncoder().encode(s);
const streamOf = (...chunks) => new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc(x))); c.close(); } });
const collect = async (it) => { let s = ''; for await (const c of it) s += c; return s; };
const args = { model: 'm', snapshot: snap, summary, question: '' };

globalThis.fetch = async () => new Response(streamOf(
  '{"message":{"content":"Olá"},"done":false}\n{"message":{"con',
  'tent":" mundo"},"done":false}\n{"done":true}\n',
));
assert.equal(await collect(analyze(args)), 'Olá mundo');

globalThis.fetch = async () => new Response('', { status: 403 });
await assert.rejects(collect(analyze(args)), { message: 'OLLAMA_CORS' });
globalThis.fetch = async () => new Response('{"error":"model not found"}', { status: 404 });
await assert.rejects(collect(analyze(args)), { message: 'OLLAMA_NO_MODEL' });
globalThis.fetch = async () => new Response('', { status: 500 });
await assert.rejects(collect(analyze(args)), { message: 'OLLAMA_HTTP_500' });
globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
await assert.rejects(collect(analyze(args)), { message: 'OLLAMA_OFFLINE' });
globalThis.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
await assert.rejects(collect(analyze(args)), { name: 'AbortError' });
globalThis.fetch = async () => new Response('{"error":"sem memória"}\n');
await assert.rejects(collect(analyze(args)), { message: 'sem memória' });

console.log('OK: todos os testes de llm.js passaram');
