// 운영 ZAVAPASS에서 읽어 온 원본 (2026-11-03, 읽기만). 클론(yiuraowvnadqdrnysdce)에만 배포
// 2026-11-03n 클론: 목소리는 타입캐스트로만 읽음. OpenAI 목소리로 대신 읽던 것(타입캐스트 실패·한도 초과 때)을 없앰
//   - 요청에 타입캐스트 목소리가 없으면 기본 타입캐스트 목소리(DEFAULT_TC)로 읽음
//   - 한도에 걸리면 429(code tts_limit), 타입캐스트가 실패하면 502(code typecast_failed) → 앱이 면접관 예비 설정(브라우저 목소리·글자만)으로 이어감
//   - OpenAI는 질문·꼬리질문 '글'을 만들 때만 씀 (다른 함수)
// 2026-10-26a: 끝음 점검으로 다시 읽은 요청(retry)은 앱이 보낸 이유(end_note: 끝음 점수)를 사용 기록 note에 남김 (주간 즉석 문장 점검용)
// 2026-10-23m: 사람별 한도 — profiles.tts_cap(매달 한도, null=기본·0=없음) + tts_bonus/tts_bonus_month(그달만 추가)
// 2026-10-23d: 즉석으로 읽은 문장 종류에 doc_question(서류 질문) 추가
// 2026-10-23a: 안내 문구의 '교육팀' → '담당자' (부서 이름을 특정하지 않음)
// 2026-10-22j: ③ 1인당 한 달 한도(app_settings.tts_guard.user_cap, 기본 1,500크레딧) 넘은 사람만 OpenAI 목소리로. 관리자·직원은 제외
// 2026-10-21j: ① 크레딧 안전장치(이번 달 한도·회사 남은 크레딧) 넘으면 OpenAI 목소리로 ② OpenAI로 대신 읽은 것도 기록(provider openai + 이유 note)
// 2026-10-21i: 사용 기록에 읽은 문장·종류(purpose)·다시 읽음(retry)도 남김 (step27)
// 2026-10-21g: 타입캐스트로 읽으면 사용한 글자 수(=크레딧)를 tts_usage에 남김 (관리자 AI 설정의 크레딧 카드)
// 2026-10-21b: 면접관 목소리를 타입캐스트로도 읽을 수 있게 (provider:"typecast" + tc 설정). 타입캐스트가 실패하면 OpenAI로 대신 읽어 면접이 멈추지 않음
// 2026-10-15: 승인 대기(연습 분야 권한 없음)·이용 기간 종료 계정의 요청은 403 not_approved로 거절 (관리자는 통과)
// StenoTalk AI · Step 3 · speak-text Edge Function (음성 합성, TTS)
// ------------------------------------------------------------
// 질문·꼬리질문 문장을 자연스러운 목소리(mp3)로 바꿔 돌려줍니다.
//
// 요청 (POST, JSON)
//   { text, provider: "typecast", tc: { voice_id, tempo, pitch, emotion, intensity }, purpose?, retry?, end_note? }
// 응답  audio/mpeg (mp3)  · 헤더 X-Voice-Provider: typecast
//
// 필요한 Secret: TYPECAST_API_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TYPECAST_API_KEY = Deno.env.get("TYPECAST_API_KEY") ?? "";
// 앱이 목소리를 안 보냈을 때 쓰는 기본 타입캐스트 목소리 (엘리스 · 여성 · 중년 · 뉴스·아나운서). 앱의 TC_DEFAULT와 같게
const DEFAULT_TC = { voice_id: "tc_686dc45bbd6351e06ee64daf", tempo: 1, pitch: 0, emotion: "normal" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Voice-Provider, X-Voice-Note",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });


// ---- 호출자 확인: 로그인한 사용자만 허용 (대시보드의 "Verify JWT with legacy secret"는 꺼도 됨) ----
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
async function requireUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !SUPABASE_URL) return null;
  if (token === SUPABASE_ANON_KEY) return null;   // anon 키만으로는 불가, 로그인 토큰이어야 함
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id } : null;
  } catch { return null; }
}

