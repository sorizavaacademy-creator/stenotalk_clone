// 운영 ZAVAPASS에서 읽어 온 원본 (2026-11-03, 읽기만). 클론(yiuraowvnadqdrnysdce)에만 배포
// 2026-10-21g: { action: "subscription" } → 타입캐스트 요금제·이번 달 사용 크레딧 (회사 전체), 미리 듣기 글자 수는 tts_usage에 남김
// ZAVAPASS · typecast-tts Edge Function (2026-10-20p) — 타입캐스트 목소리 비교용 (관리자 전용)
// ------------------------------------------------------------
// 관리자 화면 '설정 → AI·음성 설정 → 목소리'에서 OpenAI 목소리와 타입캐스트 목소리를 나란히 들어 보기 위한 함수.
// 비교가 끝나 타입캐스트로 바꾸기로 하면, 그때 면접(꼬리질문)·질문 녹음용으로 넓힘.
//
// 요청 (POST, JSON)
//   { action: "voices" }                                   → 타입캐스트 목소리 목록(JSON)
//   { action: "tts", text, voice_id, tempo?, pitch?, emotion?, intensity? } → audio/mpeg (mp3)
//
// 필요한 Secret: TYPECAST_API_KEY  (Supabase → Edge Functions → Secrets 에서 사용자가 직접 넣음. 채팅·HTML에 붙여넣지 않기)
// 비용 보호: 관리자만, 한 번에 300자까지 (1글자 = 1크레딧)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TC_KEY = Deno.env.get("TYPECAST_API_KEY") ?? "";
const TC_BASE = "https://api.typecast.ai";
const MODEL = "ssfm-v30";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Chars, X-Prompt",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function requireUser(req: Request): Promise<{ id: string } | null> {
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
async function isAdmin(req: Request, userId: string): Promise<boolean> {
  const key = SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const auth = SERVICE_ROLE_KEY ? `Bearer ${SERVICE_ROLE_KEY}` : (req.headers.get("Authorization") ?? "");
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_admin`, { headers: { apikey: key, Authorization: auth } });
    if (!r.ok) return false;
    const rows = await r.json();
    return !!(Array.isArray(rows) && rows[0] && rows[0].is_admin);
  } catch { return false; }
}

const nameOf = (v: any): string => {
  const n = v?.voice_name;
  if (!n) return String(v?.voice_id ?? "");
  if (typeof n === "string") return n;
  return String(n.kor ?? n.ko ?? n.eng ?? n.en ?? Object.values(n)[0] ?? v.voice_id);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
  const user = await requireUser(req);
  if (!user) return json({ error: "로그인이 필요합니다." }, 401);
  if (!(await isAdmin(req, user.id))) return json({ error: "관리자만 쓸 수 있어요 (목소리 비교용)." }, 403);
  if (!TC_KEY) return json({ error: "TYPECAST_API_KEY Secret이 아직 없어요. Supabase → Edge Functions → Secrets에 넣어 주세요.", code: "no_key" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "요청 본문이 JSON 형식이 아닙니다." }, 400); }
  const action = String(body.action ?? "tts");

  try {
    if (action === "subscription") {
      const r = await fetch(`${TC_BASE}/v1/users/me/subscription`, { headers: { "X-API-KEY": TC_KEY } });
      const t = await r.text();
      if (!r.ok) return json({ error: `타입캐스트 요금제 조회 오류 (${r.status}): ${t.slice(0, 200)}` }, 502);
      let j: any = {}; try { j = JSON.parse(t); } catch { /* 무시 */ }
      return json({ plan: j?.plan ?? "", plan_credits: Number(j?.credits?.plan_credits) || 0, used_credits: Number(j?.credits?.used_credits) || 0, concurrency_limit: Number(j?.limits?.concurrency_limit) || 0, checked_at: new Date().toISOString() });
    }
    if (action === "voices") {
      const r = await fetch(`${TC_BASE}/v3/voices?model=${MODEL}`, { headers: { "X-API-KEY": TC_KEY } });
      const t = await r.text();
      if (!r.ok) return json({ error: `타입캐스트 목소리 목록 오류 (${r.status}): ${t.slice(0, 300)}` }, 502);
      let arr: any[] = [];
      try { const j = JSON.parse(t); arr = Array.isArray(j) ? j : (Array.isArray(j?.voices) ? j.voices : (Array.isArray(j?.result) ? j.result : [])); } catch { arr = []; }
      const voices = arr.map((v) => {
        const m = Array.isArray(v?.models) ? (v.models.find((x: any) => x?.version === MODEL) ?? v.models[0]) : null;
        return {
          voice_id: v?.voice_id, name: nameOf(v), gender: v?.gender ?? "", age: v?.age ?? "",
          use_cases: Array.isArray(v?.use_cases) ? v.use_cases : [], emotions: Array.isArray(m?.emotions) ? m.emotions : [],
          preview_url: v?.preview_url ?? "",
        };
      }).filter((v) => v.voice_id);
      return json({ voices, model: MODEL });
    }

    // action === "tts"
    const text = String(body.text ?? "").trim().slice(0, 300);
    const voice_id = String(body.voice_id ?? "").trim();
    if (!text) return json({ error: "text는 필수입니다." }, 400);
    if (!/^(tc|uc)_[A-Za-z0-9]+$/.test(voice_id)) return json({ error: "voice_id가 올바르지 않아요." }, 400);
    const tempo = Math.min(1.5, Math.max(0.7, Number(body.tempo) || 1.0));
    const pitch = Math.min(6, Math.max(-6, Math.round(Number(body.pitch) || 0)));
    const emotion = String(body.emotion ?? "normal");
    const intensity = Math.min(2, Math.max(0, Number(body.intensity) || 1));
    // 2026-10-21e: smart일 때 앞뒤 문맥(읽지는 않음)을 줄 수 있게 — 문장 끝 억양을 안정시키는 실험용
    const prev = String(body.previous_text ?? "").slice(0, 500), next = String(body.next_text ?? "").slice(0, 500);
    const prompt = emotion === "smart" ? { emotion_type: "smart", ...(prev ? { previous_text: prev } : {}), ...(next ? { next_text: next } : {}) } : { emotion_type: "preset", emotion_preset: emotion, emotion_intensity: intensity };
    const payload: Record<string, unknown> = { model: MODEL, text, voice_id, language: "kor", prompt, output: { audio_format: "mp3", audio_tempo: tempo, audio_pitch: pitch } };

    const call = (p: Record<string, unknown>) => fetch(`${TC_BASE}/v1/text-to-speech`, {
      method: "POST", headers: { "X-API-KEY": TC_KEY, "Content-Type": "application/json" }, body: JSON.stringify(p),
    });
    let res = await call(payload); let promptUsed = "used";
    if (!res.ok && (res.status === 400 || res.status === 422)) {
      promptUsed = "dropped";
      // 감정 설정·언어 칸을 이 목소리가 받지 않으면 기본값으로 한 번 더
      const t0 = await res.text(); console.warn("[타입캐스트 재시도]", res.status, t0.slice(0, 200));
      res = await call({ model: MODEL, text, voice_id, output: { audio_format: "mp3", audio_tempo: tempo, audio_pitch: pitch } });
    }
    if (!res.ok) {
      const t = await res.text();
      const hint = res.status === 401 ? " (API 키 확인)" : res.status === 402 ? " (크레딧 부족)" : res.status === 429 ? " (동시 처리·요청 한도 초과, 잠시 후 다시)" : "";
      return json({ error: `타입캐스트 오류 (${res.status})${hint}: ${t.slice(0, 300)}` }, 502);
    }
    const audio = await res.arrayBuffer();
    if (SERVICE_ROLE_KEY) { try { await fetch(`${SUPABASE_URL}/rest/v1/tts_usage`, { method: "POST", headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ user_id: user.id, provider: "typecast", kind: "preview", chars: text.length }) }); } catch { /* 기록 실패는 무시 */ } }
    return new Response(audio, { status: 200, headers: { ...corsHeaders, "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Chars": String(text.length), "X-Prompt": promptUsed } });
  } catch (e) {
    console.error("typecast-tts 예외", e);
    return json({ error: `서버 오류: ${(e as Error).message}` }, 500);
  }
});
