// 2026-11-05 클론(ZAVAPASS-clone) 전용: 면접 DB(엑셀) 공용 — 금지 질문 낱말 검사, AI 면접관 안전장치·피드백 규칙 읽기
// 규칙 문장은 엑셀(AI면접관안전장치·AI피드백규칙 시트)을 넣은 DB(qb_rules)에서 그대로 읽음 → 엑셀을 고쳐 다시 올리면 바로 반영
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

/** DB의 qb_block_reason과 같은 규칙. 걸리면 분류 이름, 아니면 null (AI가 만든 질문·꼬리질문을 한 번 더 거르는 데 씀) */
const BLOCK: [string, RegExp][] = [
  ["연애·결혼·출산", /(여자\s?친구|남자\s?친구|이성\s?친구|(^|[^장])애인|연애\s?(경험|하|중)|결혼\s?(계획|했|하셨|여부|하면|할\s?생각|은\s?언제|할\s?건)|기혼|미혼|출산\s?(계획|하면)|아이는\s?언제|자녀\s?(계획|가\s?있))/],
  ["가족 배경·재산", /(부모님\s?(의\s?)?(직업|뭐\s?하|무슨\s?일)|(아버지|아버님|어머니|어머님)(는|께서|의)?\s?(직업|뭐\s?하|무슨\s?일)|가족\s?(관계|소개|구성)|집안\s?(형편|환경|사정)|형제\s?관계|재산(?!권)|자가(인가|예요|야|에\s?사)|집이\s?자가|호구\s?조사)/],
  ["외모·신체", /(몸무게|체중(이|은|이\s?얼마|\s?관리)|키(가|는|와)\s?(몇|어떻게|얼마)|외모\s?관리|화장(은|을)?\s?평소|문신|살\s?(좀\s?)?빼)/],
  ["종교·정치", /(종교(가|는|를|\s?있)|교회\s?다니|성당\s?다니|절에\s?다니|지지(하는)?\s?정당|정치\s?(성향|적\s?성향)|어느\s?정당)/],
  ["출신지역·거주지·학벌", /(고향|어디\s?(사세요|살아|사시|살고)|집이\s?어디|사는\s?곳|거주지|출신\s?지역|지방대(라서|인데))/],
  ["나이", /(몇\s?살|나이가\s?많은데|늦은\s?나이|나이가\s?어떻게|나이는\s?어떻게)/],
  ["건강·장애", /(아픈\s?곳|아픈곳|건강\s?상태|건강은\s?괜찮|건강한지|질병이\s?있|지병|병력|장애가\s?있|장애\s?여부|정신과)/],
  ["음주·흡연", /(주량|(^|[\s(,/])술(을|은)?\s?(잘|좋아|얼마|자주|마시|드시)|음주|흡연(을|하|여부|자)|담배\s?(피우|피워|피세|피시|피는))/],
  ["성별·병역", /((여자|여성)(인데|라서|이라서|로서\s?이\s?일)|(남자|남성)(인데|라서|이라서)|군대|병역|군\s?복무|전역|군필|미필|군\s?제대|제대\s?(후|했|하고|하셨|한))/],
];
export function blockReason(text: string): string | null {
  const t = String(text || "");
  for (const [name, re] of BLOCK) if (re.test(t)) return name;
  return null;
}

export async function activeVer(sb: SupabaseClient): Promise<number | null> {
  const { data } = await sb.from("app_settings").select("value").eq("key", "qbank").maybeSingle();
  const v = data?.value?.active; return Number.isInteger(v) ? v : (v ? Number(v) : null);
}

type Rule = { sheet: string; ord: number; kind: string | null; section: string | null; label: string | null; content: string | null; extra: string | null };
/** 그 판의 규칙 줄 (AI 설정에 넣는 것만) */
export async function loadRules(sb: SupabaseClient, ver: number, sheet: string): Promise<Rule[]> {
  const { data } = await sb.from("qb_rules").select("sheet,ord,kind,section,label,content,extra").eq("ver", ver).eq("sheet", sheet).eq("for_prompt", true).order("ord");
  return (data ?? []) as Rule[];
}

/**
 * AI면접관안전장치 시트의 1~8번을 그대로 프롬프트 글로 만듦.
 * sections를 주면 그 번호만 (예: [1,2,7,8] = 질문 다듬기용). 2번 표는 "분류: 묻지 않는 예 → 꼭 필요하면 이렇게 바꿔 묻기"로 펼침
 */
export function safetyText(rules: Rule[], sections?: number[]): string {
  const L: string[] = [];
  let cur = 0;
  for (const r of rules) {
    if (r.kind === "heading" && r.section && /^\d\./.test(r.section) && r.content === r.section) {
      cur = Number(r.section.split(".")[0]);
      if (!sections || sections.includes(cur)) L.push(`\n[${r.section}]`);
      continue;
    }
    if (!cur || (sections && !sections.includes(cur))) continue;
    if (r.kind === "directive" && r.content) L.push(`- ${r.content}`);
    else if (r.kind === "banned_category") L.push(`- ${r.label}: 묻지 않는 예) ${r.content ?? ""} → 꼭 필요하면) ${r.extra ?? ""}`);
  }
  return L.join("\n").trim();
}
