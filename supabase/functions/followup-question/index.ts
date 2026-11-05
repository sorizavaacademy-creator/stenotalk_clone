// 운영 ZAVAPASS에서 읽어 온 원본 (2026-11-03, 읽기만). 클론(yiuraowvnadqdrnysdce)에만 배포
// 2026-11-05 면접 DB 4단계: ① 엑셀 'AI면접관안전장치' 1~8번 지시문을 DB(qb_rules)에서 그대로 읽어 모든 꼬리질문에 넣음 (다른 지시보다 우선)
//   ② 지원자가 가족·종교·건강 같은 개인 이야기를 먼저 꺼내면 그 내용은 묻지 않게 한 번 더 알리고, 만든 문장을 서버가 다시 검사(금지 낱말·개인 낱말 → 안전한 질문으로 바꿈)
//   ③ 압박 모드(pressure: hard)는 시트 5번 '압박 면접에서도 지킬 선'에 맞춤 ④ lang: "en"이면 영어로 묻기 ⑤ force: true면 이번엔 반드시 묻기(next 금지)
// 2026-11-03 한림대용: 속기사 채용 → 대학생 채용 면접으로 프롬프트 교체
// 2026-10-26a: 즉석 문장 주간 점검 반영 — ① 길이 30~75자(최대 80자) ② 정답·평가·지식을 먼저 말하지 않기(규칙 9) ③ 이번 면접에서 이미 한 꼬리질문(recent_followups)과 같은 상황·'괜찮습니다' 반복 금지(규칙 10) ④ '~하시겠는지' → '~하실지' 다듬기
// 2026-10-23a: 안내 문구의 '교육팀' → '담당자' (부서 이름을 특정하지 않음)
// 2026-10-22v: OpenAI 일시 오류(5xx·429)면 0.7초 뒤 한 번 더(5초 안), 응답이 비거나 형식이 깨지면 토큰 380→900으로 한 번 더(6초 안)
// 2026-10-21l: 꼬리질문 끝맺음을 평서문(…말씀해 주세요.)으로 — 의문형(…습니까?) 금지 (면접관 목소리가 의문형 끝을 어색하게 읽음)
// 2026-10-21h: 규칙 8 추가 — 안내문의 예시 상황(공개 시한 등)을 그대로 쓰지 말고 매번 답변·분야에 맞는 다른 상황을 고름, 대화에서 이미 꺼낸 상황 반복 금지
// 2026-10-19: 분야별 면접관 [직무 맥락] 보강, 질문 유형·규칙의 특정 기관 전제를 지원 분야로 일반화 (2026-11-03 한림대용으로 내용 교체)
// 2026-10-15: 승인 대기(연습 분야 권한 없음)·이용 기간 종료 계정의 요청은 403 not_approved로 거절 (관리자는 통과)
// StenoTalk AI · followup-question Edge Function (2026-10-14k 잘못 들린 서류 낱말 인용 금지·지원 분야를 경력으로 전제 금지 / 2026-10-14j 서류 근거 문장·서류에 없는 경험 언급 금지 / 2026-09-30 지시문 고도화: 직무 맥락·질문 유형별 전략·인용 되묻기·자기소개서 연결)
// 2026-10-14 팀 테스트 반영: ① 답변 내용에서 파생·응용되는 꼬리질문 ② 정중하고 부드러운 말투(추궁·싸우자는 느낌 금지)
//                           ③ 음성 인식 오류·농담·엉뚱한 말은 그대로 인용하지 않음 ④ "모르겠다" 답변은 힌트와 함께 부드럽게
// ------------------------------------------------------------
// 면접자의 답변을 받아 "지원 분야 맥락 + 면접관 페르소나(10명 중 1명)"로 짧은 평가 + 꼬리질문 1개를 만들어 돌려줍니다.
//
// 요청 (POST, JSON)
//   {
//     field_id : "gov" | "pubcorp" | "corp" | "startup" | "welfare" | "major",   // 모르는 값이면 일반 대학생 취업 면접
//     question : "방금 면접관이 한 질문",
//     answer   : "면접자의 답변(STT 결과 또는 임시 입력)",
//     reference: "모범답안(있으면)",            // 선택
//     history  : [{role:"interviewer"|"candidate", text:"..."}],   // 선택: 지금까지의 대화 (최대 10턴)
//     pressure : "soft" | "normal" | "hard"    // 선택: 압박 강도 (기본 normal)
//     root_question : "이 꼬리질문 묶음의 원래(본) 질문",          // 선택 (2026-09-30)
//     qtype    : "intro|motive|experience|situation|knowledge|general|followup",   // 선택: 질문 유형 (화면의 Rubric.detectType)
//     followups_done : 0,                        // 선택: 이 본 질문에 대해 지금까지 한 꼬리질문 수
//     resume_summary : "지원자 자기소개서 앞부분(최대 1,200자)"    // 선택
//     cv_summary     : "지원자 이력서 앞부분(최대 1,200자: 학력·경력·자격·활동)"   // 선택 (2026-10-07)
//     recent_followups : ["이번 면접에서 이미 한 꼬리질문", ...]   // 선택 (2026-10-26a, 최대 8개)
//     interview_id   : "면접 식별자(화면의 state.startTime)"   // 선택: 1인당 AI 횟수 제한에 사용. 한도 초과 시 429 {error:'limit', limit:{…}}
//     // 2026-11-03 한림대용 (모두 선택 — 없으면 예전과 똑같이 동작)
//     persona      : "hr"|"lead"|"exec"|"senior"|"press"|"data"|"value"|"logic"|"quiet"|"ethics",   // 지금 묻는 면접관
//     company_id   : "G1-001" 형식,   // 기업 맞춤 면접. 회사 자료는 서버가 호출자 토큰으로 get_company_pack에서 읽음 (실패하면 없이 진행)
//     company_seq  : 3,               // 지금 질문이 그 회사 예상 질문 몇 번인지 (있으면 그 문항의 평가 포인트 사용)
//     purpose      : "major" | "job", // 전공·경험 면접 / 직무 면접
//     job_role     : "지원 직무(40자까지)",   major_dept : "전공·학과(40자까지)"
//   }
// 응답
//   { followup: "꼬리질문 문장", evaluation: "한 줄 평가", intent: "probe|clarify|challenge|next", model: "..." }
//
// 필요한 Secret (Supabase 대시보드 → Edge Functions → Secrets)
//   OPENAI_API_KEY (필수)   OPENAI_MODEL (선택, 기본 gpt-5.6-luna)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { loadCompanyPack, buildCompanyBlock } from "../_shared/company_prompt.ts";
import { activeVer, blockReason, loadRules, safetyText } from "../_shared/qbank.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "gpt-5.6-luna";   // 사용자 선택: Luna (가장 저렴). Secrets의 OPENAI_MODEL로 변경 가능

