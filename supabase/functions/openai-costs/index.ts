// 운영 ZAVAPASS에서 읽어 온 원본 (2026-11-03, 읽기만). 클론(yiuraowvnadqdrnysdce)에만 배포
// StenoTalk AI · openai-costs Edge Function (OpenAI 사용 금액 조회, 2026-10-07)
// ------------------------------------------------------------
// 관리자 화면 "AI·음성 설정 → AI 설정"의 "OpenAI 잔액·사용 금액" 카드가 부릅니다.
// OpenAI는 "남은 잔액"을 알려 주는 API가 없어서(2026-10 기준), 하루 단위 사용 금액(Costs API)을 가져와
// 화면에서 "관리자가 입력한 기준 잔액 − 그 뒤 사용 금액 = 예상 잔액"으로 계산합니다.
//
// 요청 (POST, JSON)  { since?: 유닉스초 }   → since(기준 잔액 입력 시각)·이번 달 1일·7일 전 중 가장 이른 날부터 오늘까지
// 응답 { configured: true, days: [{ start, end, total, items: { "모델/항목": 금액 } }], currency: "usd", fetched_at }
//      { configured: false }  ← OPENAI_ADMIN_KEY Secret이 아직 없음
//
// 필요한 Secret: OPENAI_ADMIN_KEY (OpenAI 관리자 키, sk-admin-…) — platform.openai.com → Settings → Organization → Admin keys
//   ※ 일반 OPENAI_API_KEY로는 사용 금액을 볼 수 없음. 관리자 키는 이 함수 안에서만 쓰고 화면으로 보내지 않음.
// 관리자만 호출할 수 있어요(profiles.is_admin 확인). verify_jwt는 다른 함수들처럼 끔.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ADMIN_KEY = Deno.env.get("OPENAI_ADMIN_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function requireAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token === SUPABASE_ANON_KEY) return false;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } });
  if (!r.ok) return false;
  const u = await r.json();
  if (!u?.id) return false;
  const p = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${u.id}&select=is_admin`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  if (!p.ok) return false;
  const rows = await p.json();
  return Array.isArray(rows) && !!rows[0]?.is_admin;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
  if (!(await requireAdmin(req))) return json({ error: "관리자만 사용할 수 있어요." }, 403);
  if (!ADMIN_KEY) return json({ configured: false });

  let body: any = {};
  try { body = await req.json(); } catch { /* 빈 요청 허용 */ }

  const now = Math.floor(Date.now() / 1000);
  const d = new Date();
  const monthStart = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
  const weekAgo = now - 7 * 86400;
  const since = Number(body.since) > 0 ? Math.floor(Number(body.since)) : now;
  // 기준 잔액이 아주 오래전이면 최대 180일까지만
  const start = Math.max(now - 180 * 86400, Math.min(monthStart, weekAgo, since));
  const startDay = Math.floor(start / 86400) * 86400;   // UTC 0시로 맞춤 (Costs API는 하루 단위)

  const days: { start: number; end: number; total: number; items: Record<string, number> }[] = [];
  let page = "";
  try {
    for (let i = 0; i < 6; i++) {
      const qs = new URLSearchParams({ start_time: String(startDay), bucket_width: "1d", limit: "180" });
      qs.append("group_by", "line_item");
      if (page) qs.set("page", page);
      const r = await fetch(`https://api.openai.com/v1/organization/costs?${qs}`, {
        headers: { Authorization: `Bearer ${ADMIN_KEY}`, "Content-Type": "application/json" },
      });
      const text = await r.text();
      if (!r.ok) {
        console.error("OpenAI Costs 오류", r.status, text.slice(0, 300));
        const msg = r.status === 401 || r.status === 403
          ? "관리자 키가 맞지 않거나 권한이 없어요. OPENAI_ADMIN_KEY에 sk-admin-으로 시작하는 관리자 키를 넣었는지 확인해 주세요."
          : `OpenAI 응답 오류 (${r.status})`;
        return json({ configured: true, error: msg }, 502);
      }
      const data = JSON.parse(text);
      for (const b of data.data ?? []) {
        const items: Record<string, number> = {};
        let total = 0;
        for (const res of b.results ?? []) {
          const v = Number(res?.amount?.value) || 0;
          if (!v) continue;
          const k = String(res?.line_item ?? "기타");
          items[k] = (items[k] ?? 0) + v;
          total += v;
        }
        days.push({ start: b.start_time, end: b.end_time, total, items });
      }
      if (!data.has_more || !data.next_page) break;
      page = data.next_page;
    }
  } catch (e) {
    console.error("openai-costs 예외", e);
    return json({ configured: true, error: `서버 오류: ${(e as Error).message}` }, 500);
  }
  days.sort((a, b) => a.start - b.start);
  return json({ configured: true, currency: "usd", days, fetched_at: new Date().toISOString() });
});
