// 운영 ZAVAPASS에서 읽어 온 원본 (2026-11-03, 읽기만). 클론(yiuraowvnadqdrnysdce)에만 배포
// 2026-11-03 한림대용: 속기사 채용 → 대학생 채용 면접으로 프롬프트 교체
// 2026-10-23a: 안내 문구의 '교육팀' → '담당자' (부서 이름을 특정하지 않음)
// 2026-10-22v: OpenAI 일시 오류(5xx·429)면 한 번 더, 응답이 비거나 형식이 깨지면 토큰을 늘려 한 번 더 (예전에는 바로 502)
// 2026-10-15: 승인 대기(연습 분야 권한 없음)·이용 기간 종료 계정의 요청은 403 not_approved로 거절 (관리자는 통과)
// StenoTalk AI · intro-coach Edge Function (2026-10-08)
// ------------------------------------------------------------
// 1분 자기소개 코치: 자기소개서·이력서 요약과(있으면) 지원자가 직접 해 본 자기소개를 받아
// 1분 분량의 자기소개 대본과 핵심 포인트, 말하기 팁을 만들어 돌려줍니다.
//
// 요청 (POST, JSON)
//   {
//     field_id   : "gov" | "pubcorp" | "corp" | "startup" | "welfare" | "major" (모르는 값은 일반 대학생 취업 면접),
//     field_name : "공무원" 등 (화면에 보이는 분야 이름, 없으면 '지원 분야'),
//     resume_summary : "자기소개서 앞부분(최대 2,000자)",   // 선택
//     cv_summary     : "이력서 앞부분(최대 1,500자)",        // 선택
//     draft          : "지원자가 직접 말하거나 적은 자기소개(최대 1,500자)"   // 선택
//   }
//   셋(자기소개서·이력서·직접 한 자기소개) 중 하나는 있어야 합니다.
// 응답
//   { script, points[], tips[], feedback, model, limit:{left, limit} }
//
// 1인 하루 10회 (step14_intro_coach.sql의 intro_coach_try RPC). 관리자는 제한 없음.
// 필요한 Secret: OPENAI_API_KEY (필수), OPENAI_MODEL (선택, 기본 gpt-5.6-luna)
// 배포: verify_jwt 끔 (함수 안에서 로그인 토큰을 직접 확인)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";
const FALLBACK_MODEL = "gpt-4o-mini";
const DAILY_LIMIT = 10;
const RETRY_WINDOW_MS = 12000;   // 2026-10-22v 일시 오류 재시도는 첫 응답이 이 시간 안에 왔을 때만 (화면은 45초까지 기다림)

