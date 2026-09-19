// /decide の中身。Jev への質問文はここの表だけで組み立て、クライアントからは受けない (D-3)。
// 任意の Jev 呼び出しを中継する口にしないため

export const LIMITS = {
  body: 16000,        // リクエスト全体の文字数
  state: 8000,        // state を JSON にしたときの文字数
  options: 64,        // 1問あたりの選択肢の数
  key: /^[A-Za-z0-9_#.+-]{1,32}$/,
  desc: 240,          // 選択肢1つの説明の文字数
};

const SET = 'You are steering a long, continuously generated electro DJ set ' +
  '(minimal techno base, electro funk, dub techno, glitch). ' +
  'The state describes what has been heard recently, most recent last. ';

// kind → 質問 id → {type, instructions}。choice の選択肢はクライアントが候補として送る
export const KINDS = {
  scene: {
    next: { type: 'choice', instructions: SET +
      'Choose the scene that should come next so the set keeps developing over tens of minutes: ' +
      'build contrast and long-range tension, avoid moods heard recently, and follow the dark/bright wave position.' },
    mode: { type: 'choice', instructions: SET +
      'Choose how to move from the current scene to the next one.' },
    length: { type: 'choice', instructions: SET +
      'Choose how long the next scene should last, given how long the recent scenes lasted and where the energy is heading.' },
  },
  harmony: {
    key: { type: 'choice', instructions: SET +
      'Choose the key for the next scene. Long-range key motion should feel purposeful: ' +
      'close fifth-related steps for continuity, third or sixth relations for a lift.' },
    prog: { type: 'choice', instructions: SET +
      'Choose the chord progression for the next section that best fits the scene and the recent harmonic history.' },
    shift: { type: 'noul', instructions: SET +
      'At this 8-bar boundary, the harmony should shift in parallel to a new tonal centre to lift the energy.' },
    lush: { type: 'noul', instructions: SET +
      'The keys and strings should use lush, tension-rich open voicings in the coming section.' },
  },
  phrase: {
    phrase: { type: 'choice', instructions: SET +
      'Choose the function of the next 16-bar phrase so the recent phrases form a convincing tension-and-release arc.' },
    event: { type: 'choice', instructions: SET +
      'Choose which ornament event, if any, should happen at the next 4-bar boundary. ' +
      'Surprises work best sparingly and after stable stretches.' },
    dub: { type: 'noul', instructions: SET +
      'The drums should drop out into a dub delay throw a few bars from now.' },
  },
  riff: {
    riff: { type: 'choice', instructions: SET +
      'Choose the riff that best answers the recent riffs and fits the current chord. ' +
      'Prefer motivic development (call and response, variation of the remembered motif) over random novelty.' },
  },
};

export class BadRequest extends Error {}

// body (文字列) を検査し、{kind, state, ask} を返す。ask は 質問 id → 選択肢 (choice) か true (noul)
export function parseRequest(text) {
  if (typeof text !== 'string' || text.length > LIMITS.body) throw new BadRequest('body too large');
  let req;
  try { req = JSON.parse(text); } catch { throw new BadRequest('invalid json'); }
  if (!req || typeof req !== 'object') throw new BadRequest('invalid body');
  const { kind, state, ask } = req;
  const table = Object.hasOwn(KINDS, kind) ? KINDS[kind] : null;
  if (!table) throw new BadRequest('unknown kind');
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new BadRequest('state must be an object');
  if (JSON.stringify(state).length > LIMITS.state) throw new BadRequest('state too large');
  if (!ask || typeof ask !== 'object' || Array.isArray(ask)) throw new BadRequest('ask must be an object');
  const ids = Object.keys(ask);
  if (!ids.length) throw new BadRequest('nothing to ask');
  for (const id of ids) {
    const q = Object.hasOwn(table, id) ? table[id] : null;
    if (!q) throw new BadRequest(`unknown question: ${id}`);
    if (q.type === 'noul') {
      if (ask[id] !== true) throw new BadRequest(`${id} takes true`);
      continue;
    }
    const opts = ask[id];
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) throw new BadRequest(`${id} needs options`);
    const keys = Object.keys(opts);
    if (keys.length < 2 || keys.length > LIMITS.options) throw new BadRequest(`${id}: 2..${LIMITS.options} options`);
    for (const k of keys) {
      if (!LIMITS.key.test(k)) throw new BadRequest(`${id}: bad option key`);
      if (typeof opts[k] !== 'string' || !opts[k] || opts[k].length > LIMITS.desc) throw new BadRequest(`${id}: bad option text`);
    }
  }
  return { kind, state, ask };
}

// Jev の questions を組み立てる
export function buildQuestions({ kind, ask }) {
  const questions = {};
  for (const [id, a] of Object.entries(ask)) {
    const q = KINDS[kind][id];
    questions[id] = q.type === 'noul'
      ? { type: 'noul', instructions: q.instructions }
      : { type: 'choice', instructions: q.instructions, criteria: a };
  }
  return questions;
}

// Jev の answers から、確率と confidence だけを取り出す。
// choice は {probs:{key:p}, confidence}、noul は {p, confidence}
export function pickAnswers(ask, answers) {
  const out = {};
  for (const id of Object.keys(ask)) {
    const a = answers && answers[id];
    if (!a || typeof a !== 'object') continue;
    const confidence = typeof a.confidence === 'number' ? a.confidence : null;
    if (ask[id] === true) {
      const p = typeof a.noul === 'number' ? a.noul : typeof a.probability === 'number' ? a.probability : null;
      if (p !== null) out[id] = { p: clamp01(p), confidence };
      continue;
    }
    const probs = {};
    for (const k of Object.keys(ask[id])) {
      const p = a.probabilities && a.probabilities[k];
      probs[k] = typeof p === 'number' ? clamp01(p) : 0;
    }
    if (Object.values(probs).some(p => p > 0)) out[id] = { probs, confidence };
    else if (typeof a.choice === 'string' && Object.hasOwn(probs, a.choice)) out[id] = { probs: { ...probs, [a.choice]: 1 }, confidence };
  }
  return out;
}

const clamp01 = x => Math.min(1, Math.max(0, x));

// 許可するオリジンなら、その値を返す。本番の配信元と、手元の開発用だけ
export function allowedOrigin(origin) {
  if (!origin) return null;
  if (origin === 'https://elevator-noise.com') return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin)) return origin;
  return null;
}
