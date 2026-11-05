-- 020 (클론 전용 · ZAVAPASS-clone yiuraowvnadqdrnysdce) 2026-11-05
-- 전체 점검에서 '면접 기출' 목록에 금지 질문이 섞여 나옴:
--   "흡연 시간이 정해진 근무 환경에 적응할 수 있는가?" (음주·흡연), "타지에서 생활할 수 있는지와 연고지 상황" (출신지역·거주지)
-- 1) 금지 낱말 검사(qb_block_reason)에 개인의 흡연 여부·연고지를 더함
--    - 흡연: "흡연 여부/시간/하세요", "담배 피우세요/피느냐/끊을 수" 같은 개인 질문만. KT&G "담배 산업 트렌드" 같은 회사·산업 질문은 그대로 둠
--    - 연고지: 출신·연고를 묻는 말. "지방 근무 가능한지/타지 생활 괜찮은지"(근무지 이동 가능 여부)는 묻을 수 있는 질문이라 그대로 둠
-- 2) 질문은행(qb_questions)에서 새로 걸리는 질문은 출제하지 않게 표시
-- 3) 면접 기출(ic_target_json)에서 직장 경력을 전제로 한 질문(이직·이전 직장)은 학생에게 맞지 않아 뺌

create or replace function public.qb_block_reason(q text) returns text language sql immutable as $$
  select case
    when q ~ '(여자\s?친구|남자\s?친구|이성\s?친구|(^|[^장])애인|연애\s?(경험|하|중)|결혼\s?(계획|했|하셨|여부|하면|할\s?생각|은\s?언제|할\s?건)|기혼|미혼|출산\s?(계획|하면)|아이는\s?언제|자녀\s?(계획|가\s?있))' then '연애·결혼·출산'
    when q ~ '(부모님\s?(의\s?)?(직업|뭐\s?하|무슨\s?일)|(아버지|아버님|어머니|어머님)(는|께서|의)?\s?(직업|뭐\s?하|무슨\s?일)|가족\s?(관계|소개|구성)|집안\s?(형편|환경|사정)|형제\s?관계|재산(?!권)|자가(인가|예요|야|에\s?사)|집이\s?자가|호구\s?조사)' then '가족 배경·재산'
    when q ~ '(몸무게|체중(이|은|이\s?얼마|\s?관리)|키(가|는|와)\s?(몇|어떻게|얼마)|외모\s?관리|화장(은|을)?\s?평소|문신|살\s?(좀\s?)?빼)' then '외모·신체'
    when q ~ '(종교(가|는|를|\s?있)|교회\s?다니|성당\s?다니|절에\s?다니|지지(하는)?\s?정당|정치\s?(성향|적\s?성향)|어느\s?정당)' then '종교·정치'
    when q ~ '(고향|어디\s?(사세요|살아|사시|살고)|집이\s?어디|사는\s?곳|거주지|출신\s?지역|지방대(라서|인데)|연고지)' then '출신지역·거주지·학벌'
    when q ~ '(몇\s?살|나이가\s?많은데|늦은\s?나이|나이가\s?어떻게|나이는\s?어떻게)' then '나이'
    when q ~ '(아픈\s?곳|아픈곳|건강\s?상태|건강은\s?괜찮|건강한지|질병이\s?있|지병|병력|장애가\s?있|장애\s?여부|정신과)' then '건강·장애'
    when q ~ '(주량|(^|[\s(,/])술(을|은)?\s?(잘|좋아|얼마|자주|마시|드시)|음주|흡연\s?(을|은|이|하|여부|자|시간|가능|구역)|담배\s?(는|를)?\s?(피우|피워|피세|피시|피는|피느|피냐|피나|끊|태우))' then '음주·흡연'
    when q ~ '((여자|여성)(인데|라서|이라서|로서\s?이\s?일)|(남자|남성)(인데|라서|이라서)|군대|병역|군\s?복무|전역|군필|미필|군\s?제대|제대\s?(후|했|하고|하셨|한))' then '성별·병역'
    else null end;
$$;

-- 질문은행에서 새로 걸리는 질문 표시 (이미 표시된 것은 그대로)
update public.qb_questions
   set blocked = public.qb_block_reason(coalesce(question, '') || ' / ' || coalesce(rep, ''))
 where blocked is null
   and public.qb_block_reason(coalesce(question, '') || ' / ' || coalesce(rep, '')) is not null;

-- 면접 기출: 금지 질문 + 직장 경력 전제 질문은 빼고 줌
create or replace function public.ic_target_json(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'target', jsonb_build_object('key', g.key, 'name', g.name, 'category', g.category, 'priority', g.priority,
              'interview_process', g.interview_process, 'recruit_method', g.recruit_method, 'recent_posting', g.recent_posting,
              'verify_status', g.verify_status),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('seq', j.seq, 'division', j.division, 'job_group', j.job_group, 'job_detail', j.job_detail) order by j.seq)
                      from public.interview_target_job j where j.target_key = g.key), '[]'::jsonb),
    'past', coalesce((select jsonb_agg(jsonb_build_object('no', q.orig_no, 'question', q.question, 'year', q.year, 'half', q.half,
                                                          'job_category', q.job_category) order by q.year desc, q.half desc nulls last, q.orig_no)
                      from public.interview_past_question q where q.target_key = g.key
                        and public.qb_block_reason(q.question) is null
                        and q.question !~ '(이직|전\s?직장|이전\s?직장)'), '[]'::jsonb))
  from public.interview_target g where g.key = p_key;
$$;