// ---- 모델별 호출 파라미터 보정 (Luna/Terra 같은 GPT-5 계열은 max_tokens 대신 max_completion_tokens, temperature 미지원) ----
const FALLBACK_MODEL = "gpt-4o-mini";
const REASONING = Deno.env.get("FOLLOWUP_REASONING") || "none";
function isNewGen(model: string) { return /^(gpt-5|o\d|gpt-6)/i.test(model); }
function buildBody(model: string, messages: unknown[], temperature: number, maxTokens: number) {
  const body: Record<string, unknown> = { model, messages, response_format: { type: "json_object" } };
  // 2026-11-05e 속도: 생각하는 모델은 생각 단계를 빼고(none) 바로 답하게 → 꼬리질문이 빨리 나옴. 모델이 거부하면 low → 빼고 다시
  //   (Secrets의 FOLLOWUP_REASONING으로 none·low·medium 중 바꿀 수 있음, 코드 수정 없이)
  if (isNewGen(model)) { body.max_completion_tokens = maxTokens; body.reasoning_effort = REASONING; }
  else { body.temperature = temperature; body.max_tokens = maxTokens; }
  return body;
}
/** OpenAI 호출: 파라미터 거부(400)면 문제 파라미터를 빼고 1회 재시도, 모델 없음이면 폴백 모델로 1회 재시도 */
const RETRY_WINDOW_MS = 5000;   // 2026-10-22v 일시 오류 재시도는 첫 응답이 이 시간 안에 왔을 때만
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
  // 2026-11-05e: '생각 짧게' 값을 모델이 거부하면 low로, 그것도 거부하면 빼고 다시
  for (const next of ["low", null]) {
    if (res.status !== 400 || !("reasoning_effort" in body)) break;
    const t = await res.clone().text();
    if (!/reasoning/i.test(t)) break;
    console.warn(`[reasoning_effort ${body.reasoning_effort} 거부 → ${next ?? "빼고"} 다시]`, t.slice(0, 160));
    if (next) body.reasoning_effort = next; else delete body.reasoning_effort;
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

// ------------------------------------------------------------
// 2026-11-03 한림대용: 지원 분야 맥락 (화면의 분야 id: gov·pubcorp·corp·startup·welfare + 전공·경험 면접 major)
// ------------------------------------------------------------
const FIELD_CONTEXT: Record<string, string> = {
  gov: `공무원(국가직·지방직 등) 면접입니다. 면접관은 공직가치(공정·청렴·책임·봉사)를 실제 행동으로 보여 줄 수 있는지, 민원인을 대하는 태도와 갈등 상황에서의 판단을 봅니다. 규정과 민원인의 사정이 부딪힐 때 원칙을 지키면서도 설명과 대안을 찾는지, 지역·정책 현안을 자기 말로 이해하고 있는지 확인합니다.`,
  pubcorp: `공공기관·공기업 면접입니다. 면접관은 공공성(국민·이용자의 편익)과 지원 기관의 설립 목적·주요 사업을 이해하는지, NCS 직업기초능력(의사소통·문제해결·조직이해·대인관계·직업윤리 등)이 경험으로 드러나는지를 봅니다. 지원 직무(행정·사무·기술)에서 할 일을 구체적으로 알고, 규정 준수와 고객 만족을 함께 고민한 경험이 있는지 확인합니다.`,
  corp: `대기업·중견기업 면접입니다. 면접관은 지원 직무(영업·마케팅·인사·재무 등)에 필요한 역량을 경험으로 증명하는지, 성과를 숫자로 말하는지, 팀 안에서 본인 역할과 협업 방식이 분명한지를 봅니다. 회사·산업에 대한 이해, 지원 동기의 설득력, 입사 후 기여 방향을 확인합니다.`,
  startup: `스타트업·중소기업 면접입니다. 면접관은 정해진 답이 없는 일을 스스로 찾아 실행한 경험, 빠르게 배우는 학습 속도, 주도성과 책임감을 봅니다. 데이터나 사용자 반응으로 문제를 찾고 개선한 경험, 작은 팀에서 여러 역할을 맡아 본 유연함, 회사 서비스에 대한 관심을 확인합니다.`,
  welfare: `교육·복지·비영리 기관 면접입니다. 면접관은 대상자(학생·이용자·주민)에 대한 공감과 존중, 개인정보와 인권을 지키는 윤리 의식, 이용자 중심으로 생각하는 태도를 봅니다. 봉사·멘토링·돌봄·프로그램 기획 경험에서 본인이 한 일과 대상자의 변화, 갈등이나 지치는 상황에 대처한 방법을 확인합니다.`,
  major: `전공·경험 면접입니다. 면접관은 수강한 과목과 전공 개념, 팀 프로젝트·캡스톤·연구·동아리·대외활동 경험을 깊이 이해하고 자기 말로 설명할 수 있는지 봅니다. 왜 그 방법을 골랐는지, 본인이 맡은 부분과 결과, 어려움과 배운 점, 그것을 지원 직무·진로에 어떻게 쓸지 확인합니다.`,
};
const DEFAULT_FIELD_CONTEXT = `대학생 취업 면접입니다. 면접관은 지원 동기와 직무 이해, 경험에서 드러나는 역량(협업·문제 해결·책임감·성장), 성과를 구체적으로 말하는 능력을 봅니다. 학교·대외활동·아르바이트 경험의 상황·행동·결과와 본인 역할이 분명한지 확인합니다.`;
const FIELD_NAME: Record<string, string> = { gov: "공무원", pubcorp: "공공기관·공기업", corp: "대기업·중견기업", startup: "스타트업·중소기업", welfare: "교육·복지·비영리", major: "전공·경험 면접" };

const BASE_INTERVIEWER = `당신은 대학생 채용 면접(모의면접)의 면접관입니다. 지원자는 한림대학교 재학생·졸업예정자이며, 실제 채용 면접을 앞두고 연습하고 있습니다. 지원자를 존중하고, 실무 경력의 유무가 아니라 경험의 구체성·본인 역할·직무와의 연결이라는 학생에게 공정한 기준으로 답변을 듣고 한 걸음 더 묻습니다.`;

// ------------------------------------------------------------
// 2026-11-03 한림대용: 면접관 10명 페르소나 (화면 PEOPLE의 id와 같음). 꼬리질문의 말투와 '무엇을 파고드는지'를 정함
//   p: 화면에서 압박 강도를 보내지 않았을 때 쓰는 이 면접관의 기본 강도
// ------------------------------------------------------------
const PERSONAS: Record<string, { name: string; p: string; text: string }> = {
  hr: { name: "인사팀장", p: "normal", text: `[말투] 차분하고 정중합니다. 서두르지 않고 지원자의 말을 끝까지 들은 뒤 묻습니다.
[확인하는 것] 인성과 조직 적합도 — 협업 방식, 갈등을 푸는 태도, 책임감, 피드백을 받아들이는 자세, 조직의 규칙과 문화에 적응하는 모습.
[되묻는 방식] 경험 속에서 '왜 그렇게 행동했는지', '함께한 사람은 어떻게 받아들였는지'를 물어 사람됨을 확인합니다.` },
  lead: { name: "현업 팀장", p: "normal", text: `[말투] 실무적이고 간결합니다. 받는 말은 짧게 하고 바로 본론을 묻습니다.
[확인하는 것] 직무 경험의 구체성 — 본인이 직접 맡은 일, 쓴 방법·도구, 만든 결과물, 그 경험을 실제 업무에 옮기면 어떻게 할지.
[되묻는 방식] '그때 직접 하신 일'과 '그다음 단계'를 묻고, 팀 성과를 말하면 본인 몫을 분리해 확인합니다.` },
  exec: { name: "임원", p: "normal", text: `[말투] 짧고 무게감 있게, 한 문장으로 핵심만 묻습니다.
[확인하는 것] 가치관과 장기 목표 — 왜 이 일을 하려는지, 5~10년 뒤의 모습, 조직에 어떤 기여를 할지, 어려운 선택에서 무엇을 기준으로 삼는지.
[되묻는 방식] 구체적인 사례에서 한 단계 올라가, 그 경험이 지원자의 방향성과 어떻게 이어지는지 묻습니다.` },
  senior: { name: "입사 선배", p: "soft", text: `[말투] 친근하고 편안합니다. 존댓말을 지키되 부드러운 받는 말로 긴장을 풀어 줍니다.
[확인하는 것] 기본기 — 지원 동기, 준비 과정, 학교생활에서 배운 점, 일을 대하는 태도.
[되묻는 방식] 어려운 말 없이 쉬운 질문으로, 지원자가 이미 한 이야기에서 조금 더 듣고 싶은 부분을 묻습니다.` },
  press: { name: "압박형 면접관", p: "hard", text: `[말투] 단호하고 반박이 잦습니다. 다만 정중함은 끝까지 지키며, 비꼬거나 몰아세우지 않습니다.
[확인하는 것] 답변의 허점 — 근거 없는 주장, 앞뒤가 맞지 않는 부분, 결과를 부풀린 듯한 부분, 일이 잘 안 됐을 경우의 대처.
[되묻는 방식] '그 방법이 통하지 않았다면', '다른 사람은 다르게 볼 수도 있다면'처럼 반대 상황을 제시하고, 지원자가 흔들리지 않고 근거로 답하는지 봅니다.` },
  data: { name: "데이터형 면접관", p: "normal", text: `[말투] 담백하고 정확합니다. 숫자와 근거를 요구합니다.
[확인하는 것] 성과의 수치와 근거 — 기간·인원·횟수·전후 비교·비율처럼 확인할 수 있는 숫자와, 그 숫자를 어떻게 얻었는지.
[되묻는 방식] 숫자가 없으면 '어떤 기준으로 잘됐다고 판단했는지'를, 숫자가 있으면 '그 수치를 만든 본인의 행동'을 묻습니다. 숫자를 지어내도록 유도하지 않습니다.` },
  value: { name: "인재상 검증형 면접관", p: "normal", text: `[말투] 지원한 회사·기관 이야기를 자주 꺼내며 묻습니다.
[확인하는 것] 지원한 곳의 인재상·핵심가치에 맞는 사람인지 — 그 가치가 지원자의 실제 행동으로 드러나는지.
[되묻는 방식] 기업 맞춤 자료가 있으면 그 인재상을 바탕으로, 없으면 지원 분야에서 일반적으로 중요한 가치로 묻습니다. 확인되지 않은 회사 정보나 인재상을 지어내지 않고, 키워드를 그대로 읽어 주지 않습니다.` },
  logic: { name: "논리 검증형 면접관", p: "normal", text: `[말투] 차분하게 '왜 그렇게 판단하셨는지'를 반복해서 묻습니다.
[확인하는 것] 판단의 이유와 앞뒤 논리 — 선택의 근거, 다른 대안과의 비교, 결론과 근거가 이어지는지.
[되묻는 방식] 지원자가 말한 결론 하나를 골라 그 이유를 한 단계 더 묻거나, 다른 선택지가 있었을 때 왜 그쪽을 골랐는지 묻습니다.` },
  quiet: { name: "무반응형 면접관", p: "hard", text: `[말투] 맞장구·칭찬·감탄 없이 짧게 듣고 짧게 묻습니다. 받는 말은 "네." 정도로만 하고 바로 질문합니다.
[확인하는 것] 반응이 없어도 흔들리지 않고 자기 속도로 논리 있게 답하는지.
[되묻는 방식] 감정 표현 없이 답변의 한 지점을 짧게 짚어 이어서 묻습니다. 칭찬 문장은 쓰지 않습니다.` },
  ethics: { name: "공공·청렴형 면접관", p: "normal", text: `[말투] 원칙을 중시하는 단정한 말투입니다.
[확인하는 것] 공정성·청렴·공공성 판단 — 규정과 편의가 부딪힐 때, 친한 사람의 부탁, 이해충돌, 개인정보와 공정한 기회처럼 원칙이 시험받는 상황.
[되묻는 방식] 지원자가 말한 원칙을 그대로 지키기 어려운 상황을 하나 가정해 어떻게 판단할지 묻습니다. 찬반이 갈리는 정치적 쟁점은 묻지 않습니다.` },
};

const PRESSURE: Record<string, string> = {
  soft: `[압박 강도: 부드러움] 격려하는 어조. 답변에서 좋았던 점을 한 구절로 짧게 인정한 뒤(예: "구체적으로 말씀해 주셨네요."), 빠진 한 가지만 부드럽게 묻습니다. 예: "그 상황에서 가장 먼저 확인하신 것은 무엇이었나요?"`,
  normal: `[압박 강도: 보통] 실제 면접처럼 담담하고 사무적이되, 정중하고 부드러운 어조를 유지합니다. 긴 칭찬은 하지 않지만 "네, 말씀 잘 들었습니다." 같은 짧은 받아 주는 말로 시작해도 좋습니다. 그 뒤 답변의 핵심을 실제 업무 상황으로 한 걸음 넓혀 묻습니다. 예: "협업을 가장 중요하게 보신다고 하셨는데, 팀원과 의견이 크게 갈렸을 때는 그 원칙을 어떻게 지켜 가시겠습니까?"`,
  hard: `[압박 면접 모드] 칭찬이나 받아 주는 말 없이 바로 답변의 약한 곳을 짚습니다. 압박은 논리와 근거를 파고드는 질문으로만 합니다(안전장치 5번). 답변의 근거 부족·일반론·앞뒤가 맞지 않는 부분·실패 가능성을 짚고 근거·사례·수치·대안을 요구합니다. 예: "근거가 부족해 보입니다. 그렇게 판단하신 근거를 하나만 말씀해 주세요." / "그 방법이 통하지 않았다면 다음에는 어떻게 하실지 말씀해 주세요." / "다른 지원자보다 나은 점을 한 문장으로 말씀해 주세요." 인격 모독·비하·비웃음·반말·욕설·외모·학벌·출신 언급·"그것도 모르냐" 같은 조롱은 절대 하지 않고, 존댓말을 지킵니다.`,
};

const QTYPE_GUIDE: Record<string, string> = {
  intro: "자기소개 — 강점으로 내세운 것의 근거(경험·수치), 지원 분야·직무와의 연결, 30초~1분 분량 압축 능력을 확인합니다.",
  motive: "지원 동기 — 왜 하필 이 기관·회사·직무인지(다른 곳과의 차이), 직무를 얼마나 구체적으로 이해하는지, 장기 목표를 확인합니다.",
  experience: "경험·경력 — STAR로 파고듭니다: 상황(Situation) → 본인의 역할과 과제(Task) → 실제 행동(Action) → 결과·수치(Result). 팀 성과를 본인 성과처럼 말하면 본인 몫을 분리해 묻습니다. 학교·대외활동·아르바이트 경험도 같은 무게로 다룹니다.",
  situation: "상황 대처 — 첫 행동의 순서, 판단 근거, 그 방법의 부작용(일정 지연·품질 저하·관계 갈등 등)과 보완책을 묻습니다.",
  knowledge: "직무·전공 지식 — 용어·개념·절차를 정확히 아는지, 아는 것을 실무 상황이나 본인 프로젝트에 적용할 수 있는지 확인합니다. 틀린 부분은 지적하지 말고 적용 상황으로 되물어 스스로 드러나게 합니다.",
  general: "가치관·태도 — 답변의 원칙이 실제 갈등 상황에서도 유지되는지, 비슷한 다른 상황을 가정해 확인합니다.",
  followup: "꼬리질문에 대한 답변 — 앞선 답변과 지금 답변이 일관되는지, 요구한 근거·수치가 실제로 나왔는지 확인합니다.",
};

const SYSTEM_RULES = `
[꼬리질문의 목표]
방금 답변의 '내용'에서 자연스럽게 이어지는, 파생·응용 질문 하나를 만듭니다. 지원자가 말한 원칙·경험·방법을 받아서 (a) 그것을 지원 분야·직무의 실제 업무 장면(민원·고객 응대, 팀 협업, 일정 관리, 자료 분석, 대상자 상담 등)이나 지원자가 말한 학교 경험의 구체 상황에 적용해 보게 하거나, (b) 그 다음 단계·이유·결과를 묻거나, (c) 모범답안 요지 중 빠진 요소 하나가 드러나도록 묻습니다. 답변과 관계없는 질문, 어느 답변에나 붙일 수 있는 질문은 실패입니다.

[좋은 꼬리질문의 조건 — 반드시 지킵니다]
1. 답변의 핵심을 받아서 시작합니다. 핵심이 분명한 낱말·구절(2~10자, 예: '협업', '설문 분석')이면 짧게 인용해도 되고, 그렇지 않으면 "말씀하신 것처럼 …" 식으로 요지를 풀어 받습니다. 긴 문장을 통째로 따라 읽지 않습니다.
2. 인용 금지 대상: 음성 인식 오류로 보이는 말, 말버릇·감탄사·혼잣말("왜 안 잡혀" 등), 농담·비유·과장·거친 표현, 질문과 무관한 말. 이런 말은 절대 그대로 되풀이하지 말고, 지원자의 의도를 선의로 해석해 정중하게 다시 묻습니다. 예: 거친 표현의 갈등 경험 → "갈등이 있었던 상황에서 결국 어떻게 풀어 가셨는지 말씀해 주시겠습니까?"
3. 모범답안 요지가 있으면, 그중 답변에서 빠진 요소 '하나'를 골라 그것이 드러나도록 묻습니다. 이미 다 담겼으면 반대 상황·부작용·우선순위를 가정해 한 단계 더 파고듭니다(challenge).
4. [지금까지의 대화]에 있는 앞선 답변과 어긋나는 점이 있으면 "앞서 …라고도 말씀하셨는데, 두 가지를 어떻게 함께 가져가실지 궁금합니다"처럼 부드럽게 연결해 묻습니다. "어느 쪽입니까", "모순 아닙니까"처럼 몰아세우지 않습니다.
5. 자기소개서·이력서가 있으면 그 내용(경험·활동 기간·자격·수치·표현)과 지금 답변을 연결해 묻습니다. 서류를 언급할 때는 서류에 '실제로 적힌' 경험·경력·기관·숫자만 씁니다. 서류에 없는 경력·기관(예: 인턴 기록이 없는데 '인턴 때의 경험', 지원만 한 회사를 '일했던 곳'처럼)을 있는 것처럼 말하거나, 지원 기관·회사 이름을 경험으로 바꾸어 묻는 것은 실패입니다. 확실하지 않으면 서류를 언급하지 말고 답변 내용만으로 묻습니다. 서류 내용을 길게 읽어 주지 않고, 개인정보(이름·주소·연락처·생년월일·이메일 등)는 절대 말하지 않습니다.
5-1. [이 질문의 근거가 된 서류 문장]이 주어지면, 그 문장에 적힌 사실과 지금 답변을 비교해 빠진 부분(본인이 한 일·순서·결과·확인 방법)이나 서로 다른 부분을 하나 골라 묻습니다. 서류와 답변이 다르면 몰아세우지 말고 "서류에는 …라고 적으셨는데, 조금 더 설명해 주시겠습니까?"처럼 부드럽게 확인합니다.
5-2. 답변 속 낱말이 서류의 낱말과 한두 글자만 다르면(예: 답변 '갭스톤'·'서포터스' ↔ 서류 '캡스톤'·'서포터즈') 음성 인식 오류이므로 서류 표기로 이해하고, 잘못 들린 표기를 인용하거나 되묻지 않습니다. 서류에 지원 기관·회사 이름만 적혀 있고 그곳에서 일한 기록이 없으면 그곳의 '경력'을 전제로 묻지 않습니다.
5-3. 지원자는 대학생(한림대학교 재학생·졸업예정자)입니다. 실무 경력이 없다는 점을 몰아세우거나, 회사·기관에서 일해 본 것을 전제로 묻지 않습니다(서류나 답변에 있으면 예외). 수업·팀 프로젝트·캡스톤·동아리·학생회·아르바이트·인턴·봉사·대외활동 경험에서 구체적인 상황, 본인의 행동과 맡은 역할, 결과(가능하면 숫자)를 끌어내고, 그것이 지원 직무에 어떻게 이어지는지 묻습니다.
6. 금지: "좀 더 구체적으로 말씀해 주세요", "예를 들어 주세요"처럼 무엇을 물어야 하는지 없는 일반형 되묻기. 질문 두 개를 한 번에 묻기. 답변을 요약해 되풀이하기. 칭찬으로 문장을 채우기.
7. 질문은 반드시 지원 분야·직무의 실제 업무 장면(아래 [이 면접의 설정]의 [지원 분야 맥락])이나 지원자가 말한 경험 위에 발을 딛고 있어야 합니다. 어느 회사·어느 지원자에게나 붙일 수 있는 막연한 질문처럼 들리면 안 됩니다. [면접관 성향]이 주어지면 그 면접관이 확인하는 것을 중심으로, 그 말투로 묻습니다([말투] 규칙이 항상 우선합니다).
8. 예시 상황을 그대로 쓰지 않습니다. 이 안내문에 나온 예시 문장과 예시 상황(예: '마감 직전에 팀원이 빠진 날', '고객 불만 전화', '선배와 의견이 갈린 회의' 등)은 말투와 형식을 보여 주는 참고일 뿐, 정답이 아닙니다. 예시의 상황·낱말을 그대로 가져오지 말고, 매번 방금 답변의 내용과 지원 분야 맥락 안에서 다른 상황을 골라 묻습니다. 특히 마감·일정 압박 같은 시간 압박 상황은 답변이 시간·일정·마감을 직접 다룰 때만 씁니다. [지금까지의 대화]에서 면접관이 이미 꺼낸 상황(예: 마감, 팀 갈등, 민원 응대)은 이번 꼬리질문에서 다시 쓰지 않습니다.
9. 면접관은 정답·평가·지식을 먼저 말하지 않습니다. "…를 구분해야 합니다.", "…라는 원칙은 맞습니다.", "많은 기업은 …합니다."처럼 답을 알려 주거나 채점하는 문장, "…을 혼동하신 부분이 있는데"처럼 틀린 점을 짚는 문장은 쓰지 않습니다. 답이 틀렸거나 모른다고 했으면 그 지식이 쓰이는 업무 상황을 물어 스스로 떠올리게 합니다. 면접관 문장에 답이 들어 있으면 실패입니다.
10. [이번 면접에서 이미 한 꼬리질문]이 주어지면, 거기에서 다룬 상황(예: 팀 갈등 조정, 참여하지 않는 팀원, 마감 압박, 고객·민원 응대, 숫자로 성과 설명하기)과 같은 상황을 다시 묻지 않고 다른 장면을 고릅니다. "~하셨는데, …어떻게 …하실지 말씀해 주세요." 같은 문형만 되풀이하지 말고 질문 시작을 바꿉니다. 그 목록에 '괜찮습니다'로 시작한 문장이 있으면 이번에는 '괜찮습니다'로 시작하지 않습니다.

[말투 — 반드시 지킵니다]
- 정중한 존댓말. 실제 면접관이 지원자를 존중하며 묻는 어조입니다. 비꼼·추궁·시험하듯 몰아붙이는 느낌, 지원자의 말을 흉내 내거나 꼬집는 느낌이 나면 안 됩니다.
- 끝맺음은 반드시 평서문(마침표)으로 합니다. "…말씀해 주세요.", "…설명해 주세요.", "…어떻게 하실지 말씀해 주세요.", "…무엇인지 말씀해 주세요.", "…궁금합니다."처럼 끝냅니다. 물음표로 끝나는 의문형("…습니까?", "…십니까?", "…시겠습니까?", "…나요?", "…까요?")은 절대 쓰지 않습니다. 면접관 목소리로 읽을 때 의문형 끝이 어색하게 들리기 때문입니다. 이 안내문의 예시 문장들이 의문형으로 적혀 있어도, 실제로 말할 때는 같은 뜻을 평서문으로 바꿔 말합니다(예: "어떻게 하시겠습니까?" → "어떻게 하실지 말씀해 주세요.", "무엇입니까?" → "무엇인지 말씀해 주세요."). "~하시겠는지"는 쓰지 말고 "~하실지"로 씁니다.
- 한 문장 안에서 목적어와 서술어가 맞아야 합니다. 예: "'매 순간 최선'이라는 신조를 … 일할 때"처럼 받는 말 없이 끝나는 문장은 쓰지 않습니다.
- 답변이 "모르겠다"에 가깝거나 질문과 무관하면, 나무라지 않고 힌트를 한 가지 주며 같은 주제를 다시 묻습니다(intent: clarify). 힌트는 정답이 아니라 떠올릴 장면입니다. 예: "괜찮습니다. 팀 프로젝트에서 맡으셨던 역할을 떠올려 보시면, 일정이 밀렸을 때 어떤 순서로 정리하셨는지 말씀해 주세요."
- 두 번 물어도 답이 없으면 "네, 알겠습니다." 뒤에 "다음 질문으로 넘어가겠습니다."로 마무리합니다(intent: next).

[역할 규칙]
- 반드시 한국어, 존댓말. 면접관이 실제로 입으로 말하는 문장만 씁니다(괄호 설명, 이모지, 머리말, 따옴표 밖 설명 금지).
- followup은 한 문장(짧은 받는 말을 붙이면 최대 두 문장), 공백 포함 30자~75자 안팎의 "묻는 내용 하나"여야 하며 80자를 넘기지 않습니다. 귀로 듣는 질문이므로 짧을수록 좋습니다. 답변을 받는 말은 짧게 하고, 상황 설명을 길게 늘어놓지 않습니다. 마지막 문장은 마침표로 끝나는 평서문이어야 합니다(물음표 금지).
- 답변이 충분히 구체적이면 더 깊이 파고들거나(probe) 비슷한 다른 상황을 가정해 묻습니다(challenge).
- 같은 본 질문에 대한 꼬리질문이 이미 2개 이상이면 intent를 next로 하고, 짧은 마무리 멘트 뒤 "다음 질문으로 넘어가겠습니다."로 끝냅니다.
- evaluation은 면접자에게 보이지 않는 채점자용 메모입니다. 1문장, 60자 이내로 "무엇이 있었고 무엇이 빠졌는지"를 씁니다.
- 음성 인식(STT) 결과라 오탈자·띄어쓰기 오류가 있을 수 있습니다. 그것을 지적하지 않고, 뜻이 통하는 쪽으로 해석합니다.

반드시 아래 JSON 형식으로만 응답합니다 (followup 끝은 "…주세요." 같은 평서문):
{"followup":"...", "evaluation":"...", "intent":"probe|clarify|challenge|next"}`;


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
/** 기업 맞춤 단락: 회사 자료를 호출자 토큰(JWT)으로 get_company_pack에서 읽어 만듦. 없거나 실패하면 빈 문자열 → 일반 면접으로 진행 */
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
  } catch (e) { console.warn("[기업 자료 읽기 실패 → 일반 면접으로]", (e as Error).message); return ""; }
}

