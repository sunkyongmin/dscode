// 동신병원 응급실 상병선정(dscode) — Claude API 중계 서버 (Cloudflare Worker)
// API 키는 이 코드에 넣지 않습니다. Cloudflare 대시보드의 Settings → Variables and Secrets에
//   ANTHROPIC_API_KEY  : Claude API 키 (sk-ant-...)
//   ACCESS_PASSWORD    : 응급실 공용 비밀번호
//   MFDS_KEY           : (선택) 공공데이터포털 '식품의약품안전처_의약품 제품 허가정보' 인증키 — 약품 자동 확인용
// 모두 "Secret"으로 등록하세요.

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
    if (req.method === 'GET') return json({ ok: true, service: 'dscode proxy', drug: !!env.MFDS_KEY }, 200);
    if (req.method !== 'POST') return json({ error: { message: 'POST만 허용됩니다' } }, 405);
    if (!okOrigin) return json({ error: { message: '허용되지 않은 사이트에서 온 요청입니다' } }, 403);
    if (!env.ANTHROPIC_API_KEY || !env.ACCESS_PASSWORD)
      return json({ error: { message: '중계 서버에 ANTHROPIC_API_KEY 또는 ACCESS_PASSWORD가 설정되지 않았습니다' } }, 500);

    const pass = req.headers.get('x-access-pass') || '';
    if (pass !== env.ACCESS_PASSWORD) return json({ error: { message: '비밀번호가 틀렸습니다' } }, 401);

    let body;
    try { body = await req.json(); } catch { return json({ error: { message: '잘못된 요청입니다' } }, 400); }
    if (body && body.op === 'drug') return json(await drugLookup(body.q, env), 200);
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

// ---- 식약처 의약품 제품 허가정보 조회 (상품명 → 주성분·분류) ----
const MFDS_URL = 'https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService08/getDrugPrdtPrmsnInq08';
const KEEP = /^(ITEM_NAME|ENTP_NAME|ITEM_ENG_NAME|SPCLTY_PBLC|PRDUCT_TYPE|PRDLST_STDR_CODE|EDI_CODE|ETC_OTC_CODE|CLASS_NO|CLASS_NAME)$|INGR/i;
async function drugLookup(q, env) {
  if (!env.MFDS_KEY) return { ok: false, error: 'MFDS_KEY 없음' };
  const list = (Array.isArray(q) ? q : []).slice(0, 6);
  const key = /%/.test(env.MFDS_KEY) ? env.MFDS_KEY : encodeURIComponent(env.MFDS_KEY);
  const out = await Promise.all(list.map(async (x) => {
    const name = String((x && x.name) || '').trim().slice(0, 40);
    const entp = String((x && x.entp) || '').replace(/\(주\)|㈜|주식회사|\s/g, '').slice(0, 20);
    if (!name) return { name, items: [] };
    try {
      const u = MFDS_URL + '?serviceKey=' + key + '&type=json&pageNo=1&numOfRows=20&item_name=' + encodeURIComponent(name);
      const r = await fetch(u);
      const t = await r.text();
      let d; try { d = JSON.parse(t); } catch { return { name, items: [], error: t.slice(0, 120) }; }
      const b = d.body || (d.response && d.response.body) || {};
      let matched = true;
      let items = b.items || [];
      if (items && !Array.isArray(items)) items = items.item || [];
      if (!Array.isArray(items)) items = [items];
      items = items.map((it) => (it && it.item) ? it.item : it).filter(Boolean);
      if (entp) {
        const m = items.filter((it) => String(it.ENTP_NAME || '').replace(/\(주\)|㈜|주식회사|\s/g, '').includes(entp.slice(0, 4)));
        if (m.length) items = m; else matched = false;
      }
      items = items.slice(0, 3).map((it) => {
        const o = {};
        for (const k of Object.keys(it)) if (KEEP.test(k) && it[k] != null && it[k] !== '') o[k] = String(it[k]).slice(0, 300);
        return o;
      });
      return { name, items, matched };
    } catch (e) { return { name, items: [], error: String(e).slice(0, 120) }; }
  }));
  return { ok: true, results: out };
}