function isNewGen(model: string) { return /^(gpt-5|o\d|gpt-6)/i.test(model); }
function buildBody(model: string, messages: unknown[], temperature: number, maxTokens: number) {
  const body: Record<string, unknown> = { model, messages, response_format: { type: "json_object" } };
  if (isNewGen(model)) { body.max_completion_tokens = maxTokens; }
  else { body.temperature = temperature; body.max_tokens = maxTokens; }
  return body;
}
async function callOpenAI(apiKey: string, model: string, messages: unknown[], temperature: number, maxTokens: number): Promise<{ res: Response; modelUsed: string }> {
  const send = (body: Record<string, unknown>) => fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const body = buildBody(model, messages, temperature, maxTokens);
  const t0 = Date.now();
  let res = await send(body);
  // 2026-10-22v: OpenAI 쪽 일시 오류(5xx)·혼잡(429)이면 0.7초 뒤 한 번만 다시
  if ((res.status >= 500 || res.status === 429) && Date.now() - t0 < RETRY_WINDOW_MS) {
    const first = await res.text().catch(() => "");
    console.warn("[OpenAI 일시 오류 → 한 번 더]", res.status, first.slice(0, 160));
    await new Promise((r) => setTimeout(r, 700));
    res = await send(body);
  }
  if (res.status === 400) {
    const t = await res.clone().text();
    if (/temperature|max_tokens|max_completion_tokens|unsupported/i.test(t)) {
      delete body.temperature; delete body.max_tokens; body.max_completion_tokens = maxTokens;
      res = await send(body);
    }
  }
  if ((res.status === 404 || res.status === 400) && model !== FALLBACK_MODEL) {
    const t = await res.clone().text();
    if (/model|not found|does not exist/i.test(t)) {
      console.warn(`[모델 ${model} 사용 불가 → ${FALLBACK_MODEL}로 대체]`, t.slice(0, 200));
      res = await send(buildBody(FALLBACK_MODEL, messages, temperature, maxTokens));
      return { res, modelUsed: FALLBACK_MODEL };
    }
  }
  return { res, modelUsed: model };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
async function requireUser(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !SUPABASE_URL) return null;
  if (token === SUPABASE_ANON_KEY) return null;
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
async function requireApproved(req: Request, userId: string): Promise<{ ok: boolean; reason?: string }> {
  const key = SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const auth = SERVICE_ROLE_KEY ? `Bearer ${SERVICE_ROLE_KEY}` : (req.headers.get("Authorization") ?? "");
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=is_admin,allowed_fields,access_until`, { headers: { apikey: key, Authorization: auth } });
    if (!r.ok) { console.warn("[승인 확인 실패 → 통과]", r.status, (await r.text()).slice(0, 200)); return { ok: true }; }
    const rows = await r.json();
    const p = Array.isArray(rows) ? rows[0] : null;
    if (!p) return { ok: false, reason: "no_profile" };
    if (p.is_admin) return { ok: true };
    const fields = Array.isArray(p.allowed_fields) ? p.allowed_fields.filter(Boolean) : [];
    if (!fields.length) return { ok: false, reason: "pending" };
    if (p.access_until) {
      const todayKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      if (String(p.access_until).slice(0, 10) < todayKst) return { ok: false, reason: "expired" };
    }
    return { ok: true };
  } catch (e) { console.warn("[승인 확인 예외 → 통과]", (e as Error).message); return { ok: true }; }
}
const NOT_APPROVED_MSG: Record<string, string> = {
  pending: "담당자 승인 후 사용할 수 있어요.",
  expired: "이용 기간이 끝나 사용할 수 없어요.",
  no_profile: "등록 정보가 없는 계정이에요.",
};
async function checkDailyLimit(req: Request): Promise<{ ok: boolean; status?: Record<string, unknown> }> {
  const auth = req.headers.get("Authorization") ?? "";
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/intro_coach_try`, {
      method: "POST",
      headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_limit: DAILY_LIMIT }),
    });
    if (!r.ok) { console.warn("[intro_coach_try 실패 → 제한 없이 통과]", r.status, (await r.text()).slice(0, 200)); return { ok: true }; }
    const st = await r.json();
    if (st && st.allowed === false) return { ok: false, status: st };
    return { ok: true, status: st };
  } catch (e) { console.warn("[intro_coach_try 예외 → 제한 없이 통과]", (e as Error).message); return { ok: true }; }
}

// 2026-11-03 한림대용: 한림대 5개 분야 + 전공·경험 면접(major)
const FIELD_FOCUS: Record<string, string> = {
  gov: "공무원(국가직·지방직 등). 공직가치(공정·청렴·책임·봉사)를 보여 주는 경험, 민원인을 대하는 태도, 규정과 사정이 부딪힐 때의 판단이 핵심입니다.",
  pubcorp: "공공기관·공기업. 공공성과 기관의 주요 사업 이해, NCS 직업기초능력(의사소통·문제해결·직업윤리 등)이 드러나는 경험, 지원 직무와의 연결이 핵심입니다.",
  corp: "대기업·중견기업. 지원 직무에 맞는 역량을 증명하는 경험, 숫자로 말하는 성과, 팀 안에서의 역할과 협업이 핵심입니다.",
  startup: "스타트업·중소기업. 스스로 문제를 찾아 실행한 경험, 빠르게 배우는 힘, 주도성과 책임감이 핵심입니다.",
  welfare: "교육·복지·비영리 기관. 대상자에 대한 공감과 존중, 윤리 의식, 이용자 중심으로 생각하고 행동한 경험이 핵심입니다.",
  major: "전공·경험 면접. 수강 과목·전공 지식과 프로젝트·활동 경험을 깊이 이해하고 자기 말로 설명하는 힘, 그 경험이 지원 직무·진로로 이어지는 흐름이 핵심입니다.",
};