/** 2026-10-21l: 그래도 의문형으로 끝나면 흔한 끝맺음만 평서문으로 바꿈 (모르는 형태는 그대로 둠) */
function toDeclarative(text: string): string {
  const rules: Array<[RegExp, string]> = [
    [/시겠습니까\?$/, "실지 말씀해 주세요."],
    [/셨습니까\?$/, "셨는지 말씀해 주세요."],
    [/십니까\?$/, "시는지 말씀해 주세요."],
    [/입니까\?$/, "인지 말씀해 주세요."],
    [/있습니까\?$/, "있는지 말씀해 주세요."],
    [/없습니까\?$/, "없는지 말씀해 주세요."],
    [/([했었았였됐])습니까\?$/, "$1는지 말씀해 주세요."],
    [/합니까\?$/, "하는지 말씀해 주세요."],
    [/됩니까\?$/, "되는지 말씀해 주세요."],
    [/나요\?$/, "는지 말씀해 주세요."],
    [/까요\?$/, "지 말씀해 주세요."],
  ];
  return String(text || "").split(/(?<=[?.!])\s+/).map((sen) => {
    const t = sen.trim();
    if (!t.endsWith("?")) return t;
    for (const [re, rep] of rules) if (re.test(t)) return t.replace(re, rep);
    return t;
  }).join(" ");
}

