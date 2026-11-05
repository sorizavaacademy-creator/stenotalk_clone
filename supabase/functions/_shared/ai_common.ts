// 2026-11-05 클론(ZAVAPASS-clone) 전용: 면접 DB 서버 함수(pick-questions 등)가 함께 쓰는 도우미
// OpenAI 호출·로그인 확인·승인 확인·응답 모양. grade-answer에 있던 것과 같은 동작 (그 함수는 그대로 둠)
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
export const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";
const FALLBACK_MODEL = "gpt-4o-mini";
export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
export const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
export function cleanText(v: unknown, n: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n) : "";
}

/** 서비스 키로 DB를 읽고 쓰는 연결 (RLS를 넘으므로 이 파일을 쓰는 함수 안에서만, 학생에게 원문을 돌려주지 않게 주의) */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !SUPABASE_URL || token === SUPABASE_ANON_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id } : null;
  } catch { return null; }
}

/** 승인 대기·기간 만료 계정은 AI 기능을 쓰지 못함 (관리자는 통과). 조회 실패면 멈추지 않게 통과 */
export async function requireApproved(userId: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_admin,allowed_fields,access_until`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } });
    if (!r.ok) return { ok: true };
    const p = (await r.json())?.[0];
    if (!p) return { ok: false, reason: "no_profile" };
    if (p.is_admin) return { ok: true };
    if (!(Array.isArray(p.allowed_fields) && p.allowed_fields.filter(Boolean).length)) return { ok: false, reason: "pending" };
    if (p.access_until) {
      const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      if (String(p.access_until).slice(0, 10) < todayKst) return { ok: false, reason: "expired" };
    }
    return { ok: true };
  } catch { return { ok: true }; }
}
export const NOT_APPROVED_MSG: Record<string, string> = {
  pending: "담당자 승인 후 사용할 수 있어요.", expired: "이용 기간이 끝나 사용할 수 없어요.", no_profile: "등록 정보가 없는 계정이에요.",
};

function isNewGen(model: string) { return /^(gpt-5|o\d|gpt-6)/i.test(model); }
function buildBody(model: string, messages: unknown[], temperature: number, maxTokens: number) {
  const body: Record<string, unknown> = { model, messages, response_format: { type: "json_object" } };
  if (isNewGen(model)) body.max_completion_tokens = maxTokens; else { body.temperature = temperature; body.max_tokens = maxTokens; }
  return body;
}
/** OpenAI에 JSON으로 묻고 JSON으로 받음. 실패하면 이유를 담아 throw */
export async function askJson(system: string, user: string, opt: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}): Promise<{ data: Record<string, unknown>; model: string }> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY가 설정되지 않았어요");
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];
  const maxTokens = opt.maxTokens ?? 2500, temperature = opt.temperature ?? 0.3;
  const send = (body: Record<string, unknown>) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opt.timeoutMs ?? 40000);
    return fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: ctl.signal, headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).finally(() => clearTimeout(t));
  };
  let model = OPENAI_MODEL, body = buildBody(model, messages, temperature, maxTokens);
  let res = await send(body);
  if (res.status >= 500 || res.status === 429) { await new Promise((r) => setTimeout(r, 700)); res = await send(body); }
  if (res.status === 400) {
    const t = await res.clone().text();
    if (/temperature|max_tokens|max_completion_tokens|unsupported/i.test(t)) { delete body.temperature; delete body.max_tokens; body.max_completion_tokens = maxTokens; res = await send(body); }
  }
  if ((res.status === 404 || res.status === 400) && model !== FALLBACK_MODEL) {
    const t = await res.clone().text();
    if (/model|not found|does not exist/i.test(t)) { model = FALLBACK_MODEL; body = buildBody(model, messages, temperature, maxTokens); res = await send(body); }
  }
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  let content = out?.choices?.[0]?.message?.content ?? "";
  if (!content && isNewGen(model)) {   // 추론형 모델이 생각에 토큰을 다 써서 빈 답이면 한 번 더 넉넉하게
    body.max_completion_tokens = Math.round(maxTokens * 1.8);
    const r2 = await send(body); if (r2.ok) content = (await r2.json())?.choices?.[0]?.message?.content ?? "";
  }
  try { return { data: JSON.parse(content), model }; } catch { throw new Error("AI 응답이 JSON이 아니에요: " + String(content).slice(0, 120)); }
}
