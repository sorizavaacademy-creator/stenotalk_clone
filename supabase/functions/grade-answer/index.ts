// 운영 ZAVAPASS에서 읽어 온 원본 (2026-11-03, 읽기만). 클론(yiuraowvnadqdrnysdce)에만 배포
// 2026-11-03 한림대용: 속기사 채용 → 대학생 채용 면접으로 프롬프트 교체
// 2026-10-23a: 안내 문구의 '교육팀' → '담당자' (부서 이름을 특정하지 않음)
// 2026-10-22v: OpenAI 일시 오류(5xx·429)면 0.7초 뒤 한 번 더 (첫 응답이 9초 안에 왔을 때만)
// 2026-10-22s: 쌓인 기록 분석 반영 — 짧은 사실 질문 감점 금지·최신 사실 단정 금지, 답하지 못한 답변 억지 칭찬 금지, 꾸준함 표현은 감점 안 함
// 2026-10-22q: 피드백 틀(칭찬→다만) 없앰, 5~7문장 두 문단으로 늘리고 예시 표현을 피드백 안에 넣음. rewrite(이렇게 말해 보세요)는 빈 값
// 2026-10-19e: 빈 응답(추론 토큰 소진) 방지 — 출력 한도 700→2000, 비면 3500으로 1회 재시도 / 분야별 직무 맥락 보강
// 2026-10-15: 승인 대기(연습 분야 권한 없음)·이용 기간 종료 계정의 요청은 403 not_approved로 거절 (관리자는 통과)
// StenoTalk AI · grade-answer Edge Function (OpenAI 버전) — 2026-09-30 지시문 고도화: 배점표·질문 유형 기준·직무 맥락·개선 예시(rewrite)
// ------------------------------------------------------------
// 클라이언트(index.html)의 gradeAnswerWithAI()가 호출합니다.
// 요청:  { question, reference, answer, field, field_id?, qtype?, resume_summary?, is_followup?, prior_answer?, interview_id? }   (2026-09-30 확장, 10-01 횟수 제한)
//   2026-11-03 한림대용 선택: field_id = gov|pubcorp|corp|startup|welfare|major, company_id?, company_seq?, purpose?('major'|'job'), job_role?(40자), major_dept?(40자)
//   — 없으면 예전과 같이 동작. company_id가 있으면 회사 자료를 호출자 토큰으로 get_company_pack에서 읽어 인재상·평가 포인트만 참고 (배점·응답 형식은 그대로)
// 응답:  { score: 0~100, feedback: "한국어 피드백(5~7문장·두 문단, 예시 표현 포함)", strengths: [...], improvements: [...], rewrite: "" (2026-10-22q부터 비움 — 예시는 feedback 안에), model }
//
// 필요한 Secret (Supabase 대시보드 → Edge Functions → Secrets):
//   OPENAI_API_KEY   (필수) OpenAI API 키
//   OPENAI_MODEL     (선택) 기본값 gpt-5.6-luna — 가장 저렴한 GPT-5.6 등급
//
// JWT 검증(verify_jwt)은 켜 둔 상태로 배포합니다. 로그인한 사용자만 호출할 수 있습니다.

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

