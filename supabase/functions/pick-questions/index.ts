// 2026-11-05 클론(ZAVAPASS-clone) 전용 — 면접 DB 3단계: 기업·직무 맞춤 면접 8문항 뽑기
// 요청: { talent_id?, company_name?, grp?: '대기업'|'공기업', job?, english?: boolean }
// 응답: { pick_id, ver, company:{key,name,grp}|null, job, items:[{ seq, qtype, text, lang, qid, tier, how }], filled }
//
// 순서: 자기소개 1 → 지원동기 1 → 경험·역량 2 → 인성·가치관 1(영어를 고르면 영어 1) → 직무·전공지식 1 + 기업·산업 1(기업이 없으면 직무·전공지식 2) → 마무리 1
// 뽑기: '출제 가중치'를 확률로(qb_pick_candidates) · 같은 대표 질문은 한 번만 · 최근 면접 5번에 낸 대표 질문 피하기(자기소개·지원동기·마무리 제외)
//       · 부족하면 기업+직종 → 기업 → 같은 구분+직종 → 같은 구분 → 전체 · '기타' 유형과 금지 질문은 출제하지 않음 · 경력직 면접 질문은 빼고
// 2026-11-05 6단계 후속: 다듬을 때 칸 유형에 맞는지, 학생 사정을 단정한 질문인지도 점검 (맞지 않으면 바꾸거나 다른 질문으로)
// 다듬기: 질문은행 문장은 학생에게 그대로 보내지 않고 AI가 자연스러운 면접 질문으로 다듬은 문장만 보냄 (보관함에 있으면 다시 씀)
//         다듬을 때 안전장치(엑셀 AI면접관안전장치 1·2·7·8번) 자체 점검 → 걸리면 다른 질문으로 바꿈. 서버도 금지 낱말로 한 번 더 확인
import { adminClient, askJson, cleanText, json, corsHeaders, requireUser, requireApproved, NOT_APPROVED_MSG, OPENAI_MODEL } from "../_shared/ai_common.ts";
import { activeVer, blockReason, loadRules, safetyText } from "../_shared/qbank.ts";

const EXEMPT = new Set(["자기소개", "지원동기", "마무리"]);   // 종류가 적어서 최근에 냈어도 다시 낼 수 있음
const DAILY_LIMIT = 30;                                        // 한 사람이 하루에 뽑을 수 있는 면접 수 (남용 방지)
const SPARE = 5;                                               // 유형마다 예비 후보 수 (다듬다가 걸리면 바꿔 씀)

type Cand = { id: string; company_key: string | null; company: string | null; rep: string | null; question: string | null; rep_key: string; tier: number };
type Slot = { seq: number; qtype: string; cand?: Cand; text?: string; lang?: string; how?: string };

