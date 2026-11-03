// 운영 ZAVAPASS에서 읽어 온 원본 (2026-11-03, 읽기만). 클론(yiuraowvnadqdrnysdce)에만 배포
// 2026-11-03n 클론: 녹음도 타입캐스트로만 (OpenAI 목소리로는 녹음하지 않음)
// 2026-10-21g: 타입캐스트로 녹음한 글자 수를 tts_usage에 남김
// 2026-10-21e: ids로 고른 항목만 다시 녹음
// 2026-10-21d: 질문이 1,000개를 넘으면 뒤쪽이 빠지던 문제 수정 (1,000개씩 나눠 끝까지 읽음)
// 2026-10-21b: 타입캐스트로도 녹음 (provider:"typecast" + tc 설정). 녹음은 대신 읽기 없이, 실패하면 실패로 알려 줌(목소리가 섞이지 않게)
// StenoTalk AI · Step 6 · generate-audio Edge Function (질문·문장 음성 일괄 녹음)
// ------------------------------------------------------------
// 관리자 화면의 "녹음 시작" 버튼이 이 함수를 여러 번 불러서(한 번에 최대 20개) 질문과
// 인사말·시스템 문장·일반형 꼬리질문의 mp3를 만들어 Storage(question-audio)에 저장하고,
// 각 행의 audio_url / audio_text 를 채웁니다. 이미 녹음됐고 문장이 그대로인 행은 건너뜁니다.
//
// 요청 (POST, JSON)
//   { action: "status" }                                   → 남은 개수만 조회 (비용 없음) + 타입캐스트로 녹음된 개수
//   { action: "run", target: "questions"|"lines", limit: 20,
//     force: false, provider: "typecast", tc: { voice_id, tempo, pitch, emotion, intensity } }
// 응답 { processed, failed:[{id,error}], remaining, total, done }
//
// 필요한 Secret: TYPECAST_API_KEY (기본 제공 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 도 사용)
// 관리자만 호출할 수 있어요(profiles.is_admin 확인).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TYPECAST_API_KEY = Deno.env.get("TYPECAST_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const BUCKET = "question-audio";
const CONCURRENCY = 3;          // 동시에 보내는 개수 (타입캐스트 라이트 요금제 동시 5건 안에서, 회사 다른 프로그램 몫 남김)
const MAX_LIMIT = 20;           // 한 번 호출에 최대 처리 개수 (함수 실행 시간 제한 안에서 끝나도록)
const TC_MODEL_TAG = "typecast-ssfm-v30";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ---- 서비스 키로 DB/Storage 접근 (RLS 우회, 함수 안에서만) ----
const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...svcHeaders, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`DB ${res.status}: ${typeof data === "string" ? data.slice(0, 200) : (data?.message || JSON.stringify(data)).slice(0, 200)}`);
  return data;
}

// ---- 호출자: 로그인 + 관리자 ----
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

// ---- 읽을 문장 정리 (클라이언트 sanitizeForSpeech 와 같은 규칙) ----
let FIXES: Record<string, string> = {};   // 요청마다 클라이언트가 보내는 발음 교정 사전 ("노트북" → "노트 북")
function sanitize(text: string) {
  let t = text;
  Object.keys(FIXES).sort((a, b) => b.length - a.length).forEach((k) => { t = t.split(k).join(FIXES[k]); });
  return t.replace(/\s*\/\s*/g, " 또는 ").replace(/·/g, " ").replace(/~/g, "에서 ").replace(/%/g, "퍼센트").replace(/\s{2,}/g, " ").trim();
}

