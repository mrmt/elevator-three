import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, buildQuestions, pickAnswers, allowedOrigin, BadRequest, LIMITS, KINDS } from '../src/decide.js';
import worker from '../src/index.js';

const ok = { kind: 'scene', state: { bar: 64 }, ask: { next: { funk: 'electro funk', dub: 'dub techno' }, mode: { mix: 'mix', break: 'break' } } };

test('正しいリクエストを通す', () => {
  assert.deepEqual(parseRequest(JSON.stringify(ok)), ok);
});

test('許可リストにない kind と質問を弾く', () => {
  assert.throws(() => parseRequest(JSON.stringify({ ...ok, kind: 'chat' })), BadRequest);
  assert.throws(() => parseRequest(JSON.stringify({ ...ok, kind: 'toString' })), BadRequest);
  assert.throws(() => parseRequest(JSON.stringify({ ...ok, ask: { prompt: { a: 'x', b: 'y' } } })), BadRequest);
});

test('サイズと形の上限を守る', () => {
  const big = { ...ok, state: { s: 'x'.repeat(LIMITS.state) } };
  assert.throws(() => parseRequest(JSON.stringify(big)), BadRequest);
  assert.throws(() => parseRequest('x'.repeat(LIMITS.body + 1)), BadRequest);
  const many = Object.fromEntries(Array.from({ length: LIMITS.options + 1 }, (_, i) => [`k${i}`, 'x']));
  assert.throws(() => parseRequest(JSON.stringify({ ...ok, ask: { next: many } })), BadRequest);
  assert.throws(() => parseRequest(JSON.stringify({ ...ok, ask: { next: { only: 'one' } } })), BadRequest);
  assert.throws(() => parseRequest(JSON.stringify({ ...ok, ask: { next: { 'bad key!': 'x', b: 'y' } } })), BadRequest);
  assert.throws(() => parseRequest(JSON.stringify({ ...ok, ask: { next: { a: 'x'.repeat(LIMITS.desc + 1), b: 'y' } } })), BadRequest);
  assert.throws(() => parseRequest(JSON.stringify({ kind: 'harmony', state: {}, ask: { shift: { a: 'x', b: 'y' } } })), BadRequest);
  assert.throws(() => parseRequest('not json'), BadRequest);
});

test('質問文は表から組み立て、選択肢だけをクライアントから使う', () => {
  const q = buildQuestions({ kind: 'harmony', ask: { key: { C: 'C minor', G: 'G minor' }, shift: true } });
  assert.equal(q.key.type, 'choice');
  assert.equal(q.key.instructions, KINDS.harmony.key.instructions);
  assert.deepEqual(q.key.criteria, { C: 'C minor', G: 'G minor' });
  assert.deepEqual(q.shift, { type: 'noul', instructions: KINDS.harmony.shift.instructions });
});

test('音色・並び・平行移動の幅・ペダルの質問を通す (D-17)', () => {
  const harm = { kind: 'harmony', state: {}, ask: { prog: { p0: 'i', p1: 'iv' }, tight: true, chop: true, noise: true,
    shift: true, step: { home: 'back home', '+5': 'up a fourth' }, pedal: true } };
  assert.deepEqual(parseRequest(JSON.stringify(harm)), harm);
  const phr = { kind: 'phrase', state: {}, ask: { event: { none: 'n', sweep: 's' }, ep: true, mutate: true,
    lead: { sawtooth: 'saw', square: 'square' }, kick: { skip: 's', push: 'p' } } };
  assert.deepEqual(parseRequest(JSON.stringify(phr)), phr);
  const q = buildQuestions(phr);
  assert.equal(q.kick.instructions, KINDS.phrase.kick.instructions);
  assert.deepEqual(q.mutate, { type: 'noul', instructions: KINDS.phrase.mutate.instructions });
  // noul の問いに選択肢は付けられない
  assert.throws(() => parseRequest(JSON.stringify({ ...phr, ask: { ep: { a: 'x', b: 'y' } } })), BadRequest);
});

test('答えから確率と confidence だけを取る', () => {
  const ask = { next: { a: 'x', b: 'y' }, dub: true };
  const got = pickAnswers(ask, {
    next: { type: 'choice', choice: 'a', confidence: 0.4, probabilities: { a: 0.7, b: 0.3, extra: 1 } },
    dub: { type: 'noul', noul: 0.2, confidence: 0.9 },
    junk: { noul: 1 },
  });
  assert.deepEqual(got, { next: { probs: { a: 0.7, b: 0.3 }, confidence: 0.4 }, dub: { p: 0.2, confidence: 0.9 } });
  // 確率が無くても choice があれば使う
  assert.deepEqual(pickAnswers({ next: { a: 'x', b: 'y' } }, { next: { choice: 'b' } }).next.probs, { a: 0, b: 1 });
  assert.deepEqual(pickAnswers(ask, null), {});
});

test('オリジンは本番と手元だけ', () => {
  assert.equal(allowedOrigin('https://elevator-noise.com'), 'https://elevator-noise.com');
  assert.equal(allowedOrigin('http://localhost:8125'), 'http://localhost:8125');
  assert.equal(allowedOrigin('http://127.0.0.1'), 'http://127.0.0.1');
  assert.equal(allowedOrigin('https://evil.example'), null);
  assert.equal(allowedOrigin('http://localhost.evil.example'), null);
  assert.equal(allowedOrigin(null), null);
});

// Worker 全体。Jev への fetch を差し替える
const call = async (body, { origin = 'http://localhost:8125', env = { TYPESAFE_API_KEY: 'k' }, method = 'POST', path = '/decide' } = {}) => {
  const req = new Request(`https://three-api.elevator-noise.com${path}`, {
    method, headers: origin ? { Origin: origin, 'Content-Type': 'application/json' } : {},
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  return worker.fetch(req, env);
};

test('Worker: Jev に質問を送り、確率を返す', async (t) => {
  let sent;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return Response.json({ model: 'jev-1.13.0', answers: { next: { choice: 'funk', confidence: 0.5, probabilities: { funk: 0.6, dub: 0.4 } }, mode: { probabilities: { mix: 1, break: 0 } } } });
  });
  const res = await call(ok);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8125');
  const json = await res.json();
  assert.deepEqual(json.answers.next, { probs: { funk: 0.6, dub: 0.4 }, confidence: 0.5 });
  assert.equal(sent.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(sent.init.headers.Authorization, 'Bearer k');
  assert.equal(sent.body.model, 'jev-latest');
  assert.equal(sent.body.questions.next.instructions, KINDS.scene.next.instructions);
});

test('Worker: 許可しないオリジン・形の違う要求・キー無し・Jev の失敗', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x', { status: 529 }));
  assert.equal((await call(ok, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(ok, { origin: null })).status, 403);
  assert.equal((await call(ok, { path: '/' })).status, 404);
  assert.equal((await call(null, { method: 'GET' })).status, 405);
  assert.equal((await call(null, { method: 'OPTIONS' })).status, 204);
  assert.equal((await call({ ...ok, kind: 'chat' })).status, 400);
  assert.equal((await call(ok, { env: {} })).status, 503);
  assert.equal((await call(ok)).status, 502);
});

test('Worker: レート制限を超えたら 429', async () => {
  const env = { TYPESAFE_API_KEY: 'k', LIMITER: { limit: async () => ({ success: false }) } };
  assert.equal((await call(ok, { env })).status, 429);
});