const SYSTEM = (safety: string) => `너는 한국 대학생(신입 지원자)을 위한 모의면접의 '질문 편집자'다. 아래 [질문 원문]은 실제 면접 후기에서 모은 메모라 말투가 거칠거나 문장이 불완전하다. 각 원문을 실제 면접관이 지원자에게 묻는 자연스러운 질문으로 다듬어라.

[다듬는 규칙]
- 원문이 확인하려는 핵심(무엇을 묻는지)은 바꾸지 않는다. 원문에 없는 조건·숫자·상황·회사 정보를 지어내지 않는다.
- 면접관 말투의 존댓말 한 문장(길어도 두 문장), 90자 이내. 예: "~에 대해 말씀해 주세요.", "~라고 생각하시나요?"
- 후기 말투("~물어봄", "~했음", "질문함", "등등", "→ (꼬리)", 괄호 속 메모, 지원자 감상)는 모두 지운다. 원문에 질문이 여러 개 섞여 있으면 핵심 질문 하나만 남긴다.
- 원문에 다른 회사 이름이 있으면, [지원 회사]가 있을 때는 그 이름으로, 없을 때는 "지원하신 회사"로 바꾼다. 실존 면접관·다른 지원자 등 특정인은 언급하지 않는다. 회사를 깎아내리거나 내부 문화를 단정하지 않는다.
- [다른 회사 제품 빼기] 원문에 [지원 회사]가 아닌 회사의 제품·서비스·브랜드·사업 이름(예: 스타일러, 그램, 갤럭시, 배달의민족, 카카오톡)이 있으면 그대로 두지 않는다. [원문 회사]가 [지원 회사]와 다르거나 알 수 없을 때는 특히 주의한다. "지원하신 회사의 주력 제품(서비스)"처럼 일반 표현으로 바꾼다(예: "스타일러의 점유율을 늘릴 전략" → "Could you suggest a strategy to grow the market share of one of our main products?"). 지원 회사의 제품 이름을 새로 지어내지 않는다. 일반 표현으로 바꾸면 질문의 핵심이 사라지면 ok=false, reason "다른회사".
- [업종 맞추기] 원문이 [지원 회사]와 다른 업종에서만 쓰는 전문 내용(예: 게임 회사 지원자에게 PCB 제조 공정, 은행 지원자에게 반도체 공정)을 묻는다면 ok=false, reason "다른회사". 어느 회사·직무에서나 물을 수 있는 일반 질문은 그대로 다듬는다.
- 유형이 '영어'이면 영어로 묻는 자연스러운 영어 질문으로 쓰고 lang을 "en"으로 한다(예: "Could you briefly introduce yourself in English?"). 나머지 유형은 반드시 한국어 질문으로 쓰고 lang은 "ko". 영어 유형이 아닌데 원문이 영어로 답하라는 질문(예: "영어로 자기소개")이면 ok=false, reason "영어".
- 유형이 '자기소개'이면 시간이 원문에 있을 때만 그 시간을 넣는다(예: 1분 자기소개). '마무리'는 면접을 끝내며 묻는 말로 다듬는다.
- 한 면접 안에서 뜻이 겹치면 안 된다. [이미 정해진 질문]이나 목록의 앞 번호 질문과 사실상 같은 것을 묻는 질문(예: "회사를 선택한 이유"와 "왜 입사하고 싶은지")은 ok를 false로 하고 reason을 "중복"으로 적는다.
- 직장 경력(이직·퇴사·전 직장)을 전제로 한 질문은 학생에게 맞지 않으니 ok=false, reason "경력직".
- [유형 맞추기] 다듬은 질문이 그 칸의 [유형]에 맞아야 한다. 맞지 않으면 ok=false, reason "유형". 유형 뜻: 자기소개=자신을 소개 / 지원동기=왜 이 회사·직무인지 / 경험·역량=지난 경험에서 한 행동과 결과 / 인성·가치관=성격·가치관·태도 / 직무·전공지식=직무나 전공의 지식·개념·업무 이해(경험 회상, 가치관, 서류 내용 설명은 해당 안 됨) / 기업·산업=지원 회사·산업의 사업·시장·이슈 이해(개인 목표·인생관은 해당 안 됨) / 상황대처=가정한 상황에서의 판단 / 영어=영어로 묻는 질문 / 마무리=면접을 끝내며 하는 말.
- [단정하지 않기] 원문이 특정 지원자의 사정을 전제하면(예: "학업 성적이 낮은 이유", "해외 인턴 경험이 없는 이유", "해당 프로젝트", "자기소개서에 쓴 ○○", "공백기가 긴 이유") 이 학생에게는 사실이 아닐 수 있다. 누구에게나 물을 수 있는 중립 질문으로 바꾼다(예: "학업 성적을 스스로 어떻게 평가하는지 말씀해 주세요.", "해외 경험이나 그에 준하는 경험이 있다면 말씀해 주세요.", "진행했던 프로젝트 하나를 골라 맡은 역할과 결과를 말씀해 주세요."). 중립으로 바꾸면 핵심이 사라지면 ok=false, reason "단정".
- 다듬은 질문이 아래 [AI 면접관 안전장치]의 '절대 묻지 않는 질문'에 해당하거나 '질문 전 자체 점검'을 통과하지 못하면, 고치지 말고 ok를 false로 하고 reason에 분류를 적는다. 직무와 무관한 개인 신상을 묻는 질문도 ok=false.

[AI 면접관 안전장치 — 엑셀 원문 그대로]
${safety}

반드시 아래 JSON 형식으로만 답한다.
{"items":[{"i":번호,"ok":true,"text":"다듬은 질문","lang":"ko"}, {"i":번호,"ok":false,"reason":"분류"}]}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST만 받아요" }, 405);
  const user = await requireUser(req);
  if (!user) return json({ error: "로그인이 필요해요" }, 401);
  const ap = await requireApproved(user.id);
  if (!ap.ok) return json({ error: NOT_APPROVED_MSG[ap.reason ?? ""] ?? "사용할 수 없어요", reason: ap.reason }, 403);

  let p: Record<string, unknown> = {};
  try { p = await req.json(); } catch { return json({ error: "요청 본문이 JSON이 아니에요" }, 400); }
  const sb = adminClient();
  const ver = await activeVer(sb);
  if (!ver) return json({ error: "no_bank", message: "면접 DB가 아직 준비되지 않았어요" }, 503);

  // 하루 한도
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: today } = await sb.from("qb_served").select("pick_id").eq("user_id", user.id).gte("served_at", since).limit(2000);
  if (new Set((today ?? []).map((r: { pick_id: string }) => r.pick_id)).size >= DAILY_LIMIT) return json({ error: "limit", message: "오늘 만들 수 있는 면접 수를 다 썼어요. 내일 다시 해 주세요." }, 429);

  // 지원 회사 → 엑셀 기업키
  const talentId = cleanText(p.talent_id, 20);
  let company: { key: string; name: string; grp: string | null } | null = null;
  if (talentId) {
    const { data: links } = await sb.from("qb_company_links").select("company_key").eq("talent_id", talentId).limit(1);
    const key = links?.[0]?.company_key;
    if (key) {
      const { data: co } = await sb.from("qb_companies").select("key,name,grp").eq("ver", ver).eq("key", key).maybeSingle();
      if (co) company = co as { key: string; name: string; grp: string | null };
    }
  }
  const grpIn = p.grp === "대기업" || p.grp === "공기업" ? p.grp as string : null;
  const grp = company?.grp ?? grpIn;
  const targetName = company?.name ?? (cleanText(p.company_name, 40) || null);
  const job = cleanText(p.job, 20) || null;
  const english = p.english === true;
  const targetKey = company?.key ?? (grp ? "grp:" + grp : "all");

  const types = ["자기소개", "지원동기", "경험·역량", "경험·역량", english ? "영어" : "인성·가치관", "직무·전공지식", company ? "기업·산업" : "직무·전공지식", "마무리"];
  const slots: Slot[] = types.map((qtype, i) => ({ seq: i + 1, qtype }));
  const need: Record<string, number> = {}; types.forEach((t) => { need[t] = (need[t] ?? 0) + 1; });

  // 후보 뽑기
  const { data: recentData } = await sb.rpc("qb_recent_reps", { p_user: user.id, p_n: 5 });
  const recent: string[] = Array.isArray(recentData) ? recentData : [];
  const used: string[] = [];
  const pool: Record<string, Cand[]> = {};
  for (const t of Object.keys(need)) {
    const exclude = EXEMPT.has(t) ? used.slice() : recent.concat(used);
    const { data, error } = await sb.rpc("qb_pick_candidates", { p_ver: ver, p_qtype: t, p_company: company?.key ?? null, p_grp: grp, p_job: job, p_exclude: exclude, p_n: need[t] + SPARE });
    if (error) return json({ error: "pick_failed", message: error.message }, 500);
    pool[t] = (data ?? []) as Cand[];
    pool[t].forEach((c) => used.push(c.rep_key));
  }
  // 칸에 후보 넣기 (예비는 남김)
  const take = (t: string): Cand | undefined => pool[t]?.shift();
  slots.forEach((s) => { s.cand = take(s.qtype); });

  // 다듬은 질문 보관함
  const keyOf = (c: Cand) => `${c.rep_key}|${targetKey}`;
  const allKeys = Object.values(pool).flat().concat(slots.map((s) => s.cand).filter(Boolean) as Cand[]).map(keyOf);
  const cache = new Map<string, { text: string; lang: string }>();
  if (allKeys.length) {
    const { data } = await sb.from("qb_polished").select("key,text,lang").in("key", allKeys);
    (data ?? []).forEach((r: { key: string; text: string; lang: string }) => { if (!blockReason(r.text)) cache.set(r.key, { text: r.text, lang: r.lang }); });
  }
  const fromCache = (s: Slot) => { const c = s.cand && cache.get(keyOf(s.cand)); if (c && (c.lang === "en") !== (s.qtype === "영어")) return false; if (c) { s.text = c.text; s.lang = c.lang; s.how = "보관함"; } return !!c; };
  slots.forEach(fromCache);

  // AI 다듬기 (최대 3번: 걸린 질문은 예비 후보로 바꿔 다시)
  let safety = "";
  try { safety = safetyText(await loadRules(sb, ver, "AI면접관안전장치"), [1, 2, 7, 8]); } catch (_) { /* 규칙을 못 읽어도 서버 낱말 검사는 함 */ }
  let aiError = "";
  for (let round = 0; round < 3; round++) {
    const todo = slots.filter((s) => s.cand && !s.text);
    if (!todo.length) break;
    const lines = todo.map((s, i) => `${i}. [유형: ${s.qtype}] [원문 회사: ${s.cand!.company ?? "-"}] ${(s.cand!.question || s.cand!.rep || "").slice(0, 200)}${s.cand!.rep && s.cand!.rep !== s.cand!.question ? ` (대표 질문: ${s.cand!.rep.slice(0, 120)})` : ""}`);
    const fixed = slots.filter((s) => s.text).map((s) => `- [${s.qtype}] ${s.text}`);
    const userMsg = `[지원 회사] ${targetName ?? "없음 (구분: " + (grp ?? "전체") + ")"}\n[지원 직종] ${job ?? "-"}\n\n[이미 정해진 질문]\n${fixed.join("\n") || "(없음)"}\n\n[질문 원문]\n${lines.join("\n")}`;
    let items: { i: number; ok: boolean; text?: string; lang?: string; reason?: string }[] = [];
    try {
      const { data } = await askJson(SYSTEM(safety), userMsg, { maxTokens: 3000, timeoutMs: 35000 });
      items = Array.isArray(data.items) ? data.items as typeof items : [];
    } catch (e) { aiError = (e as Error).message; break; }
    const saves: Record<string, unknown>[] = [];
    todo.forEach((s, i) => {
      const it = items.find((x) => Number(x.i) === i);
      const text = cleanText(it?.text, 200);
      const enText = /영어로|in english|[A-Za-z]{4,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/i.test(text);
      const bad = !it || it.ok === false || !text || !!blockReason(text) || (s.qtype !== "영어" && (it.lang === "en" || enText)) || (s.qtype === "영어" && it.lang !== "en" && !enText);   // 영어 칸만 영어, 나머지는 한국어
      if (bad) { const next = take(s.qtype); s.cand = next; if (next) fromCache(s); return; }
      s.text = text; s.lang = it!.lang === "en" || s.qtype === "영어" ? "en" : "ko"; s.how = "AI";
      saves.push({ key: keyOf(s.cand!), rep_key: s.cand!.rep_key, target: targetKey, qtype: s.qtype, text, lang: s.lang, model: OPENAI_MODEL });
    });
    if (saves.length) await sb.from("qb_polished").upsert(saves, { onConflict: "key", ignoreDuplicates: true });
  }
  // AI가 안 되면: 남은 예비 후보 중 보관함에 있는 것으로 (원문은 절대 보내지 않음)
  slots.forEach((s) => {
    if (s.text) return;
    let c: Cand | undefined;
    while ((c = take(s.qtype))) { s.cand = c; if (fromCache(s)) return; }
    s.cand = undefined;   // 이 칸은 화면이 한림대 기본 질문으로 채움
  });

  const pickId = crypto.randomUUID();
  const final = slots.filter((s) => s.text && s.cand);
  if (final.length) {
    await sb.from("qb_served").insert(final.map((s) => ({ user_id: user.id, pick_id: pickId, ver, seq: s.seq, qid: s.cand!.id, rep_key: s.cand!.rep_key, qtype: s.qtype, company_key: s.cand!.company_key, target: targetKey, tier: s.cand!.tier, how: s.how })));
  }
  return json({
    pick_id: pickId, ver, company, grp, job,
    items: slots.map((s) => s.text && s.cand ? { seq: s.seq, qtype: s.qtype, text: s.text, lang: s.lang ?? "ko", qid: s.cand.id, tier: s.cand.tier, how: s.how } : { seq: s.seq, qtype: s.qtype, text: null }),
    filled: final.length, ai_error: aiError || undefined,
  });
});