// ---- 타입캐스트 TTS (429·5xx는 최대 3회 재시도, 감정 설정을 못 받는 목소리는 기본값으로) ----
type TcSet = { voice_id: string; tempo: number; pitch: number; emotion: string; intensity: number };
function tcSettings(tc: any): TcSet | null {
  const voice_id = String(tc?.voice_id ?? "").trim();
  if (!/^(tc|uc)_[A-Za-z0-9]+$/.test(voice_id)) return null;
  return { voice_id, tempo: Math.min(1.5, Math.max(0.7, Number(tc?.tempo) || 1.0)), pitch: Math.min(6, Math.max(-6, Math.round(Number(tc?.pitch) || 0))),
    emotion: String(tc?.emotion ?? "normal").slice(0, 30), intensity: Math.min(2, Math.max(0, Number(tc?.intensity) || 1)) };
}
async function ttsTypecast(text: string, s: TcSet): Promise<Uint8Array> {
  const output = { audio_format: "mp3", audio_tempo: s.tempo, audio_pitch: s.pitch };
  const prompt = s.emotion === "smart" ? { emotion_type: "smart" } : { emotion_type: "preset", emotion_preset: s.emotion, emotion_intensity: s.intensity };
  let payload: Record<string, unknown> = { model: "ssfm-v30", text: sanitize(text), voice_id: s.voice_id, language: "kor", prompt, output };
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.typecast.ai/v1/text-to-speech", { method: "POST", headers: { "X-API-KEY": TYPECAST_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    const t = await res.text();
    lastErr = `타입캐스트 ${res.status}: ${t.slice(0, 200)}`;
    if ((res.status === 400 || res.status === 422) && payload.prompt) { payload = { model: "ssfm-v30", text: sanitize(text), voice_id: s.voice_id, output }; continue; }
    if (res.status === 401 || res.status === 402 || res.status === 400 || res.status === 403 || res.status === 422) break;
    await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));          // 429·5xx → 1s, 2s, 4s
  }
  throw new Error(lastErr);
}

// ---- Storage 업로드 (같은 경로면 덮어씀) ----
async function upload(path: string, bytes: Uint8Array): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST", headers: { ...svcHeaders, "Content-Type": "audio/mpeg", "x-upsert": "true" }, body: bytes,
  });
  if (!res.ok) throw new Error(`Storage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}?v=${Date.now()}`;   // ?v= 로 브라우저 캐시 갱신
}