// ---- 승인 확인 (2026-10-15): 관리자가 연습 분야를 열어 주기 전(승인 대기)이거나 이용 기간이 끝난 계정은 AI 기능을 쓰지 못함. 관리자는 통과 ----
//      profiles를 서비스 키로 읽음(없으면 사용자 토큰). 조회 자체가 실패하면(네트워크·서버 오류) 기능이 멈추지 않도록 통과시키고 로그만 남김.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
type CapInfo = { cap: number | null; bonus: number; bonusMonth: string | null };
async function requireApproved(req: Request, userId: string): Promise<{ ok: boolean; reason?: string; exempt?: boolean; capInfo?: CapInfo }> {
  const key = SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const auth = SERVICE_ROLE_KEY ? `Bearer ${SERVICE_ROLE_KEY}` : (req.headers.get("Authorization") ?? "");
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_admin,is_staff,allowed_fields,access_until,tts_cap,tts_bonus,tts_bonus_month`, { headers: { apikey: key, Authorization: auth } });
    let rr = r;
    if (rr.status === 400) { await rr.text(); rr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_admin,is_staff,allowed_fields,access_until`, { headers: { apikey: key, Authorization: auth } }); }   // step36 전(칸 없음)
    if (!rr.ok) { console.warn("[승인 확인 실패 → 통과]", rr.status, (await rr.text()).slice(0, 200)); return { ok: true }; }
    const rows = await rr.json();
    const p = Array.isArray(rows) ? rows[0] : null;
    if (!p) return { ok: false, reason: "no_profile" };
    if (p.is_admin) return { ok: true, exempt: true };
    const fields = Array.isArray(p.allowed_fields) ? p.allowed_fields.filter(Boolean) : [];
    if (!fields.length) return { ok: false, reason: "pending" };
    if (p.access_until) {
      const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      if (String(p.access_until).slice(0, 10) < todayKst) return { ok: false, reason: "expired" };
    }
    return { ok: true, exempt: !!p.is_staff, capInfo: { cap: p.tts_cap === null || p.tts_cap === undefined ? null : Number(p.tts_cap) || 0, bonus: Number(p.tts_bonus) || 0, bonusMonth: p.tts_bonus_month ?? null } };
  } catch (e) { console.warn("[승인 확인 예외 → 통과]", (e as Error).message); return { ok: true }; }
}
// 2026-10-21g 사용 기록 (응답을 늦추지 않게 뒤에서 저장)
// 2026-10-21i: 즉석으로 읽은 문장·종류(AI 꼬리질문·기본 꼬리질문·질문 등)·끝음 점검으로 다시 읽었는지도 함께 남김 → 관리자 화면 목록
const PURPOSES = ["ai_followup", "rule_followup", "question", "doc_question", "admin_test", "other"];   // 2026-10-23d doc_question = 자기소개서·이력서로 만든 질문
function logUsage(userId: string, kind: string, chars: number, text = "", purpose = "", retry = false, provider = "typecast", note = "") {
  if (!SERVICE_ROLE_KEY || !SUPABASE_URL || !chars) return;
  const row: Record<string, unknown> = { user_id: userId, provider, kind, chars };
  if (text) { row.text = text.slice(0, 1000); row.purpose = PURPOSES.includes(purpose) ? purpose : "other"; row.retry = !!retry; }
  if (note) row.note = note.slice(0, 300);
  const p = fetch(`${SUPABASE_URL}/rest/v1/tts_usage`, { method: "POST", headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row) }).catch((e) => console.warn("[사용 기록 실패]", (e as Error).message));
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* 무시 */ }
}
// ---- 2026-10-21j 크레딧 안전장치: app_settings.tts_guard { enabled, month_cap, min_left_pct } ----
//   이번 달(한국 시간) 면접 중 목소리로 쓴 타입캐스트 크레딧이 month_cap 이상이거나, 회사 전체 남은 크레딧이 min_left_pct% 미만이면 타입캐스트를 쓰지 않음.
//   매 요청마다 조회하지 않도록 이 서버 인스턴스 안에서 설정·사용량은 60초, 회사 잔액은 5분 동안 기억. 조회 실패는 막지 않음(통과)
const SB_HEAD = () => ({ apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" });
const G: { cfgAt: number; cfg: any; usedAt: number; used: number; leftAt: number; leftPct: number | null } = { cfgAt: 0, cfg: null, usedAt: 0, used: 0, leftAt: 0, leftPct: null };
async function guardReason(): Promise<string> {
  if (!SERVICE_ROLE_KEY || !SUPABASE_URL) return "";
  const now = Date.now();
  try {
    if (now - G.cfgAt > 60000) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=eq.tts_guard&select=value`, { headers: SB_HEAD() });
      const rows = r.ok ? await r.json() : [];
      G.cfg = Array.isArray(rows) && rows[0] ? rows[0].value : null; G.cfgAt = now;
    }
    const cfg = G.cfg || {};
    if (cfg.enabled === false) return "";
    const cap = Number(cfg.month_cap) || 0, minPct = Number(cfg.min_left_pct) || 0;
    if (cap > 0) {
      if (now - G.usedAt > 60000) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/tts_live_month_used`, { method: "POST", headers: SB_HEAD(), body: "{}" });
        if (r.ok) { G.used = Number(await r.json()) || 0; G.usedAt = now; }
      }
      if (G.used >= cap) return `안전장치: 이번 달 한도 ${cap.toLocaleString("ko-KR")}크레딧 도달`;
    }
    if (minPct > 0 && TYPECAST_API_KEY) {
      if (now - G.leftAt > 300000) {
        const r = await fetch("https://api.typecast.ai/v1/users/me/subscription", { headers: { "X-API-KEY": TYPECAST_API_KEY } });
        if (r.ok) { const j = await r.json(); const plan = Number(j?.credits?.plan_credits) || 0, used = Number(j?.credits?.used_credits) || 0; G.leftPct = plan ? Math.max(0, (plan - used) / plan * 100) : null; }
        G.leftAt = now;
      }
      if (G.leftPct != null && G.leftPct < minPct) return `안전장치: 회사 전체 남은 크레딧 ${minPct}% 미만`;
    }
  } catch (e) { console.warn("[안전장치 확인 실패 → 통과]", (e as Error).message); }
  return "";
}

