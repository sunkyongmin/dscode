// 동신병원 응급실 상병선정(dscode) — Claude API 중계 서버 (Cloudflare Worker)
// API 키는 이 코드에 넣지 않습니다. Cloudflare 대시보드의 Settings → Variables and Secrets에
//   ANTHROPIC_API_KEY  : Claude API 키 (sk-ant-...)
//   ACCESS_PASSWORD    : 응급실 공용 비밀번호
// 두 개를 "Secret"으로 등록하세요.

const ALLOWED_ORIGINS = ['https://sunkyongmin.github.io'];
const ALLOWED_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'];
const MAX_TOKENS = 4000;

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const okOrigin = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, x-access-pass',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (obj, status) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'GET') return json({ ok: true, service: 'dscode proxy' }, 200);
    if (req.method !== 'POST') return json({ error: { message: 'POST만 허용됩니다' } }, 405);
    if (!okOrigin) return json({ error: { message: '허용되지 않은 사이트에서 온 요청입니다' } }, 403);
    if (!env.ANTHROPIC_API_KEY || !env.ACCESS_PASSWORD)
      return json({ error: { message: '중계 서버에 ANTHROPIC_API_KEY 또는 ACCESS_PASSWORD가 설정되지 않았습니다' } }, 500);

    const pass = req.headers.get('x-access-pass') || '';
    if (pass !== env.ACCESS_PASSWORD) return json({ error: { message: '비밀번호가 틀렸습니다' } }, 401);

    let body;
    try { body = await req.json(); } catch { return json({ error: { message: '잘못된 요청입니다' } }, 400); }
    if (!ALLOWED_MODELS.includes(body.model)) body.model = ALLOWED_MODELS[0];
    body.max_tokens = Math.min(Number(body.max_tokens) || 1000, MAX_TOKENS);
    delete body.stream;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'content-type': 'application/json' } });
  },
};
