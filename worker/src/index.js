// elevator-three の判断を Jev に問い合わせる中継 (D-3)。POST /decide だけを受ける
import { parseRequest, buildQuestions, pickAnswers, allowedOrigin, BadRequest } from './decide.js';

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';
const JEV_TIMEOUT_MS = 4000;   // 問い合わせは数小節先の判断なので、これより遅い応答はどうせ使えない

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request.headers.get('Origin'));
    const cors = origin ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    } : { Vary: 'Origin' };
    const reply = (status, body) => Response.json(body, { status, headers: cors });

    const url = new URL(request.url);
    if (url.pathname !== '/decide') return reply(404, { error: 'not found' });
    if (!origin) return reply(403, { error: 'origin not allowed' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return reply(405, { error: 'method not allowed' });

    if (env.LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.LIMITER.limit({ key: ip });
      if (!success) return reply(429, { error: 'rate limited' });
    }

    let req;
    try { req = parseRequest(await request.text()); }
    catch (e) {
      if (e instanceof BadRequest) return reply(400, { error: e.message });
      throw e;
    }
    if (!env.TYPESAFE_API_KEY) return reply(503, { error: 'jev not configured' });

    const t0 = Date.now();
    let res;
    try {
      res = await fetch(JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: JEV_MODEL, state: req.state, questions: buildQuestions(req) }),
        signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
      });
    } catch (e) {
      return reply(504, { error: 'jev unreachable' });
    }
    if (!res.ok) return reply(502, { error: `jev ${res.status}` });
    const data = await res.json().catch(() => null);
    const answers = pickAnswers(req.ask, data && data.answers);
    return reply(200, { answers, model: data && data.model, ms: Date.now() - t0 });
  },
};