// ---- 2026-10-22j 1인당 한 달 한도: tts_guard.user_cap (없으면 1,500, 0이면 끔). 회사 전체 안전장치(enabled)와 따로 작동 ----
//   사람마다 이번 달 사용량을 60초 동안 기억(서버 인스턴스 안). 조회 실패는 막지 않음(통과)
const U = new Map<string, { at: number; used: number }>();
function monthKeyKst(): string { const k = new Date(Date.now() + 9 * 3600 * 1000); return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`; }
async function userCapReason(userId: string, ci?: CapInfo): Promise<string> {
  if (!SERVICE_ROLE_KEY || !SUPABASE_URL) return "";
  try {
    const now = Date.now();
    if (now - G.cfgAt > 60000) { await guardReason(); }   // 설정을 아직 안 읽었으면 읽어 둠 (G.cfg)
    const cfg = G.cfg || {};
    const defCap = cfg.user_cap === undefined || cfg.user_cap === null ? 1500 : Number(cfg.user_cap) || 0;
    // 2026-10-23m 사람별: 따로 정한 매달 한도(0이면 없음)가 있으면 그것, 없으면 기본. 이번 달 추가분은 한도가 있을 때만 더함
    const base = ci && ci.cap !== null ? Math.max(0, ci.cap) : defCap;
    if (base <= 0) return "";
    const bonus = ci && ci.bonusMonth === monthKeyKst() ? Math.max(0, ci.bonus || 0) : 0;
    const cap = base + bonus;
    let c = U.get(userId);
    if (!c || now - c.at > 60000) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/tts_user_month_used`, { method: "POST", headers: SB_HEAD(), body: JSON.stringify({ p_user: userId }) });
      if (!r.ok) { console.warn("[1인 한도 확인 실패 → 통과]", r.status); return ""; }
      c = { at: now, used: Number(await r.json()) || 0 }; U.set(userId, c);
    }
    if (c.used >= cap) return `1인 한도: 이번 달 ${cap.toLocaleString("ko-KR")}크레딧 도달`;
  } catch (e) { console.warn("[1인 한도 확인 예외 → 통과]", (e as Error).message); }
  return "";
}

const NOT_APPROVED_MSG: Record<string, string> = {
  pending: "담당자 승인 후 사용할 수 있어요.",
  expired: "이용 기간이 끝나 사용할 수 없어요.",
  no_profile: "등록 정보가 없는 계정이에요.",
};