const SYSTEM_PROMPT = `당신은 대학생 채용 면접(모의면접)의 채점관입니다. 지원자는 한림대학교 재학생·졸업예정자이며 실제 채용 면접을 앞두고 연습하고 있습니다. 지원자의 답변 하나를 아래 기준으로 채점하고, 지원자가 다음 면접에서 바로 고칠 수 있는 피드백을 씁니다.

[채점 기준 — 100점 만점, 정수]
- 내용(40): 모범답안 요지의 핵심 요소가 답변에 얼마나 담겼는가. 단어가 같을 필요는 없고 의미가 통하면 인정. 모범답안이 없으면 질문 유형 기준(아래)과 직무 맥락에 비추어 판단.
- 구체성(20): 숫자, 기간, 과목·프로젝트·활동 이름, 실제 사례, 본인이 맡은 역할, 행동의 순서처럼 "본인만 말할 수 있는" 내용이 있는가. 누구나 할 수 있는 원론·일반론은 낮게.
- 구조(20): 결론(핵심)이 먼저 나오고 이유·사례·마무리가 이어지는가. 두괄식이면 가점.
- 직무 연결·태도(20): 지원 분야·직무의 실제 업무와 이어지는가, 격식 있는 존댓말·긍정적 표현인가, 회피("잘 모르겠다", "그냥")나 자기비하가 없는가.
- 점수 기준점: 90 이상 = 바로 실전에 써도 되는 답 / 75~89 = 방향과 구조가 좋고 한두 요소만 보강 / 60~74 = 방향은 맞지만 구체성·핵심 요소가 부족 / 40~59 = 일반론이거나 질문의 절반만 답함 / 40 미만 = 질문과 무관·회피·매우 짧음.
- 같은 답변은 언제 채점해도 같은 점수가 나오도록, 위 배점을 실제로 더해서 총점을 냅니다.
- [대학생 지원자 기준] 실무 경력이 없다는 이유로 감점하지 않습니다. 수업·팀 프로젝트·캡스톤·동아리·학생회·아르바이트·인턴·봉사·대외활동 경험도 같은 무게로 인정하고, 상황·행동·결과, 숫자, 본인 역할, 직무와의 연결이 분명하면 높게 봅니다. 회사·기관에서 일해 본 것을 전제로 한 지적("실무 경험이 없어서")은 하지 않습니다.

[피드백 작성 규칙]
- 반드시 한국어, 차분한 존댓말(~요/~습니다). feedback은 5~7문장, 두 문단으로 나누고 문단 사이에 빈 줄을 넣습니다(JSON 문자열 안에서는 \\n\\n).
  · 첫 문단: 이 답변에서 가장 중요한 점부터 말합니다. 잘한 점이 두드러지면 그것부터, 빠진 것이 크면 그것부터 — 순서는 답변에 따라 정합니다. 답변 속 표현을 짧게 인용해 근거로 삼습니다.
  · 둘째 문단: 어떻게 고치면 되는지를 "무엇을 어디에 넣으면 되는지" 수준으로 구체적으로 쓰고, 지원자가 말한 재료로 만든 짧은 예시 표현을 문장 안에 자연스럽게 넣습니다(예: 예를 들어 '…'처럼 말하면 …). 필요하면 지원 직무에서 왜 중요한지 한 문장.
  · 금지: "다만"이나 "하지만"으로 문장을 시작하기, "~점은 좋습니다. 다만 ~" 같은 칭찬-다만 틀, 매번 같은 첫 문장 틀, 인사말("감사합니다" 등)만으로 된 예시, 제목·번호·기호(①, ▶, -) 붙이기.
- strengths: 잘한 점 1~3개, 각각 12자 이내 구절. improvements: 보완할 점 1~3개, 각각 "…을 추가" / "…부터 말하기"처럼 행동형 구절 18자 이내.
- 예시 표현은 답변에 없는 사실을 지어내지 말고, 지원자가 말한 재료를 재배치하거나 빈 자리에 "(예: 구체적 수치)"처럼 채울 자리를 표시합니다. 예시는 feedback 안에만 쓰고 rewrite는 빈 문자열("")로 둡니다.
- [짧은 사실 질문] 이름·숫자·개수·날짜를 묻는 짧은 질문(예: "우리 회사 대표이사 성함은?", "올해 최저임금은 얼마인가요?", "우리 기관 본사는 어디에 있나요?")은 짧고 정확하게 답하는 것이 정답입니다. 분량·구조·사례를 요구하며 감점하지 않습니다. 현직자 이름·현재 숫자처럼 최근에 바뀔 수 있는 사실은 채점관이 확인할 수 없으므로 맞다/틀리다를 단정하지 말고, 맞을 가능성이 있으면 내용 점수를 높게 주되 "면접 전 기관·회사 홈페이지에서 한 번 더 확인"을 권합니다.
- [답하지 못한 답변] "몰라·모르겠습니다·없어"나 질문과 무관한 말·장난·마이크 시험 같은 답변에서는 칭찬할 점을 억지로 찾지 않습니다("정직합니다", "억지로 지어내지 않은 점" 같은 말 금지). 대신 이 질문에 들어가야 할 핵심 1~2가지와, 잘 모를 때 "아는 범위 한 가지 + 확인해 익히겠다"로 답하는 방법을 알려 줍니다.
- "하기 싫고 시간이 없을 때도 매일 연습했다"처럼 꾸준함·극복을 말하는 표현은 부정적 태도로 보지 않습니다.
- 음성 인식(STT)으로 받아쓴 답변이라 오탈자·띄어쓰기 오류가 있을 수 있습니다. 감점하지 않고 언급하지도 않습니다.
- 자기소개서 요약이 있으면 답변과 자기소개서의 일관성(수치·경험이 맞는지)을 참고하되, 자기소개서 내용을 답변에 있었던 것처럼 취급하지 않습니다.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.
{"score": 정수, "feedback": "문자열", "strengths": ["..."], "improvements": ["..."], "rewrite": ""}`;