// ---- 대상 조회 ----
type Row = { id: number; text: string };
// contains: 이 단어가 들어간 문장만 (다시) 녹음 — 특정 단어 발음만 고칠 때. 이미 이번 설정으로 만든 것(audio_at이 since 이후)은 제외
async function pending(target: string, force: boolean, limit: number, contains = "", since = "", ids: number[] = []): Promise<{ rows: Row[]; remaining: number; total: number; tc: number; chars: number }> {
  const textOf = (r: any) => target === "questions" ? (r.q_spoken || r.q) : r.text;
  // 2026-10-21d: 한 번에 1,000줄까지만 오는 제한 때문에 질문이 1,000개를 넘으면 뒤쪽이 빠졌음 → 1,000개씩 나눠 끝까지 읽음
  const base = target === "questions"
    ? `questions?is_active=eq.true&select=id,q,q_spoken,audio_url,audio_text,audio_at,audio_model&order=id.asc`
    : `voice_lines?is_active=eq.true&select=id,text,audio_url,audio_text,audio_at,audio_model&order=id.asc`;
  const all: any[] = [];
  for (let off = 0; off < 50000; off += 1000) {
    const page = await rest(`${base}&limit=1000&offset=${off}`);
    if (!Array.isArray(page) || !page.length) break;
    all.push(...page);
    if (page.length < 1000) break;
  }
  let need: any[];
  if (ids.length) {
    // 2026-10-21e: 끝음이 이상하게 녹음된 항목만 골라 다시 녹음 (관리자 화면의 '끝음 점검'에서 보냄)
    need = (all as any[]).filter((r) => ids.includes(r.id) && !(since && r.audio_at && r.audio_at >= since));
  } else if (contains) {
    need = (all as any[]).filter((r) => textOf(r).includes(contains) && !(since && r.audio_at && r.audio_at >= since));
  } else {
    need = (all as any[]).filter((r) => force || !r.audio_url || r.audio_text !== textOf(r));
  }
  const tc = (all as any[]).filter((r) => r.audio_url && r.audio_model === TC_MODEL_TAG && r.audio_text === textOf(r)).length;
  const chars = (all as any[]).reduce((s, r) => s + String(textOf(r) || "").length, 0);
  return { rows: need.slice(0, limit).map((r) => ({ id: r.id, text: textOf(r) })), remaining: need.length, total: all.length, tc, chars };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
  if (!SERVICE_KEY || !SUPABASE_URL) return json({ error: "서버 설정(SUPABASE_SERVICE_ROLE_KEY)이 없습니다." }, 500);
  const admin = await requireAdmin(req);
  if (!admin) return json({ error: "관리자만 사용할 수 있어요. (로그인 상태와 관리자 권한을 확인해 주세요)" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "요청 본문이 JSON 형식이 아닙니다." }, 400); }
  const action = body.action === "status" ? "status" : "run";
  const target = body.target === "lines" ? "lines" : "questions";
  const force = !!body.force;

  try {
    if (action === "status") {
      const q = await pending("questions", false, 0);
      const l = await pending("lines", false, 0);
      return json({ questions: { total: q.total, remaining: q.remaining, typecast: q.tc, chars: q.chars }, lines: { total: l.total, remaining: l.remaining, typecast: l.tc, chars: l.chars }, typecast_key: !!TYPECAST_API_KEY });
    }
    const tcs = tcSettings(body.tc);   // 2026-11-03n 타입캐스트로만 녹음
    if (!TYPECAST_API_KEY) return json({ error: "TYPECAST_API_KEY Secret이 설정되어 있지 않습니다." }, 500);
    if (!tcs) return json({ error: "타입캐스트 목소리가 정해지지 않았어요. 관리자 › 기본 목소리에서 타입캐스트 목소리를 골라 저장해 주세요." }, 400);

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || 10));
    FIXES = {};
    if (body.fixes && typeof body.fixes === "object") {
      Object.entries(body.fixes).slice(0, 200).forEach(([k, v]) => { if (typeof k === "string" && typeof v === "string" && k && v) FIXES[k] = v; });
    }

    const contains = String(body.contains ?? "").trim().slice(0, 40);
    const since = String(body.since ?? "").trim();
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Math.floor(Number(x))).filter((x: number) => x > 0).slice(0, 500) : [];   // 다시 녹음할 항목 id (since와 같이 쓰면 이번 작업에서 이미 만든 것은 건너뜀)
    // "전체 다시 녹음": force가 오면 질문·문장 전체의 audio_text를 비워 "녹음 필요" 상태로 바꾸고, 이후 호출은 남은 것을 이어서 녹음.
    let useForce = force;
    if (force && !contains && !ids.length) {
      await rest(`questions?is_active=eq.true`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ audio_text: null }) });
      await rest(`voice_lines?is_active=eq.true`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ audio_text: null }) });
      useForce = false;
    }
    const { rows, remaining, total } = await pending(target, useForce, limit, contains, since, ids);
    const table = target === "questions" ? "questions" : "voice_lines";
    const prefix = target === "questions" ? "q" : "l";
    const failed: { id: number; error: string }[] = [];
    let processed = 0, chars = 0;

    // 동시 3개씩 처리
    let idx = 0;
    async function worker() {
      while (idx < rows.length) {
        const row = rows[idx++];
        try {
          const bytes = await ttsTypecast(row.text, tcs as TcSet);
          if (bytes.length < 500) throw new Error("음성 데이터가 비어 있음");
          const url = await upload(`${prefix}/${row.id}.mp3`, bytes);
          await rest(`${table}?id=eq.${row.id}`, {
            method: "PATCH", headers: { Prefer: "return=minimal" },
            body: JSON.stringify({ audio_url: url, audio_text: row.text, audio_voice: `tc:${(tcs as TcSet).voice_id}`, audio_model: TC_MODEL_TAG, audio_at: new Date().toISOString() }),
          });
          processed++; chars += row.text.length;
        } catch (e) {
          failed.push({ id: row.id, error: (e as Error).message });
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

    if (tcs && chars) { try { await rest(`tts_usage`, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: admin.id, provider: "typecast", kind: "record", chars }) }); } catch (e) { console.warn("[사용 기록 실패]", (e as Error).message); } }
    const left = Math.max(0, remaining - processed);
    return json({ target, processed, failed, remaining: left, total, done: left === 0 && failed.length === 0, provider: "typecast", chars });
  } catch (e) {
    console.error("generate-audio 예외", e);
    return json({ error: `서버 오류: ${(e as Error).message}` }, 500);
  }
});