// ---- 타입캐스트 (ssfm-v30). 감정 설정을 이 목소리가 안 받으면 기본값으로 한 번 더. 12초 넘게 걸리면 포기 ----
async function typecastTts(text: string, tc: any): Promise<Uint8Array> {
  const voice_id = String(tc?.voice_id ?? "").trim();
  if (!/^(tc|uc)_[A-Za-z0-9]+$/.test(voice_id)) throw new Error("타입캐스트 목소리가 정해지지 않았어요");
  const tempo = Math.min(1.5, Math.max(0.7, Number(tc?.tempo) || 1.0));
  const pitch = Math.min(6, Math.max(-6, Math.round(Number(tc?.pitch) || 0)));
  const emotion = String(tc?.emotion ?? "normal");
  const intensity = Math.min(2, Math.max(0, Number(tc?.intensity) || 1));
  const prompt = emotion === "smart" ? { emotion_type: "smart" } : { emotion_type: "preset", emotion_preset: emotion, emotion_intensity: intensity };
  const output = { audio_format: "mp3", audio_tempo: tempo, audio_pitch: pitch };
  const call = async (p: Record<string, unknown>) => {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 12000);
    try {
      return await fetch("https://api.typecast.ai/v1/text-to-speech", { method: "POST", signal: ac.signal, headers: { "X-API-KEY": TYPECAST_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(p) });
    } finally { clearTimeout(timer); }
  };
  let res = await call({ model: "ssfm-v30", text, voice_id, language: "kor", prompt, output });
  if (!res.ok && (res.status === 400 || res.status === 422)) { await res.text(); res = await call({ model: "ssfm-v30", text, voice_id, output }); }
  if (!res.ok) throw new Error(`타입캐스트 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 500) throw new Error("타입캐스트 음성 데이터가 비어 있음");
  return bytes;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
  const user = await requireUser(req);
  if (!user) return json({ error: "로그인이 필요합니다. (인증 토큰 없음 또는 만료)" }, 401);
  const ap = await requireApproved(req, user.id);
  if (!ap.ok) return json({ error: "not_approved", reason: ap.reason, message: NOT_APPROVED_MSG[ap.reason ?? "pending"] ?? NOT_APPROVED_MSG.pending }, 403);   // 2026-10-15 승인 대기·기간 종료 계정 거절

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "요청 본문이 JSON 형식이 아닙니다." }, 400); }
  const text = String(body.text ?? "").trim().slice(0, 1000);   // 비용 보호: 최대 1,000자
  if (!text) return json({ error: "text는 필수입니다." }, 400);

  // 2026-11-03n 타입캐스트로만 읽음 (OpenAI 목소리로 대신 읽지 않음)
  const purpose = String(body.purpose ?? "");
  // 2026-10-26a 끝음 점검으로 다시 읽은 이유 (앱이 보냄, 80자까지)
  const endNote = body.retry === true && typeof body.end_note === "string" ? body.end_note.replace(/[\r\n]+/g, " ").slice(0, 80) : "";
  const tc = body.tc && /^(tc|uc)_[A-Za-z0-9]+$/.test(String(body.tc.voice_id ?? "").trim()) ? body.tc : DEFAULT_TC;
  if (!TYPECAST_API_KEY) return json({ error: "TYPECAST_API_KEY Secret이 설정되어 있지 않습니다.", code: "no_key" }, 500);
  if (purpose !== "admin_test") {
    let lim = await guardReason();
    if (!lim && !ap.exempt) lim = await userCapReason(user.id, ap.capInfo);
    if (lim) { console.warn("[타입캐스트 한도 → 목소리 없이]", user.id, lim); return json({ error: lim, code: "tts_limit" }, 429); }
  }
  try {
    const bytes = await typecastTts(text, tc);
    G.used += text.length;
    { const c = U.get(user.id); if (c) c.used += text.length; }
    logUsage(user.id, "live", text.length, text, purpose, body.retry === true, "typecast", endNote);
    return new Response(bytes, { status: 200, headers: { ...corsHeaders, "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Provider": "typecast" } });
  } catch (e) {
    const note = (e as Error).name === "AbortError" ? "타입캐스트 응답 지연(12초)" : (e as Error).message;
    console.warn("[타입캐스트 실패]", note);
    return json({ error: `타입캐스트 오류: ${note}`.slice(0, 300), code: "typecast_failed" }, 502);
  }
});
