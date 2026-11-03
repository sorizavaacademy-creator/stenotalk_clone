// 운영 ZAVAPASS에서 읽어 온 원본 (2026-11-03, 읽기만). 클론(yiuraowvnadqdrnysdce)에만 배포
// 2026-11-03 한림대용: 속기사 채용 → 대학생 채용 면접으로 프롬프트 교체 (이 함수는 임시 비밀번호 단어 목록만 바꿈)
// StenoTalk AI · admin-set-password Edge Function (2026-10-06)
// ------------------------------------------------------------
// 관리자가 면접자의 비밀번호를 "임시 비밀번호"로 바꿔 줍니다. (면접자는 스스로 비밀번호를 바꿀 수 없음 — 운영 정책)
// 호출: 관리자 화면 → 면접자 관리 → 상세 창 → "임시 비밀번호 만들기"
// 요청: { user_id: "<auth.users.id>" }          (password를 직접 보내도 되지만 화면에서는 자동 생성만 사용)
// 응답: { ok: true, password: "hallym-4821-kr" }  → 관리자가 면접자에게 전화·카톡으로 알려 줌
// 2026-10-07: profiles.must_change_password=true 로 표시 → 면접자가 이 비밀번호로 처음 로그인하면 새 비밀번호를 한 번 정함 (step9)
//
// 필요한 Secret: 기본 제공되는 SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 만 사용 (추가 설정 없음)
// 함수 안에서 "관리자인지"를 직접 확인합니다 (다른 함수들과 같이 verify_jwt는 끔)
// 배포 완료: 2026-10-06 Cowork Supabase 연결로 배포 (프로젝트가 팀 조직으로 이전된 뒤) — 대시보드에서 따로 할 일 없음

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...svcHeaders, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`DB ${res.status}: ${typeof data === "string" ? data.slice(0, 200) : (data?.message || JSON.stringify(data)).slice(0, 200)}`);
  return data;
}

// 호출자: 로그인 + 관리자(profiles.is_admin)
async function requireAdmin(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token === SUPABASE_ANON_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id) return null;
  const prof = await rest(`profiles?id=eq.${u.id}&select=is_admin`);
  return Array.isArray(prof) && prof[0]?.is_admin ? { id: u.id } : null;
}

// 읽기 쉬운 임시 비밀번호: hallym-4821-kr 처럼 (소문자 단어 + 숫자 4자리 + 2글자), 헷갈리는 글자(l,1,o,0) 제외
function tempPassword(): string {
  const words = ["hallym", "pass", "mint", "ready", "clear", "bright", "steady", "calm"];
  const w = words[Math.floor(Math.random() * words.length)];
  const n = String(1000 + Math.floor(Math.random() * 9000));
  const abc = "abcdefghjkmnpqrstuvwxyz";
  const t = abc[Math.floor(Math.random() * abc.length)] + abc[Math.floor(Math.random() * abc.length)];
  return `${w}-${n}-${t}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
  if (!SERVICE_KEY || !SUPABASE_URL) return json({ error: "서버 설정(SUPABASE_SERVICE_ROLE_KEY)이 없습니다." }, 500);
  const admin = await requireAdmin(req);
  if (!admin) return json({ error: "관리자만 사용할 수 있어요. (로그인 상태와 관리자 권한을 확인해 주세요)" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "요청 본문이 JSON 형식이 아닙니다." }, 400); }
  const userId = String(body.user_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "user_id가 올바르지 않습니다." }, 400);

  // 직접 지정한 비밀번호가 있으면 8자 이상만 허용, 없으면 자동 생성
  let password = typeof body.password === "string" ? body.password.trim() : "";
  if (password && password.length < 8) return json({ error: "비밀번호는 8자 이상이어야 해요." }, 400);
  if (!password) password = tempPassword();

  try {
    const prof = await rest(`profiles?id=eq.${userId}&select=id,name`);
    if (!Array.isArray(prof) || !prof[0]) return json({ error: "해당 면접자를 찾지 못했어요." }, 404);

    // Auth 관리자 API로 비밀번호 교체 (서비스 키 — 함수 안에서만 사용)
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "PUT",
      headers: { ...svcHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!r.ok) {
      const t = await r.text();
      return json({ error: "비밀번호를 바꾸지 못했어요: " + t.slice(0, 200) }, 500);
    }
    // 임시 비밀번호 표시 (step9): 면접자가 이 비밀번호로 로그인하면 새 비밀번호를 정하는 창이 뜸
    try {
      await rest(`profiles?id=eq.${userId}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ must_change_password: true, temp_password_at: new Date().toISOString() }) });
    } catch (_) { /* step9 전이면 칸이 없음 — 비밀번호 변경은 그대로 성공 */ }
    // 기록 (activity_log 표가 있으면): 누가 누구의 비밀번호를 바꿨는지
    try {
      await rest(`activity_log`, { method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ user_id: userId, event: "password_reset", detail: { by: admin.id } }) });
    } catch (_) { /* 표가 없어도 비밀번호 변경은 성공 */ }
    return json({ ok: true, password, name: prof[0].name ?? "" });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e).slice(0, 300) }, 500);
  }
});
