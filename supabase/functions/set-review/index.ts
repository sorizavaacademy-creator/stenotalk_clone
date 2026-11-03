// 운영 ZAVAPASS에서 읽어 온 원본 (2026-11-03, 읽기만). 클론(yiuraowvnadqdrnysdce)에만 배포
// 2026-11-03 한림대용: 속기사 채용 → 대학생 채용 면접으로 프롬프트 교체
// 2026-10-23a: 안내 문구의 '교육팀' → '담당자' (부서 이름을 특정하지 않음)
// 2026-10-15: 승인 대기(연습 분야 권한 없음)·이용 기간 종료 계정의 요청은 403 not_approved로 거절 (관리자는 통과)
// StenoTalk AI · set-review Edge Function (2026-10-08)
// 실전 세트(2026-10-19d부터 8개 분야)가 끝나면 면접관 종합 의견을 만들어 돌려줍니다.
// 요청 (POST, JSON)
//   { field_id, field_name, interview_id, overall_score, duration_label, overtime,
//     items: [{ slot_name, q, answer, score, followup }] }   // answer는 600자까지
//   2026-11-03 한림대용 선택: field_id = gov|pubcorp|corp|startup|welfare|major (모르는 값은 일반 대학생 채용 면접),
//     persona_ids: ["hr","lead",…] (오늘 면접관, 최대 10명), company_id (기업 맞춤 면접 — 회사 자료는 호출자 토큰으로 get_company_pack에서 읽음),
//     purpose('major'|'job'), job_role(40자), major_dept(40자). 없으면 예전과 같이 동작
// 응답
//   { headline, strengths[2], improvements[2], next[3], model }
// AI 횟수: 같은 면접(interview_id)은 한 번만 셈 (ai_usage_try). 한도면 429 {error:'limit'}
// verify_jwt 끔, 함수 안에서 로그인 확인. Secret: OPENAI_API_KEY, OPENAI_MODEL(선택)

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { loadCompanyPack, buildCompanyBlock } from '../_shared/company_prompt.ts';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-5.6-luna';
const FALLBACK_MODEL = 'gpt-4o-mini';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function isNewGen(m: string) { return /^(gpt-5|o\d|gpt-6)/i.test(m); }
function buildBody(model: string, messages: unknown[], maxTokens: number) {
  const b: Record<string, unknown> = { model, messages, response_format: { type: 'json_object' } };
  if (isNewGen(model)) b.max_completion_tokens = maxTokens; else { b.temperature = 0.5; b.max_tokens = maxTokens; }
  return b;
}
async function callOpenAI(messages: unknown[], maxTokens: number) {
  const send = (b: Record<string, unknown>) => fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  });
  const body = buildBody(OPENAI_MODEL, messages, maxTokens);
  let res = await send(body);
  if (res.status === 400) {
    const t = await res.clone().text();
    if (/temperature|max_tokens|max_completion_tokens|unsupported/i.test(t)) { delete body.temperature; delete body.max_tokens; body.max_completion_tokens = maxTokens; res = await send(body); }
  }
  if ((res.status === 404 || res.status === 400) && OPENAI_MODEL !== FALLBACK_MODEL) {
    const t = await res.clone().text();
    if (/model|not found|does not exist/i.test(t)) { res = await send(buildBody(FALLBACK_MODEL, messages, maxTokens)); return { res, modelUsed: FALLBACK_MODEL }; }
  }
  return { res, modelUsed: OPENAI_MODEL };
}
async function requireUser(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token === SUPABASE_ANON_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } });
    if (!r.ok) return null; const u = await r.json(); return u && u.id ? { id: u.id } : null;
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
async function checkUsage(req: Request, interviewId: string) {
  if (!interviewId) return { ok: true, status: null };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_usage_try`, {
      method: 'POST', headers: { Authorization: req.headers.get('Authorization') ?? '', apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_interview_id: interviewId }),
    });
    if (!r.ok) return { ok: true, status: null };
    const st = await r.json();
    return st && st.allowed === false ? { ok: false, status: st } : { ok: true, status: st };
  } catch { return { ok: true, status: null }; }
}

// 2026-10-19d: 분야(field_id)마다 면접관·면접 순서·다음 연습 예시를 바꿈
// 2026-11-03 한림대용: 한림대 5개 분야 + 전공·경험 면접(major). 모르는 id는 일반 대학생 채용 면접
const FIELD_SET: Record<string, { who: string; org: string; know: string; ex: string }> = {
  gov:     { who: '시청 인사 부서에서 공무원 면접위원을 여러 번 맡아 온 주무관', org: '공무원', know: '공직가치·직무 이해', ex: '공직가치 하나를 골라 내 경험과 묶어 30초로 말하기' },
  pubcorp: { who: '공공기관 인사팀에서 신입 채용 면접을 맡아 온 차장', org: '공공기관·공기업', know: '기관 이해·NCS 직업기초능력', ex: '지원 기관의 주요 사업 하나와 내 역량을 30초로 잇기' },
  corp:    { who: '대기업 인사팀에서 신입 공채 면접을 맡아 온 과장', org: '대기업·중견기업', know: '직무·회사 이해', ex: '대표 경험 하나를 상황·행동·결과와 숫자로 1분에 말하기' },
  startup: { who: '스타트업에서 팀을 이끌며 신입 채용 면접을 직접 보는 팀장', org: '스타트업·중소기업', know: '실행력·서비스 이해', ex: '스스로 문제를 찾아 해결한 경험을 시도·결과·배운 점으로 말하기' },
  welfare: { who: '종합사회복지관에서 신입 사회복지사·교육 담당자 면접을 맡아 온 부장', org: '교육·복지·비영리 기관', know: '대상자 이해·직업윤리', ex: '대상자를 도운 경험 하나를 내 행동과 변화 중심으로 1분에 말하기' },
  major:   { who: '학과 교수와 현업 실무자로 이루어진 전공 면접 위원', org: '전공·경험', know: '전공 지식·프로젝트 경험', ex: '자신 있는 과목 개념 하나를 내 프로젝트 예로 1분에 설명하기' },
};
const DEFAULT_SET = { who: '여러 기업·기관의 신입 채용 면접을 맡아 온 면접관', org: '대학생 채용', know: '직무 이해', ex: '지원 동기를 결론부터 30초로 말하기' };
// 면접관 10명 (화면 PEOPLE의 id) — 종합 의견에서 '오늘 패널이 무엇을 봤는지' 설명에 씀
const PANEL: Record<string, { n: string; q: string }> = {
  hr: { n: '인사팀장', q: '인성·조직 적합도' },
  lead: { n: '현업 팀장', q: '직무 경험의 구체성' },
  exec: { n: '임원', q: '가치관과 장기 목표' },
  senior: { n: '입사 선배', q: '긴장을 풀어 주며 기본기' },
  press: { n: '압박형 면접관', q: '답변의 허점과 흔들림 없는 대응' },
  data: { n: '데이터형 면접관', q: '성과의 수치와 근거' },
  value: { n: '인재상 검증형 면접관', q: '인재상·핵심가치와 맞는지' },
  logic: { n: '논리 검증형 면접관', q: '판단의 이유와 앞뒤 논리' },
  quiet: { n: '무반응형 면접관', q: '반응이 없어도 흔들리지 않는지' },
  ethics: { n: '공공·청렴형 면접관', q: '공정성·청렴·공공성 판단' },
};
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/** 화면에서 온 짧은 글: 줄바꿈·제어문자·괄호·따옴표를 빼고 n자까지 */
function cleanText(v: unknown, n: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f<>{}\[\]`"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}
/** 기업 맞춤 면접이면 회사 자료를 호출자 토큰(JWT)으로 읽음. 없거나 실패하면 null → 일반 종합 의견 */
async function companyFor(req: Request, companyId: string): Promise<{ name: string; block: string } | null> {
  if (!companyId || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 3000));
    const pack = await Promise.race([loadCompanyPack(sb, companyId), timeout]);
    return pack ? { name: cleanText(pack.talent.name, 40), block: buildCompanyBlock(pack, 'grade') } : null;
  } catch (e) { console.warn('[기업 자료 읽기 실패 → 일반 종합 의견]', (e as Error).message); return null; }
}
function buildSystem(fieldId: string, panelIds: string[] = [], company: { name: string; block: string } | null = null): string {
  const f = has(FIELD_SET, fieldId) ? FIELD_SET[fieldId] : DEFAULT_SET;
  const org = company && company.name ? `${company.name} 채용` : f.org;
  const panel = panelIds.map((id) => PANEL[id]).filter(Boolean);
  const who = panel.length > 1 ? `오늘 면접 패널(${panel.map((p) => p.n).join('·')})을 대표하는 면접관` : panel.length === 1 ? panel[0].n : f.who;
  const panelText = panel.length ? `[오늘 면접관과 각자 본 것]\n${panel.map((p) => `- ${p.n}: ${p.q}`).join('\n')}\n` : '';
  return `당신은 ${who}이며, 오늘 ${org} 면접(한림대학교 학생 대상 모의면접)의 면접관이었습니다.
지원자는 한림대학교 재학생·졸업예정자이며, 방금 15분 안팎의 면접(자기소개 → 지원동기 → ${f.know} 질문 → 상황·경험 질문 → 마지막 할 말 등)을 마쳤습니다.
${panelText}면접을 마친 면접관이 지원자에게 직접 건네는 종합 의견을 씁니다.

[규칙]
- 한국어 존댓말, 따뜻하지만 냉정하게. 칭찬만 늘어놓지 않습니다.
- 반드시 지원자가 실제로 한 말에 근거합니다. 답변 속 표현을 짧게 인용하면 좋습니다. 하지 않은 말을 지어내지 않습니다.
- 지원자는 대학생입니다. 실무 경력이 없다는 점을 약점으로 삼지 말고, 학교·대외활동·아르바이트 경험을 상황·행동·결과, 숫자, 본인 역할, 직무 연결로 얼마나 잘 보여 줬는지를 봅니다.
- headline: 오늘 면접 전체를 한 문장(50자 안팎)으로.
- strengths: 강점 2개. 각각 어느 질문(칸 이름)에서 무엇이 좋았는지, 70자 이내.
- improvements: 보완할 점 2개. 어느 질문에서 무엇이 빠졌고 어떻게 고치면 되는지, 80자 이내.
- next: 다음 연습 3개. 바로 할 수 있는 행동으로(예: "${f.ex}"), 각 50자 이내.
- 합격·불합격을 예측하지 않습니다. 점수 숫자를 반복해서 말하지 않습니다.
- 15분을 넘겼다면 시간 관리 조언을 하나 넣습니다. 답변이 비어 있는 질문이 있으면 그 점을 짚습니다.
- 음성 인식 결과라 오탈자가 있을 수 있으니 지적하지 않습니다.
- 지원 분야(${org})와 다른 기관·회사를 전제로 말하지 않습니다.
${company && company.block ? `\n[기업 맞춤 면접 참고 — 인재상·평가 포인트만 참고하고, 아래 JSON 형식은 그대로 지킵니다]\n${company.block}\n` : ''}
반드시 아래 JSON으로만 답합니다:
{"headline":"...","strengths":["...","..."],"improvements":["...","..."],"next":["...","...","..."]}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);
  const user = await requireUser(req);
  if (!user) return json({ error: '로그인이 필요합니다.' }, 401);
  { const ap = await requireApproved(req, user.id); if (!ap.ok) return json({ error: "not_approved", reason: ap.reason, message: NOT_APPROVED_MSG[ap.reason ?? "pending"] ?? NOT_APPROVED_MSG.pending }, 403); }   // 2026-10-15 승인 대기·기간 종료 계정 거절
  if (!OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY Secret이 없습니다.' }, 500);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: '요청 본문이 JSON이 아닙니다.' }, 400); }
  const items: any[] = Array.isArray(body.items) ? body.items.slice(0, 16) : [];
  if (!items.length) return json({ error: 'items가 비어 있습니다.' }, 400);
  const lim = await checkUsage(req, String(body.interview_id ?? '').trim());
  if (!lim.ok) return json({ error: 'limit', limit: lim.status }, 429);

  const lines = items.map((it, i) => {
    const a = String(it.answer ?? '').trim().slice(0, 600);
    return `${i + 1}. [${String(it.slot_name ?? '')}${it.followup ? ' · 꼬리질문' : ''}] ${String(it.q ?? '').slice(0, 200)}\n   점수: ${Number(it.score) || 0}점\n   답변: ${a || '(답변 없음)'}`;
  }).join('\n');
  // 2026-11-03 한림대용 선택 입력값 (없으면 예전과 같음)
  const purpose = body.purpose === 'major' || body.purpose === 'job' ? String(body.purpose) : '';
  const fieldKey = purpose === 'major' ? 'major' : String(body.field_id ?? '');
  const panelIds: string[] = Array.isArray(body.persona_ids)
    ? [...new Set((body.persona_ids as unknown[]).filter((x): x is string => typeof x === 'string' && has(PANEL, x)))].slice(0, 10) : [];
  const company = await companyFor(req, cleanText(body.company_id, 20));
  const jobRole = cleanText(body.job_role, 40);
  const majorDept = cleanText(body.major_dept, 40);
  const info = [purpose ? `면접 목적: ${purpose === 'major' ? '전공·경험 면접' : '직무 면접'}` : '', jobRole ? `지원 직무: ${jobRole}` : '', majorDept ? `전공(학과): ${majorDept}` : ''].filter(Boolean).join(' · ');
  const userPrompt = [
    `[분야] ${String(body.field_name ?? '').slice(0, 40) || '면접'}`,
    info ? `[지원 정보] ${info}` : null,
    `[전체] 종합 ${Number(body.overall_score) || 0}점 · 소요 ${String(body.duration_label ?? '')}${body.overtime ? ' · 15분 초과' : ''}`,
    `[질문과 답변]\n${lines}`,
  ].filter(Boolean).join('\n\n');

  try {
    const { res, modelUsed } = await callOpenAI([{ role: 'system', content: buildSystem(fieldKey, panelIds, company) }, { role: 'user', content: userPrompt }], 1400);
    if (!res.ok) { const t = await res.text(); console.error('OpenAI 오류', res.status, t); return json({ error: `OpenAI API 오류 (${res.status})` }, 502); }
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    let p: any; try { p = JSON.parse(content); } catch { return json({ error: 'AI 응답을 해석하지 못했습니다.' }, 502); }
    const arr = (v: unknown, n: number) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, n) : [];
    const out = { headline: String(p.headline ?? '').trim(), strengths: arr(p.strengths, 2), improvements: arr(p.improvements, 2), next: arr(p.next, 3), model: modelUsed };
    if (!out.headline && !out.strengths.length) return json({ error: '종합 의견이 비어 있습니다.' }, 502);
    return json(out);
  } catch (e) {
    console.error('set-review 예외', e);
    return json({ error: `서버 오류: ${(e as Error).message}` }, 500);
  }
});
