// 2026-11-04 클론(yiuraowvnadqdrnysdce) 전용 · rewrite-answer: 학생 답변을 "같은 학생이 그대로 말할 수 있는" 더 좋은 답변으로 고쳐 씀
// grade-answer와 같은 로그인·승인·AI 횟수 확인을 씀. 하루에 한 번만 횟수로 셈(interview_id = rewrite-날짜)
// 요청: { question, answer, feedback?, field?, field_id?, qtype?, company_id?, company_seq?, purpose?, job_role?, major_dept? }
// 응답: { rewrite: "고친 답변", points: ["무엇을 왜 고쳤는지", ...] }
// 지어낸 경험·숫자·회사 사실은 쓰지 않고, 필요하면 "(예: 참여 인원)"처럼 채울 자리를 표시함

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { loadCompanyPack, buildCompanyBlock } from "../_shared/company_prompt.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";   // 사용자 선택: Luna (가장 저렴). Secrets의 OPENAI_MODEL로 변경 가능

// ---- 모델별 호출 파라미터 보정 (Luna/Terra 같은 GPT-5 계열은 max_tokens 대신 max_completion_tokens, temperature 미지원) ----
const FALLBACK_MODEL = "gpt-4o-mini";
function isNewGen(model: string) { return /^(gpt-5|o\d|gpt-6)/i.test(model); }
function buildBody(model: string, messages: unknown[], temperature: number, maxTokens: number) {
  const body: Record<string, unknown> = { model, messages, response_format: { type: "json_object" } };
  if (isNewGen(model)) { body.max_completion_tokens = maxTokens; }
  else { body.temperature = temperature; body.max_tokens = maxTokens; }
  return body;
}
/** OpenAI 호출: 파라미터 거부(400)면 문제 파라미터를 빼고 1회 재시도, 모델 없음이면 폴백 모델로 1회 재시도 */
const RETRY_WINDOW_MS = 9000;   // 2026-10-22v 일시 오류 재시도는 첫 응답이 이 시간 안에 왔을 때만
async function callOpenAI(apiKey: string, model: string, messages: unknown[], temperature: number, maxTokens: number): Promise<{ res: Response; modelUsed: string }> {
  const send = (body: Record<string, unknown>) => fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const body = buildBody(model, messages, temperature, maxTokens);
  const t0 = Date.now();
  let res = await send(body);
  // 2026-10-22v: OpenAI 쪽 일시 오류(5xx)·혼잡(429)이면 0.7초 뒤 한 번만 다시 (처음 응답이 빨리 온 경우에만 — 화면 대기 시간이 길어지지 않게)
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
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---- 분야별 직무 맥락 (채점자가 "무엇이 좋은 답인지" 판단하는 기준) ----
// 2026-11-03 한림대용: 화면의 분야 id(gov·pubcorp·corp·startup·welfare) + 전공·경험 면접(major). 모르는 id는 일반 대학생 취업 면접
const FIELD_CONTEXT: Record<string, string> = {
  gov: `공무원(국가직·지방직 등) 면접: 공직가치(공정·청렴·책임·봉사), 민원 대응 태도, 규정과 민원인의 사정이 부딪힐 때의 판단을 봅니다. 좋은 답변은 원칙을 지키면서도 설명과 대안을 찾는 과정, 공익이나 규칙을 지킨 학교·봉사·아르바이트 경험, 지역·정책 현안에 대한 자기 생각을 구체적으로 담습니다. 어느 직장에나 통하는 일반론만 있으면 직무 연결 점수를 낮게 줍니다.`,
  pubcorp: `공공기관·공기업 면접: 공공성(국민·이용자의 편익)과 기관의 설립 목적·주요 사업에 대한 이해, NCS 직업기초능력(의사소통·문제해결·조직이해·대인관계·직업윤리 등)을 봅니다. 좋은 답변은 지원 직무(행정·사무·기술)의 실제 업무와 본인 경험을 연결하고, 규정 준수와 고객 만족을 함께 고민한 사례를 상황·행동·결과로 보여 줍니다.`,
  corp: `대기업·중견기업 면접: 직무 역량, 성과, 협업을 봅니다. 좋은 답변은 지원 직무(영업·마케팅·인사·재무 등)에 필요한 역량을 경험으로 증명하고, 성과를 숫자로 말하며, 팀 안에서 본인 역할과 협업 방식을 분명히 하고, 회사·산업에 대한 이해와 입사 후 기여 방향을 담습니다.`,
  startup: `스타트업·중소기업 면접: 실행력, 학습 속도, 주도성을 봅니다. 좋은 답변은 정해진 답이 없는 문제를 스스로 찾아 실행한 경험, 데이터나 사용자 반응으로 개선한 과정, 짧은 기간에 새로 배운 것, 작은 팀에서 여러 역할을 맡은 유연함을 시도→결과→배운 점 흐름으로 담습니다.`,
  welfare: `교육·복지·비영리 기관 면접: 공감, 윤리, 이용자 중심 태도를 봅니다. 좋은 답변은 대상자(학생·이용자·주민)를 존중하는 구체적인 행동, 개인정보와 인권을 지키는 원칙, 봉사·멘토링·프로그램 경험에서 본인이 한 일과 대상자의 변화, 갈등이나 지치는 상황의 대처를 담습니다. 선의만 말하고 행동이 없으면 구체성 점수를 낮게 줍니다.`,
  major: `전공·경험 면접: 수강한 과목·전공 개념과 팀 프로젝트·캡스톤·연구·동아리·대외활동 경험을 깊이 이해하고 자기 말로 설명하는지 봅니다. 좋은 답변은 개념을 정확히 설명하고, 왜 그 방법을 골랐는지, 본인이 맡은 부분과 결과, 어려움과 배운 점, 지원 직무·진로와의 연결을 담습니다. 외운 정의만 있고 적용이 없으면 내용 점수를 낮게 줍니다.`,
};
const DEFAULT_FIELD_CONTEXT = `대학생 취업 면접: 지원 동기와 직무 이해, 경험에서 드러나는 역량(협업·문제 해결·책임감·성장)을 봅니다. 좋은 답변은 학교·대외활동·아르바이트 경험의 상황·행동·결과, 본인 역할, 숫자, 지원 직무와의 연결을 담습니다.`;
const QTYPE_CRITERIA: Record<string, string> = {
  intro: "자기소개: 한 문장으로 자신을 규정 → 지원 분야와 연결된 강점 1~2개 → 강점을 뒷받침하는 경험(수치) → 포부·마무리. 30초~1분 분량.",
  motive: "지원 동기: 왜 '이 기관·회사·직무'인지(다른 곳과의 차이) → 직무를 구체적으로 이해한 근거 → 자신의 경험과의 연결 → 장기 목표.",
  experience: "경험: 상황(S) → 본인의 역할·과제(T) → 실제 행동(A) → 결과·수치(R). 팀 성과와 본인 몫을 구분했는지.",
  situation: "상황 대처: 첫 행동의 순서 → 판단 근거(규정·절차·우선순위) → 부작용과 보완책 → 결과. 일정·품질·관계처럼 여러 가치가 부딪힐 때 무엇을 우선하고 왜인지.",
  knowledge: "직무·전공 지식: 용어·개념·절차의 정확성 → 실무나 본인 프로젝트에 적용한 예 → 한계·주의점. 틀린 사실은 감점.",
  general: "가치관·태도: 원칙 제시 → 원칙이 흔들리는 갈등 사례 → 그때의 선택과 근거.",
  followup: "꼬리질문 답변: 면접관이 요구한 근거·수치·순서가 실제로 나왔는지, 앞선 답변과 일관되는지.",
};

const SYSTEM_PROMPT = `당신은 대학생 채용 면접 코치입니다. 지원자는 한림대학교 재학생·졸업예정자입니다. 지원자의 답변을 "같은 사람이 다음 면접에서 그대로 말할 수 있는" 더 좋은 답변으로 고쳐 씁니다.

[고쳐 쓰기 규칙]
- 지원자가 말한 경험·사실·수치·이름만 씁니다. 답변에 없는 경험, 숫자, 기간, 회사·기관의 사업이나 사실을 지어내지 않습니다. 더 넣으면 좋은 정보는 "(예: 참여 인원)"처럼 괄호로 채울 자리를 표시합니다(최대 3곳).
- 두괄식: 첫 문장에 질문에 대한 결론(핵심)을 말하고, 이어서 근거 경험(상황 → 본인의 행동 → 결과), 마지막 문장에서 지원 직무·기관과 연결합니다.
- 말로 하는 답변입니다. 격식 있는 존댓말("~습니다")로, 문장은 짧게 끊고, 군말("어", "그러니까", "약간")과 같은 말 반복을 뺍니다.
- 분량은 250~400자(말하면 45초~1분)입니다. 원래 답변이 매우 짧으면 채울 자리를 둔 틀로 늘립니다.
- 원래 답변의 좋은 표현과 핵심 단어는 그대로 살립니다. 바뀐 부분이 한눈에 보이도록, 고칠 필요가 있는 곳만 고칩니다.
- 기업 맞춤 자료가 있으면 인재상 키워드를 자연스럽게 한 번만 연결합니다. 회사의 구체적 사업·수치·뉴스는 쓰지 않습니다.
- 채점 피드백이 주어지면 그 피드백이 지적한 점을 반영합니다.
- 답변이 질문과 무관하거나 "모르겠다" 수준이면, 지원자 답변 대신 채울 자리를 둔 답변 틀을 씁니다.
- points: 무엇을 왜 고쳤는지 2~4개, 각각 35자 이내 행동형 구절 (예: "결론을 첫 문장으로 옮김", "1,000시간 실습을 근거로 앞에 배치").

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.
{"rewrite": "문자열", "points": ["..."]}`;

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


// ---- 1인당 AI 횟수 제한 (step7_ai_usage_limit.sql의 ai_usage_try RPC). 같은 면접(interview_id)은 한 번만 세어짐.
//      RPC가 없거나(미실행) 오류가 나면 제한 없이 통과(기능이 멈추지 않도록) — 대신 로그에 남김.
async function checkUsageLimit(req: Request, interviewId: string): Promise<{ ok: boolean; status?: Record<string, unknown> }> {
  if (!interviewId) return { ok: true };
  const auth = req.headers.get("Authorization") ?? "";
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_usage_try`, {
      method: "POST",
      headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_interview_id: interviewId }),
    });
    if (!r.ok) { console.warn("[ai_usage_try 호출 실패 → 제한 없이 통과]", r.status, (await r.text()).slice(0, 200)); return { ok: true }; }
    const st = await r.json();
    if (st && st.allowed === false) return { ok: false, status: st };
    return { ok: true, status: st };
  } catch (e) { console.warn("[ai_usage_try 예외 → 제한 없이 통과]", (e as Error).message); return { ok: true }; }
}

// ---- 2026-11-03 한림대용: 선택 입력값 다듬기 + 기업 맞춤 자료 ----
/** 표에 있는 키만 꺼냄 ('constructor' 같은 이름이 들어와도 엉뚱한 값이 나오지 않게) */
function pick<T>(o: Record<string, T>, k: string): T | undefined { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; }
/** 화면에서 온 짧은 글: 줄바꿈·제어문자·괄호·따옴표를 빼고 n자까지 (프롬프트 형식이 깨지지 않게) */
function cleanText(v: unknown, n: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f<>{}\[\]`"\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
}
/** 기업 맞춤 단락: 회사 자료를 호출자 토큰(JWT)으로 get_company_pack에서 읽어 만듦. 없거나 실패하면 빈 문자열 → 일반 채점 */
async function companyBlockFor(req: Request, companyId: string, mode: "followup" | "grade", seq?: number): Promise<string> {
  if (!companyId || !SUPABASE_URL || !SUPABASE_ANON_KEY) return "";
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 3000));   // 회사 자료가 늦으면 기다리지 않음
    const pack = await Promise.race([loadCompanyPack(sb, companyId), timeout]);
    return pack ? buildCompanyBlock(pack, mode, seq) : "";
  } catch (e) { console.warn("[기업 자료 읽기 실패 → 일반 채점으로]", (e as Error).message); return ""; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST 요청만 허용됩니다." }, 405);
  const user = await requireUser(req);
  if (!user) return json({ error: "로그인이 필요합니다. (인증 토큰 없음 또는 만료)" }, 401);
  { const ap = await requireApproved(req, user.id); if (!ap.ok) return json({ error: "not_approved", reason: ap.reason, message: NOT_APPROVED_MSG[ap.reason ?? "pending"] ?? NOT_APPROVED_MSG.pending }, 403); }
  if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY Secret이 설정되어 있지 않습니다." }, 500);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); } catch { return json({ error: "요청 본문이 JSON 형식이 아닙니다." }, 400); }
  const question = String(payload.question ?? "").trim().slice(0, 500);
  const answer = String(payload.answer ?? "").trim().slice(0, 3000);
  const feedback = String(payload.feedback ?? "").replace(/\[(리포트|전달력)[^\]]*\][^\n]*/g, "").trim().slice(0, 1500);
  if (!question || !answer) return json({ error: "question과 answer는 필수입니다." }, 400);

  const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const lim = await checkUsageLimit(req, `rewrite-${day}`);
  if (!lim.ok) return json({ error: "limit", limit: lim.status }, 429);

  const fieldId = String(payload.field_id ?? "").trim();
  const fieldName = cleanText(payload.field, 40);
  const qtype = String(payload.qtype ?? "").trim();
  const companyId = cleanText(payload.company_id, 20);
  const seqNum = Number(payload.company_seq);
  const companySeq = Number.isInteger(seqNum) && seqNum > 0 && seqNum < 1000 ? seqNum : undefined;
  const purpose = payload.purpose === "major" || payload.purpose === "job" ? String(payload.purpose) : "";
  const jobRole = cleanText(payload.job_role, 40);
  const majorDept = cleanText(payload.major_dept, 40);
  const ctxKey = purpose === "major" ? "major" : fieldId;
  const baseContext = pick(FIELD_CONTEXT, ctxKey) ?? (fieldName ? `${fieldName} 채용 면접(대학생 지원자).` : DEFAULT_FIELD_CONTEXT);
  const info = [jobRole ? `지원 직무: ${jobRole}` : "", majorDept ? `전공(학과): ${majorDept}` : ""].filter(Boolean).join(" · ");
  const criteria = pick(QTYPE_CRITERIA, qtype) ?? "";
  const companyBlock = await companyBlockFor(req, companyId, "grade", companySeq);

  const userPrompt = [
    `[지원 분야와 직무 맥락]\n${baseContext}${info ? `\n[지원 정보] ${info}` : ""}`,
    `[면접 질문]\n${question}`,
    criteria ? `[좋은 답변의 순서]\n${criteria}` : null,
    feedback ? `[이 답변에 대한 채점 피드백]\n${feedback}` : null,
    `[지원자 답변]\n${answer}`,
  ].filter(Boolean).join("\n\n");
  const msgs = [
    { role: "system", content: SYSTEM_PROMPT + (companyBlock ? `\n\n[기업 맞춤 참고 — 인재상 키워드만 참고하고 회사 사실은 지어내지 않습니다]\n${companyBlock}` : "") },
    { role: "user", content: userPrompt },
  ];
  try {
    let { res, modelUsed } = await callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, msgs, 0.4, 2500);
    if (!res.ok) { const t = await res.text(); console.error("OpenAI API 오류:", res.status, t); return json({ error: `OpenAI API 오류 (${res.status}): ${t.slice(0, 300)}` }, 502); }
    let data = await res.json();
    let content: string = data?.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      const retry = await callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, msgs, 0.4, 4000);
      if (retry.res.ok) { data = await retry.res.json(); content = data?.choices?.[0]?.message?.content ?? ""; modelUsed = retry.modelUsed; }
    }
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(content); } catch { return json({ error: "AI 응답을 해석하지 못했습니다." }, 502); }
    const rewrite = String(parsed.rewrite ?? "").trim();
    if (!rewrite) return json({ error: "고친 답변이 비어 있어요." }, 502);
    const points = Array.isArray(parsed.points) ? parsed.points.map((x) => String(x).slice(0, 60)).slice(0, 4) : [];
    return json({ rewrite: rewrite.slice(0, 1200), points, limit: lim.status ?? null, model: modelUsed });
  } catch (e) {
    console.error("rewrite-answer 예외:", e);
    return json({ error: `서버 오류: ${(e as Error).message}` }, 500);
  }
});