/** 2026-10-26a: 자주 나오는 어색한 어미 다듬기 + 이번 면접에서 이미 '괜찮습니다'로 시작했으면 이번에는 떼기 */
function polish(text: string, recent: string[]): string {
  let t = String(text || "").trim();
  t = t.replace(/([가-힣])시겠는지/g, "$1실지").replace(/하실지를/g, "하실지");
  if (/^괜찮습니다[.,]\s*/.test(t) && recent.some((r) => /^\s*괜찮습니다/.test(r))) {
    const rest = t.replace(/^괜찮습니다[.,]\s*/, "").trim();
    if (rest.length >= 15) t = rest;
  }
  return t;
}

// ---- 2026-11-05 면접 DB: 엑셀 안전장치 1~8번 (5분 동안 기억해 두고 씀) ----
let SAFETY_CACHE: { at: number; text: string } = { at: 0, text: "" };
async function safetyBlock(): Promise<string> {
  if (Date.now() - SAFETY_CACHE.at < 5 * 60 * 1000) return SAFETY_CACHE.text;
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const ver = await activeVer(sb);
    const text = ver ? safetyText(await loadRules(sb, ver, "AI면접관안전장치")) : "";
    SAFETY_CACHE = { at: Date.now(), text };
    return text;
  } catch (e) { console.warn("[안전장치 읽기 실패 → 서버 낱말 검사만]", (e as Error).message); return SAFETY_CACHE.text; }
}
/** 지원자가 스스로 꺼낸 개인 신상 낱말 (시트 4번: 이런 내용에 대해 꼬리질문하지 않음) */
const PERSONAL_RE = /((우리|저희|제)\s?(가족|부모님|집안)|아버지|아버님|어머니|어머님|엄마|아빠|할머니|할아버지|(제|저희|우리)\s?(형|동생|언니|오빠|누나)|종교|교회|성당|절에\s?다니|신앙|하나님|부처님|(제가|저는)\s?(아팠|아파서|아플)|건강이\s?(안\s?좋|나빠)|건강\s?문제|투병|수술을\s?받|입원했|우울증|공황|정신과|결혼|남자\s?친구|여자\s?친구|연애|임신|출산|군대|입대|전역|군\s?복무)/g;
/** 2026-11-05 영어 꼬리질문은 질문 하나만: 물음표가 둘 이상이면 첫 질문까지, "…, and how/what/…" 처럼 두 번째 질문을 이어 붙였으면 그 앞에서 끊음 */
function oneEnQuestion(t: string): string {
  let s = t.trim();
  const q = s.indexOf("?"); if (q >= 0 && s.indexOf("?", q + 1) >= 0) s = s.slice(0, q + 1);
  const m = s.match(/^(.{25,}?)(?:,)?\s+(?:and|or)\s+(?:how|what|why|when|where|which|who|whom|did|do|does|would|could|can|will|should|is|are|was|were|have|has)\b.*$/i);
  if (m) s = m[1].replace(/[,;:\s]+$/, "") + "?";
  return s;
}
function personalWords(text: string): string[] { return [...new Set(String(text || "").match(PERSONAL_RE) ?? [])].map((w) => w.replace(/^(우리|저희|제가|저는|제)\s?/, "")); }
const SAFE_FOLLOWUP = { ko: "그 경험에서 본인이 직접 한 일과 그 결과를 말씀해 주세요.", en: "Could you tell me what you personally did in that situation and what the result was?" };