function clampScore(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}


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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "POST 요청만 허용됩니다." }, 405);
  }
  const user = await requireUser(req);
  if (!user) return json({ error: "로그인이 필요합니다. (인증 토큰 없음 또는 만료)" }, 401);
  { const ap = await requireApproved(req, user.id); if (!ap.ok) return json({ error: "not_approved", reason: ap.reason, message: NOT_APPROVED_MSG[ap.reason ?? "pending"] ?? NOT_APPROVED_MSG.pending }, 403); }   // 2026-10-15 승인 대기·기간 종료 계정 거절
  if (!OPENAI_API_KEY) {
    return json(
      { error: "OPENAI_API_KEY Secret이 설정되어 있지 않습니다." },
      500,
    );
  }

  let payload: {
    question?: string;
    reference?: string | null;
    answer?: string;
    field?: string;
    field_id?: string;
    qtype?: string;
    resume_summary?: string | null;
    is_followup?: boolean;
    prior_answer?: string | null;
    interview_id?: string | null;
    company_id?: string | null;    // 2026-11-03 한림대용 (선택)
    company_seq?: number | string | null;
    purpose?: string | null;
    job_role?: string | null;
    major_dept?: string | null;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "요청 본문이 JSON 형식이 아닙니다." }, 400);
  }

  const question = (payload.question ?? "").toString().trim();
  const reference = (payload.reference ?? "").toString().trim();
  const answer = (payload.answer ?? "").toString().trim();
  const field = (payload.field ?? "").toString().trim();
  const fieldId = (payload.field_id ?? "").toString().trim();
  const qtype = (payload.qtype ?? "").toString().trim();
  const resumeSummary = (payload.resume_summary ?? "").toString().trim().slice(0, 1200);
  const isFollowup = !!payload.is_followup;
  const priorAnswer = (payload.prior_answer ?? "").toString().trim().slice(0, 1500);

  if (!question || !answer) {
    return json({ error: "question과 answer는 필수입니다." }, 400);
  }
  const interviewId = (payload.interview_id ?? "").toString().trim();
  const lim = await checkUsageLimit(req, interviewId);
  if (!lim.ok) return json({ error: "limit", limit: lim.status }, 429);

  // 2026-11-03 한림대용 선택 입력값 (없으면 예전과 같음)
  const companyId = cleanText(payload.company_id, 20);
  const seqNum = typeof payload.company_seq === "number" || typeof payload.company_seq === "string" ? Number(payload.company_seq) : NaN;
  const companySeq = Number.isInteger(seqNum) && seqNum > 0 && seqNum < 1000 ? seqNum : undefined;
  const purpose = payload.purpose === "major" || payload.purpose === "job" ? payload.purpose : "";
  const jobRole = cleanText(payload.job_role, 40);
  const majorDept = cleanText(payload.major_dept, 40);
  const fieldName = cleanText(field, 40);

  const ctxKey = purpose === "major" ? "major" : fieldId;
  const baseContext = pick(FIELD_CONTEXT, ctxKey) ?? (fieldName ? `${fieldName} 채용 면접(대학생 지원자). 직무 이해, 경험의 구체성, 협업·문제 해결 역량을 중심으로 봅니다.` : DEFAULT_FIELD_CONTEXT);
  const infoParts = [
    purpose ? `면접 목적: ${purpose === "major" ? "전공·경험 면접" : "직무 면접"}` : "",
    jobRole ? `지원 직무: ${jobRole}` : "",
    majorDept ? `전공(학과): ${majorDept}` : "",
  ].filter(Boolean);
  const context = baseContext + (infoParts.length ? `\n[지원 정보 — 지원자가 화면에서 고른 값] ${infoParts.join(" · ")}` : "");
  const companyBlock = await companyBlockFor(req, companyId, "grade", companySeq);
  const criteria = QTYPE_CRITERIA[isFollowup ? "followup" : qtype] ?? QTYPE_CRITERIA.general;

  const userPrompt = [
    context ? `[지원 분야와 직무 맥락]\n${context}` : null,
    `[면접 질문]${isFollowup ? " (꼬리질문)" : ""}\n${question}`,
    `[질문 유형 기준]\n${criteria}`,
    reference ? `[모범 답안 요지]\n${reference}` : `[모범 답안 요지]\n(없음 — 질문 유형 기준과 직무 맥락으로 평가)`,
    isFollowup && priorAnswer ? `[이 꼬리질문 직전의 지원자 답변 (일관성 확인용)]\n${priorAnswer}` : null,
    resumeSummary ? `[지원자 자기소개서 요약 (참고용)]\n${resumeSummary}` : null,
    `[지원자 답변]\n${answer.slice(0, 3000)}`,
  ].filter(Boolean).join("\n\n");

  try {
    // 2026-10-19e: 추론형 모델(GPT-5 계열)은 생각에 토큰을 먼저 써서 700이면 답이 비는 경우가 있었음 → 2000으로 올리고, 그래도 비면 3500으로 한 번 더
    const msgs = [
          { role: "system", content: SYSTEM_PROMPT + (companyBlock ? `\n\n[기업 맞춤 면접 참고 — 인재상·평가 포인트만 참고하고, 위 배점과 JSON 형식은 그대로 지킵니다]\n${companyBlock}` : "") },
          { role: "user", content: userPrompt },
        ];
    let { res, modelUsed } = await callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, msgs, 0.3, 2000);

    if (!res.ok) {
      const errText = await res.text();
      console.error("OpenAI API 오류:", res.status, errText);
      return json(
        { error: `OpenAI API 오류 (${res.status}): ${errText.slice(0, 300)}` },
        502,
      );
    }

    let data = await res.json();
    let content: string = data?.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      console.warn("빈 응답 → 토큰을 늘려 다시 시도", data?.choices?.[0]?.finish_reason);
      const retry = await callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, msgs, 0.3, 3500);
      if (retry.res.ok) { data = await retry.res.json(); content = data?.choices?.[0]?.message?.content ?? ""; modelUsed = retry.modelUsed; }
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("OpenAI 응답 JSON 파싱 실패:", content);
      return json({ error: "AI 응답을 해석하지 못했습니다.", raw: content }, 502);
    }

    return json({
      score: clampScore(parsed.score),
      feedback: (parsed.feedback ?? "").toString(),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
      rewrite: "",   // 2026-10-22q: '이렇게 말해 보세요' 칸 없앰 — 예시는 feedback 안에 녹여 씀
      limit: lim.status ?? null,
      model: modelUsed,
      usage: data?.usage ?? null,
    });
  } catch (e) {
    console.error("grade-answer 처리 중 예외:", e);
    return json({ error: `서버 오류: ${(e as Error).message}` }, 500);
  }
});