const SYSTEM = `당신은 대학생 취업 면접을 지도해 온 면접 코치입니다. 지원자는 한림대학교 재학생·졸업예정자입니다. 지원자가 실제 면접장에서 "1분 자기소개"로 그대로 말할 수 있는 대본을 만들어 줍니다.

[대본 규칙 — 반드시 지킵니다]
1. 길이: 소리 내어 읽었을 때 50~60초. 공백을 뺀 글자 수 260~320자.
2. 구성: ① 첫 문장 — 나를 한 줄로 보여 주는 강점 키워드 ② 그 강점의 근거가 되는 경험 1~2개(기간·횟수·인원·자격·성과 같은 숫자를 서류나 지원자의 말에서 가져와서. 실무 경력이 없으면 수업·팀 프로젝트·동아리·아르바이트·인턴·봉사 경험에서 고름) ③ 그 경험이 지원 직무에 어떻게 이어지는지 ④ 입사 후 각오 한 문장.
3. 사실만: 자기소개서·이력서·지원자가 직접 한 말에 있는 내용만 씁니다. 없는 경력·수치·자격을 지어내지 않습니다. 꼭 필요한 정보가 없으면 [활동 기간], [자격증 이름]처럼 대괄호 자리표시로 남겨 지원자가 채우게 합니다(최대 3곳).
4. 블라인드 면접: 이름·학교 이름·출신 지역·나이·가족·연락처는 넣지 않습니다. "안녕하십니까, 지원자 ○○○입니다" 같은 이름 소개 대신 "안녕하십니까, ○○를 갖춘 지원자입니다"처럼 시작합니다.
5. 말하기 문장: 한 문장은 40자 안팎으로 짧게, "~습니다" 존댓말. 어려운 한자어·외래어·괄호·기호·이모지·번호 매기기 금지.
6. 상투어 금지: "성실함과 책임감", "최선을 다하겠습니다", "열정" 같은 말을 근거 없이 쓰지 않습니다.

[함께 돌려줄 것]
- points: 이 대본에서 면접관 기억에 남아야 할 핵심 3가지(각 20자 이내 명사구).
- tips: 이 지원자가 말할 때 주의할 점 2~3개(각 50자 이내, 실제 행동으로).
- feedback: 지원자가 직접 한 자기소개가 있으면 그에 대한 평가 1~2문장(무엇이 좋았고 무엇이 빠졌는지, 길이는 적절했는지). 없으면 빈 문자열.

반드시 아래 JSON으로만 답합니다:
{"script":"...", "points":["...","...","..."], "tips":["...","..."], "feedback":"..."}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
  const user = await requireUser(req);
  if (!user) return json({ error: "로그인이 필요합니다. (인증 토큰 없음 또는 만료)" }, 401);
  { const ap = await requireApproved(req, user.id); if (!ap.ok) return json({ error: "not_approved", reason: ap.reason, message: NOT_APPROVED_MSG[ap.reason ?? "pending"] ?? NOT_APPROVED_MSG.pending }, 403); }   // 2026-10-15 승인 대기·기간 종료 계정 거절
  if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY Secret이 설정되어 있지 않습니다." }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "요청 본문이 JSON 형식이 아닙니다." }, 400); }
  const fieldId = String(body.field_id ?? "").trim();
  const fieldName = String(body.field_name ?? "").trim().slice(0, 40) || "지원 분야";
  const resume = String(body.resume_summary ?? "").trim().slice(0, 2000);
  const cv = String(body.cv_summary ?? "").trim().slice(0, 1500);
  const draft = String(body.draft ?? "").trim().slice(0, 1500);
  if (!resume && !cv && draft.replace(/\s/g, "").length < 20) {
    return json({ error: "자기소개서·이력서를 올리거나, 자기소개를 20자 이상 직접 말하거나 적어 주세요." }, 400);
  }
  const lim = await checkDailyLimit(req);
  if (!lim.ok) return json({ error: "limit", limit: lim.status }, 429);

  const userPrompt = [
    `[지원 분야] ${fieldName}\n${(Object.prototype.hasOwnProperty.call(FIELD_FOCUS, fieldId) ? FIELD_FOCUS[fieldId] : "") || "대학생 취업 면접. 지원 직무에 대한 이해, 구체적인 경험과 성과, 협업과 성장 가능성이 핵심입니다."}`,
    resume ? `[자기소개서 요약]\n${resume}` : "[자기소개서] 없음",
    cv ? `[이력서 요약 — 학력·경력·자격 (개인정보는 대본에 넣지 않음)]\n${cv}` : "[이력서] 없음",
    draft ? `[지원자가 직접 해 본 자기소개 (음성 인식 결과일 수 있어 오탈자가 있을 수 있음)]\n${draft}` : "[지원자가 직접 해 본 자기소개] 없음",
    draft ? "지원자가 직접 한 자기소개의 표현과 경험을 최대한 살려 다듬어 주세요." : "서류 내용 중 지원 분야와 가장 잘 이어지는 경험을 골라 주세요.",
  ].join("\n\n");

  try {
    const msgs = [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt },
    ];
    const startedAt = Date.now();
    // 2026-10-22v: 1600 → 2600 (추론형 모델이 생각에 토큰을 먼저 써서 대본이 비는 경우가 있었음)
    let { res, modelUsed } = await callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, msgs, 0.6, 2600);
    if (!res.ok) {
      const t = await res.text();
      console.error("OpenAI 오류", res.status, t);
      return json({ error: `OpenAI API 오류 (${res.status}): ${t.slice(0, 300)}` }, 502);
    }
    let data = await res.json();
    let content: string = data?.choices?.[0]?.message?.content ?? "";
    const tryParse = (c: string) => { try { const p = JSON.parse(c); return p && String(p.script ?? "").trim() ? p : null; } catch { return null; } };
    let parsed: any = tryParse(content);
    if (!parsed && Date.now() - startedAt < 20000) {
      console.warn("[자기소개 대본 비었음/형식 오류 → 토큰 늘려 한 번 더]", data?.choices?.[0]?.finish_reason, content.slice(0, 80));
      const again = await callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, msgs, 0.6, 4000);
      if (again.res.ok) { data = await again.res.json(); content = data?.choices?.[0]?.message?.content ?? ""; modelUsed = again.modelUsed; parsed = tryParse(content); }
    }
    if (!parsed) { console.warn("[자기소개 대본 해석 실패]", content.slice(0, 120)); return json({ error: "AI 응답을 해석하지 못했습니다.", raw: content.slice(0, 300) }, 502); }
    const script = String(parsed.script ?? "").trim();
    if (!script) return json({ error: "대본이 비어 있습니다." }, 502);
    const arr = (v: unknown, n: number) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : [];
    return json({
      script,
      points: arr(parsed.points, 3),
      tips: arr(parsed.tips, 3),
      feedback: String(parsed.feedback ?? "").trim(),
      model: modelUsed,
      limit: lim.status ?? null,
    });
  } catch (e) {
    console.error("intro-coach 예외", e);
    return json({ error: `서버 오류: ${(e as Error).message}` }, 500);
  }
});