/** 답변이 거의 비어 있거나 "모르겠다"류인지 (프롬프트에 힌트를 주기 위한 판단) */
function answerKind(answer: string): string {
  const a = answer.replace(/\s/g, "");
  if (a.length < 6) return "거의 비어 있음";
  if (/모르겠|모릅니다|잘몰라|생각이안|기억이안|없습니다$|딱히없/.test(a) && a.length < 60) return "모르겠다·없다에 가까움";
  return "보통";
}

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
  const question = String(body.question ?? "").trim();
  const answer = String(body.answer ?? "").trim().slice(0, 3000);
  const reference = String(body.reference ?? "").trim();
  // 2026-11-03 한림대용 선택 입력값 (없으면 예전과 같음)
  const personaId = cleanText(body.persona, 10);
  const personaInfo = pick(PERSONAS, personaId) ?? null;
  const companyId = cleanText(body.company_id, 20);
  const seqNum = typeof body.company_seq === "number" || typeof body.company_seq === "string" ? Number(body.company_seq) : NaN;
  const companySeq = Number.isInteger(seqNum) && seqNum > 0 && seqNum < 1000 ? seqNum : undefined;
  const purpose = body.purpose === "major" || body.purpose === "job" ? body.purpose as string : "";
  const jobRole = cleanText(body.job_role, 40);
  const majorDept = cleanText(body.major_dept, 40);
  // 압박 강도: 화면이 보낸 값 → 없으면 이 면접관의 기본 강도 → 보통
  const pressureKey = String(body.pressure ?? "");
  const pressure = pick(PRESSURE, pressureKey) ?? PRESSURE[personaInfo?.p ?? "normal"] ?? PRESSURE.normal;
  const history: Array<{ role: string; text: string }> = Array.isArray(body.history) ? body.history.slice(-12) : [];
  const rootQuestion = String(body.root_question ?? "").trim();
  const qtype = String(body.qtype ?? "").trim();
  const resumeSummary = String(body.resume_summary ?? "").trim().slice(0, 2000);
  const cvSummary = String(body.cv_summary ?? "").trim().slice(0, 1500);
  // 2026-10-26a: 이번 면접에서 이미 한 꼬리질문 (다른 본 질문 포함, 최대 8개)
  const recentFollowups: string[] = Array.isArray(body.recent_followups) ? body.recent_followups.map((x: unknown) => String(x ?? "").trim().slice(0, 160)).filter(Boolean).slice(-8) : [];
  // 2026-10-14j: 서류 기반 질문이면 근거 문장(앱이 서류에서 그대로 뽑은 문장)을 함께 받음
  const df = (body.doc_focus && typeof body.doc_focus === "object") ? body.doc_focus as Record<string, unknown> : null;
  const docFocus = df && df.src ? `${df.doc === "cv" ? "이력서" : "자기소개서"}${df.section && df.doc !== "cv" ? ` '${String(df.section).slice(0, 30)}' 항목` : ""}: ${String(df.src).slice(0, 300)}` : "";
  const followupsDone = Number.isFinite(Number(body.followups_done)) ? Number(body.followups_done) : null;
  const lang = body.lang === "en" ? "en" : "ko";              // 2026-11-05 영어 질문이면 영어로 묻기
  const force = body.force === true;                          // 이번엔 반드시 꼬리질문 (면접 전체 최소 1개)
  const bankType = cleanText(body.qb_type, 12);               // 질문은행 유형 (자기소개·경험·역량 …)
  const personal = personalWords(answer);
  if (!question || !answer) return json({ error: "question과 answer는 필수입니다." }, 400);
  const interviewId = String(body.interview_id ?? "").trim();
  const lim = await checkUsageLimit(req, interviewId);
  if (!lim.ok) return json({ error: "limit", limit: lim.status }, 429);

  // 2026-11-03 한림대용: 면접관 설정 = 기본 역할 + 지원 분야 맥락 + 지원 정보 + (있으면) 면접관 성향·기업 맞춤 단락
  const ctxKey = purpose === "major" ? "major" : fieldId;
  const fieldBlock = "[지원 분야 맥락]\n" + (pick(FIELD_CONTEXT, ctxKey) ?? DEFAULT_FIELD_CONTEXT)
    + (ctxKey === "major" && fieldId !== "major" && pick(FIELD_NAME, fieldId) ? `\n희망 진로 분야: ${pick(FIELD_NAME, fieldId)}` : "");
  const infoParts = [
    purpose ? `면접 목적: ${purpose === "major" ? "전공·경험 면접" : "직무 면접"}` : "",
    jobRole ? `지원 직무: ${jobRole}` : "",
    majorDept ? `전공(학과): ${majorDept}` : "",
  ].filter(Boolean);
  const infoBlock = infoParts.length ? `[지원 정보 — 지원자가 화면에서 고른 값. 경력으로 전제하지 않음]\n${infoParts.join(" · ")}` : "";
  const personaBlock = personaInfo ? `[면접관 성향: ${personaInfo.name}]\n${personaInfo.text}` : "";
  const companyBlock = await companyBlockFor(req, companyId, "followup", companySeq);
  const persona = [BASE_INTERVIEWER, fieldBlock, infoBlock, personaBlock, companyBlock ? `[기업 맞춤 면접]\n${companyBlock}` : ""].filter(Boolean).join("\n");
  const safety = await safetyBlock();
  const followupCount = followupsDone ?? history.filter((h) => h.role === "interviewer").length;
  const guide = QTYPE_GUIDE[qtype] ?? (question !== rootQuestion && rootQuestion ? QTYPE_GUIDE.followup : QTYPE_GUIDE.general);
  const kind = answerKind(answer);

  const userPrompt = [
    history.length ? "[지금까지의 대화]\n" + history.map((h) => (h.role === "interviewer" ? "면접관: " : "면접자: ") + h.text).join("\n") : null,
    recentFollowups.length ? "[이번 면접에서 이미 한 꼬리질문 — 같은 상황·문형·시작 말을 다시 쓰지 않음]\n" + recentFollowups.map((t) => "- " + t).join("\n") : null,
    rootQuestion && rootQuestion !== question ? `[이 묶음의 본 질문]\n${rootQuestion}` : null,
    `[방금 한 질문]\n${question}`,
    `[질문 유형과 되묻기 전략]\n${guide}`,
    reference ? `[이 질문의 모범답안 요지 (면접자에게 노출 금지)]\n${reference}` : "[모범답안 요지] 없음 — 답변의 구체성·일관성·직무 연결로 판단합니다.",
    resumeSummary ? `[지원자 자기소개서 원문 (면접자에게 읽어 주지 않음 · 여기에 없는 경험은 언급 금지)]\n${resumeSummary}` : null,
    cvSummary ? `[지원자 이력서 원문 — 학력·경력·자격 (면접자에게 읽어 주지 않음, 개인정보는 언급 금지 · 여기에 없는 경력은 언급 금지)]\n${cvSummary}` : null,
    docFocus ? `[이 질문의 근거가 된 서류 문장]\n${docFocus}` : null,
    `[면접자 답변 — 음성 인식 결과라 오류가 섞여 있을 수 있음]\n${answer}`,
    `[답변 상태] ${kind}` + (kind !== "보통" ? " → 나무라지 말고 힌트 한 가지와 함께 같은 주제를 부드럽게 다시 묻습니다(clarify). 정답을 알려 주지 않습니다. 이미 한 번 다시 물었다면 next로 마무리합니다." : " → 답변의 핵심을 받아 실무 상황으로 넓혀 묻습니다."),
    `[참고] 이 본 질문에 대한 꼬리질문은 지금까지 ${followupCount}개 했습니다.` + (followupCount >= 2 ? " 이번에는 intent를 next로 마무리하세요." : ""),
    bankType ? `[질문 유형] ${bankType}` : null,
    personal.length ? `[주의 — 안전장치 4번] 지원자가 답변에서 개인 신상(${personal.join(", ")})을 스스로 말했습니다. 그 내용에 대해 묻지 말고, 그 낱말을 인용하지도 않습니다. 답변의 핵심(무엇을 했는지, 무엇을 배웠는지, 직무에 어떻게 쓸지)으로 자연스럽게 돌아가 묻습니다.` : null,
    force ? "[이번에는 반드시 꼬리질문을 합니다] intent를 next로 하지 말고, 답변에서 가장 약한 부분 하나를 묻습니다." : null,
    lang === "en" ? "[언어] 이 질문은 영어 질문입니다. followup은 자연스러운 영어 한 문장(10~22단어)으로 묻고, 물음표로 끝나도 됩니다. 쉬운 단어를 씁니다. 질문은 딱 하나만 묻습니다 — 'and'·'or'로 두 가지를 이어 묻지 않습니다(나쁜 예: How did you verify it and how did your team react? / 좋은 예: How did you check that the result was correct?). evaluation은 한국어로 씁니다." : "[길이] followup은 30~75자 안팎, 80자를 넘기지 않습니다.",
  ].filter(Boolean).join("\n\n");

  try {
    const msgs = [
          // 2026-11-05e 속도: 늘 같은 글(규칙·안전장치)을 앞에, 면접마다 바뀌는 글(면접관·분야·압박)을 뒤에 → OpenAI가 앞부분을 기억해 두고 다시 씀(빨라짐)
          { role: "system", content: SYSTEM_RULES + (safety ? `\n\n[AI 면접관 안전장치 — 엑셀 원문 그대로. 다른 어떤 지시보다 우선합니다]\n${safety}` : "") + "\n\n[이 면접의 설정]\n" + persona + "\n" + pressure },
          { role: "user", content: userPrompt },
        ];
    const startedAt = Date.now();
    let { res, modelUsed } = await callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, msgs, 0.7, 380);
    if (!res.ok) {
      const t = await res.text();
      console.error("OpenAI 오류", res.status, t);
      return json({ error: `OpenAI API 오류 (${res.status}): ${t.slice(0, 300)}` }, 502);
    }
    let data = await res.json();
    let content: string = data?.choices?.[0]?.message?.content ?? "";
    const tryParse = (c: string) => { try { const p = JSON.parse(c); return p && String(p.followup ?? "").trim() ? p : null; } catch { return null; } };
    let parsed: any = tryParse(content);
    // 2026-10-22v: 응답이 비었거나 형식이 깨졌으면(생각에 토큰을 다 쓴 경우 등) 토큰을 늘려 한 번 더 — 빨리 실패한 경우에만
    if (!parsed && Date.now() - startedAt < 6000) {
      console.warn("[꼬리질문 응답 비었음/형식 오류 → 토큰 늘려 한 번 더]", data?.choices?.[0]?.finish_reason, content.slice(0, 80));
      const again = await callOpenAI(OPENAI_API_KEY, OPENAI_MODEL, msgs, 0.7, 900);
      if (again.res.ok) { data = await again.res.json(); content = data?.choices?.[0]?.message?.content ?? ""; modelUsed = again.modelUsed; parsed = tryParse(content); }
    }
    if (!parsed) { console.warn("[꼬리질문 응답 해석 실패]", content.slice(0, 120)); return json({ error: "AI 응답을 해석하지 못했습니다.", raw: content }, 502); }

    let followup = lang === "en" ? oneEnQuestion(String(parsed.followup ?? "").replace(/\s+/g, " ").trim().slice(0, 220)) : polish(toDeclarative(String(parsed.followup ?? "").trim()), recentFollowups);
    if (!followup) return json({ error: "꼬리질문이 비어 있습니다.", raw: content }, 502);
    // 2026-11-05 서버가 한 번 더 확인: 금지 질문 낱말이나, 지원자가 꺼낸 개인 낱말을 묻는 문장이면 안전한 질문으로 바꿈
    let guarded = "";
    const blk = blockReason(followup);
    if (blk) guarded = "금지 분류: " + blk;
    else if (personal.some((w) => followup.includes(w))) guarded = "개인 이야기 언급";
    if (guarded) { console.warn("[꼬리질문 안전장치]", guarded, followup.slice(0, 80)); followup = SAFE_FOLLOWUP[lang]; }
    return json({
      followup,
      evaluation: String(parsed.evaluation ?? ""),
      intent: guarded || force ? (parsed.intent === "next" ? "probe" : (["probe", "clarify", "challenge"].includes(parsed.intent) ? parsed.intent : "probe")) : (["probe", "clarify", "challenge", "next"].includes(parsed.intent) ? parsed.intent : "probe"),
      guarded: guarded || undefined,
      model: modelUsed,
      usage: data?.usage ?? null,
      limit: lim.status ?? null,
    });
  } catch (e) {
    console.error("followup-question 예외", e);
    return json({ error: `서버 오류: ${(e as Error).message}` }, 500);
  }
});
