-- 2026-11-05 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 한림대 모의면접 DB (엑셀 '한림대_모의면접_DB_프로그램용.xlsx' 7개 시트)
--   기업목록 → qb_companies · 질문은행 → qb_questions
--   평가_공통기준 → qb_eval_axes·qb_eval_grades·qb_rules · 평가_가중치 → qb_eval_weights · 평가_유형별기준 → qb_rules
--   AI피드백규칙·AI면접관안전장치 → qb_rules
--   작은 시트 5개는 원본 줄도 qb_sheet_rows에 그대로 남김 (다시 풀어 볼 수 있게)
-- 판(ver): 엑셀을 올릴 때마다 새 판으로 넣고 검사 → '바꾸기'를 해야 학생 화면·AI가 새 판을 씀. 바로 전 판은 되돌리기용으로 남김
-- 학생은 질문 원문·AI 규칙을 읽을 수 없음 (관리자만). 출제·다듬기·채점은 서버 함수가 함

-- ── 지금 쓰는 판 ──
create or replace function public.qb_active_ver() returns integer
language sql stable security definer set search_path = public as $$
  select nullif(value->>'active', '')::int from public.app_settings where key = 'qbank';
$$;

-- ── 표 ──
create table if not exists public.qb_imports (
  ver integer primary key,
  file_name text,
  status text not null default 'loading',   -- loading(넣는 중) · checked(검사 통과) · problem(검사 실패) · active(사용 중) · old(지난 판)
  counts jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  activated_at timestamptz
);
create table if not exists public.qb_companies (
  ver integer not null, key text not null, name text not null, grp text, priority integer,
  review_count integer, q_count integer, recent_count integer,
  primary key (ver, key)
);
create table if not exists public.qb_questions (
  ver integer not null, id text not null,
  company_key text, company text, grp text, priority integer, job text, rank text, year integer,
  recency text, weight numeric, difficulty text, result text, stage text, qtype text,
  question text, rep text, has_followup boolean, freq_company integer, freq_total integer,
  rep_key text,        -- 대표 질문에서 띄어쓰기·문장부호를 뺀 비교용 글 ("같은 대표 질문은 한 번만")
  blocked text,        -- 금지 분류 낱말에 걸리면 그 분류 이름 (출제하지 않음). null이면 출제 가능
  primary key (ver, id)
);
create index if not exists qb_questions_co on public.qb_questions (ver, company_key, qtype);
create index if not exists qb_questions_grp on public.qb_questions (ver, grp, job, qtype);
create index if not exists qb_questions_type on public.qb_questions (ver, qtype, rep_key);
create table if not exists public.qb_eval_axes (
  ver integer not null, axis text not null, name text, looks text, s4 text, s3 text, s2 text, s1 text,
  primary key (ver, axis)
);
create table if not exists public.qb_eval_weights (
  ver integer not null, qtype text not null, a integer, b integer, c integer, d integer, e integer, total integer,
  key_point text, q_count integer,
  primary key (ver, qtype)
);
create table if not exists public.qb_eval_grades (
  ver integer not null, grade text not null, min_score numeric not null, ord integer,
  primary key (ver, grade)
);
create table if not exists public.qb_rules (
  ver integer not null, sheet text not null, ord integer not null,
  kind text,           -- 아래 qb_parse_rules 참고 (type_rule·step·ban·rule·example·directive·banned_category·…)
  section text, label text, content text, extra text,
  for_prompt boolean not null default true,   -- false = 사람이 보는 참고(법 근거·검수 목록). AI 설정에 넣지 않음
  primary key (ver, sheet, ord)
);
create table if not exists public.qb_sheet_rows (
  ver integer not null, sheet text not null, row_no integer not null, cells jsonb,
  primary key (ver, sheet, row_no)
);
-- 사이트의 기관 704곳(company_talent)과 엑셀 기업키 잇기. exact/loose는 바꾸기 때 이름으로 다시 만들고, manual은 그대로 둠
create table if not exists public.qb_company_links (
  talent_id text not null, company_key text not null, how text not null default 'manual',
  primary key (talent_id, company_key)
);
-- 처음 한 번 넣을 때만 쓰는 임시 열쇠 (해시만 저장, 짧게 쓰고 지움). 평소에는 관리자 로그인으로만 넣음
create table if not exists public.qb_import_tokens (token_hash text primary key, expires_at timestamptz not null);

-- ── 읽기 권한 ──
alter table public.qb_imports enable row level security;
alter table public.qb_companies enable row level security;
alter table public.qb_questions enable row level security;
alter table public.qb_eval_axes enable row level security;
alter table public.qb_eval_weights enable row level security;
alter table public.qb_eval_grades enable row level security;
alter table public.qb_rules enable row level security;
alter table public.qb_sheet_rows enable row level security;
alter table public.qb_company_links enable row level security;
alter table public.qb_import_tokens enable row level security;
drop policy if exists "관리자 읽기" on public.qb_imports;      create policy "관리자 읽기" on public.qb_imports for select to authenticated using (public.is_admin());
drop policy if exists "관리자 읽기" on public.qb_questions;    create policy "관리자 읽기" on public.qb_questions for select to authenticated using (public.is_admin());
drop policy if exists "관리자 읽기" on public.qb_rules;        create policy "관리자 읽기" on public.qb_rules for select to authenticated using (public.is_admin());
drop policy if exists "관리자 읽기" on public.qb_sheet_rows;   create policy "관리자 읽기" on public.qb_sheet_rows for select to authenticated using (public.is_admin());
-- 기업 이름·구분, 평가 항목·가중치·등급은 학생 화면에서도 씀 (지금 쓰는 판만)
drop policy if exists "사용 중인 판" on public.qb_companies;    create policy "사용 중인 판" on public.qb_companies for select to authenticated using (ver = public.qb_active_ver() or public.is_admin());
drop policy if exists "사용 중인 판" on public.qb_eval_axes;    create policy "사용 중인 판" on public.qb_eval_axes for select to authenticated using (ver = public.qb_active_ver() or public.is_admin());
drop policy if exists "사용 중인 판" on public.qb_eval_weights; create policy "사용 중인 판" on public.qb_eval_weights for select to authenticated using (ver = public.qb_active_ver() or public.is_admin());
drop policy if exists "사용 중인 판" on public.qb_eval_grades;  create policy "사용 중인 판" on public.qb_eval_grades for select to authenticated using (ver = public.qb_active_ver() or public.is_admin());
drop policy if exists "모두 읽기" on public.qb_company_links;   create policy "모두 읽기" on public.qb_company_links for select to authenticated using (true);
-- 쓰기 정책은 두지 않음: 아래 함수(관리자 확인)로만 넣고 바꿈

-- ── 도우미 ──
create or replace function public.qb_int(t text) returns integer language sql immutable as $$
  select case when t ~ '^\s*-?\d+(\.0+)?\s*$' then round(t::numeric)::int else null end;
$$;
create or replace function public.qb_num(t text) returns numeric language sql immutable as $$
  select case when t ~ '^\s*-?\d+(\.\d+)?\s*$' then t::numeric else null end;
$$;
create or replace function public.qb_rep_key(t text) returns text language sql immutable as $$
  select nullif(lower(regexp_replace(coalesce(t, ''), '[^가-힣A-Za-z0-9]', '', 'g')), '');
$$;
-- AI면접관안전장치 2번 '절대 묻지 않는 질문 9개 분류' 낱말 검사 (허용되는 사회 이슈·직장 상황·전공 지식 질문은 걸리지 않게 좁게 잡음)
create or replace function public.qb_block_reason(q text) returns text language sql immutable as $$
  select case
    when q ~ '(여자\s?친구|남자\s?친구|이성\s?친구|(^|[^장])애인|연애\s?(경험|하|중)|결혼\s?(계획|했|하셨|여부|하면|할\s?생각|은\s?언제|할\s?건)|기혼|미혼|출산\s?(계획|하면)|아이는\s?언제|자녀\s?(계획|가\s?있))' then '연애·결혼·출산'
    when q ~ '(부모님\s?(의\s?)?(직업|뭐\s?하|무슨\s?일)|(아버지|아버님|어머니|어머님)(는|께서|의)?\s?(직업|뭐\s?하|무슨\s?일)|가족\s?(관계|소개|구성)|집안\s?(형편|환경|사정)|형제\s?관계|재산(?!권)|자가(인가|예요|야|에\s?사)|집이\s?자가|호구\s?조사)' then '가족 배경·재산'
    when q ~ '(몸무게|체중(이|은|이\s?얼마|\s?관리)|키(가|는|와)\s?(몇|어떻게|얼마)|외모\s?관리|화장(은|을)?\s?평소|문신|살\s?(좀\s?)?빼)' then '외모·신체'
    when q ~ '(종교(가|는|를|\s?있)|교회\s?다니|성당\s?다니|절에\s?다니|지지(하는)?\s?정당|정치\s?(성향|적\s?성향)|어느\s?정당)' then '종교·정치'
    when q ~ '(고향|어디\s?(사세요|살아|사시|살고)|집이\s?어디|사는\s?곳|거주지|출신\s?지역|지방대(라서|인데))' then '출신지역·거주지·학벌'
    when q ~ '(몇\s?살|나이가\s?많은데|늦은\s?나이|나이가\s?어떻게|나이는\s?어떻게)' then '나이'
    when q ~ '(아픈\s?곳|아픈곳|건강\s?상태|건강은\s?괜찮|건강한지|질병이\s?있|지병|병력|장애가\s?있|장애\s?여부|정신과)' then '건강·장애'
    when q ~ '(주량|(^|[\s(,/])술(을|은)?\s?(잘|좋아|얼마|자주|마시|드시)|음주|흡연(을|하|여부|자)|담배\s?(피우|피워|피세|피시|피는))' then '음주·흡연'
    when q ~ '((여자|여성)(인데|라서|이라서|로서\s?이\s?일)|(남자|남성)(인데|라서|이라서)|군대|병역|군\s?복무|전역|군필|미필|군\s?제대|제대\s?(후|했|하고|하셨|한))' then '성별·병역'
    else null end;
$$;

create or replace function public.qb_can_import(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (p_token is not null and exists (
    select 1 from public.qb_import_tokens t where t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and t.expires_at > now()));
$$;

-- ── 1) 새 판 시작 ──
create or replace function public.qb_import_begin(p_file text, p_token text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  if not public.qb_can_import(p_token) then raise exception '관리자만 할 수 있어요' using errcode = '42501'; end if;
  select coalesce(max(ver), 0) + 1 into v from public.qb_imports;
  insert into public.qb_imports (ver, file_name, status, created_by) values (v, left(coalesce(p_file, ''), 200), 'loading', auth.uid());
  return v;
end $$;

-- ── 2) 줄 넣기 (여러 번 나눠 부름). p_header = 시트 머리글, p_rows = 줄 배열
--    질문은행·기업목록: 줄 = 칸 배열 (머리글 이름으로 칸을 찾음 → 엑셀 칸 순서가 바뀌어도 됨)
--    나머지 5개 시트: 줄 = [엑셀 줄 번호, 칸1, 칸2, …]
create or replace function public.qb_import_rows(p_ver integer, p_sheet text, p_header jsonb, p_rows jsonb, p_token text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare h jsonb := '{}'::jsonb; i integer; n integer := 0;
begin
  if not public.qb_can_import(p_token) then raise exception '관리자만 할 수 있어요' using errcode = '42501'; end if;
  if not exists (select 1 from public.qb_imports where ver = p_ver and status in ('loading', 'problem')) then raise exception '이미 끝난 판이에요 (%판)', p_ver; end if;
  if jsonb_typeof(p_header) = 'array' then
    for i in 0 .. jsonb_array_length(p_header) - 1 loop h := h || jsonb_build_object(trim(coalesce(p_header->>i, '')), i); end loop;
  end if;
  if p_sheet = '질문은행' then
    if not (h ? '질문ID' and h ? '질문 유형' and h ? '질문' and h ? '대표 질문' and h ? '출제 가중치') then raise exception '질문은행 머리글이 달라요: %', p_header; end if;
    insert into public.qb_questions (ver, id, company_key, company, grp, priority, job, rank, year, recency, weight, difficulty, result, stage, qtype, question, rep, has_followup, freq_company, freq_total, rep_key, blocked)
    select p_ver, r->>(h->>'질문ID')::int, r->>(h->>'기업키')::int, r->>(h->>'기업')::int, r->>(h->>'구분')::int, qb_int(r->>(h->>'우선순위')::int),
           r->>(h->>'직종')::int, r->>(h->>'직급')::int, qb_int(r->>(h->>'연도')::int), r->>(h->>'최신성 등급')::int, qb_num(r->>(h->>'출제 가중치')::int),
           r->>(h->>'난이도')::int, r->>(h->>'면접 결과')::int, r->>(h->>'면접 단계')::int, trim(r->>(h->>'질문 유형')::int), r->>(h->>'질문')::int, r->>(h->>'대표 질문')::int,
           upper(coalesce(r->>(h->>'꼬리질문 포함')::int, '')) = 'Y', qb_int(r->>(h->>'기업 내 빈도')::int), qb_int(r->>(h->>'전체 빈도')::int),
           qb_rep_key(coalesce(r->>(h->>'대표 질문')::int, r->>(h->>'질문')::int)),
           qb_block_reason(coalesce(r->>(h->>'질문')::int, '') || ' / ' || coalesce(r->>(h->>'대표 질문')::int, ''))
      from jsonb_array_elements(p_rows) r
     where coalesce(r->>(h->>'질문ID')::int, '') <> ''
    on conflict (ver, id) do nothing;
    get diagnostics n = row_count;
  elsif p_sheet = '기업목록' then
    if not (h ? '기업키' and h ? '기업') then raise exception '기업목록 머리글이 달라요: %', p_header; end if;
    insert into public.qb_companies (ver, key, name, grp, priority, review_count, q_count, recent_count)
    select p_ver, trim(r->>(h->>'기업키')::int), trim(r->>(h->>'기업')::int), r->>(h->>'구분')::int, qb_int(r->>(h->>'우선순위')::int),
           qb_int(r->>(h->>'원본 수집 후기 수')::int), qb_int(r->>(h->>'질문 수')::int), qb_int(r->>(h->>'최신·최근 질문 수')::int)
      from jsonb_array_elements(p_rows) r
     where coalesce(trim(r->>(h->>'기업키')::int), '') <> ''
    on conflict (ver, key) do nothing;
    get diagnostics n = row_count;
    -- 합계 줄(기업키 없음)은 검사용으로 원본 줄에 남김
    insert into public.qb_sheet_rows (ver, sheet, row_no, cells)
    select p_ver, '기업목록:합계', 0, r from jsonb_array_elements(p_rows) r
     where coalesce(trim(r->>(h->>'기업키')::int), '') = '' and r->>(h->>'기업')::int = '합계'
    on conflict (ver, sheet, row_no) do update set cells = excluded.cells;
  elsif p_sheet in ('평가_공통기준', '평가_가중치', '평가_유형별기준', 'AI피드백규칙', 'AI면접관안전장치') then
    insert into public.qb_sheet_rows (ver, sheet, row_no, cells)
    select p_ver, p_sheet, (r->>0)::int, r - 0 from jsonb_array_elements(p_rows) r
    on conflict (ver, sheet, row_no) do update set cells = excluded.cells;
    get diagnostics n = row_count;
  else
    raise exception '모르는 시트예요: %', p_sheet;
  end if;
  return n;
end $$;

-- ── 3) 작은 시트 풀기: qb_sheet_rows → 평가 항목·가중치·등급·규칙 ──
create or replace function public.qb_parse_rules(p_ver integer) returns void
language plpgsql security definer set search_path = public as $$
declare r record; c0 text; c1 text; c2 text; sec text; ord integer := 0; mode text; k text; fp boolean;
begin
  delete from public.qb_eval_axes where ver = p_ver; delete from public.qb_eval_weights where ver = p_ver;
  delete from public.qb_eval_grades where ver = p_ver; delete from public.qb_rules where ver = p_ver;
  -- 평가_가중치
  insert into public.qb_eval_weights (ver, qtype, a, b, c, d, e, total, key_point, q_count)
  select p_ver, trim(cells->>0), qb_int(cells->>1), qb_int(cells->>2), qb_int(cells->>3), qb_int(cells->>4), qb_int(cells->>5), qb_int(cells->>6), cells->>7, qb_int(cells->>8)
    from public.qb_sheet_rows where ver = p_ver and sheet = '평가_가중치' and qb_int(cells->>6) is not null and coalesce(cells->>0, '') <> '';
  -- 평가_공통기준: A~E 항목, 등급, 총점 계산식·권장 답변 길이 같은 안내
  mode := null;
  for r in select row_no, cells from public.qb_sheet_rows where ver = p_ver and sheet = '평가_공통기준' order by row_no loop
    c0 := trim(r.cells->>0); c1 := trim(r.cells->>1);
    if c0 ~ '^[A-E]\.' then
      insert into public.qb_eval_axes values (p_ver, left(c0, 1), trim(regexp_replace(c0, '^[A-E]\.\s*', '')), c1, r.cells->>2, r.cells->>3, r.cells->>4, r.cells->>5);
    elsif c0 = '등급' and c1 = '최소 점수' then mode := 'grade';
    elsif mode = 'grade' and qb_num(c1) is not null then
      ord := ord + 1; insert into public.qb_eval_grades values (p_ver, c0, qb_num(c1), ord);
    else
      if c1 is null and c0 is not null and c0 !~ '[.=]' and length(c0) < 20 then mode := null; end if;
      if c0 = '항목' then continue; end if;
      insert into public.qb_rules (ver, sheet, ord, kind, section, label, content)
      values (p_ver, '평가_공통기준', r.row_no, case when c0 = '•' then 'length' when c0 like '총점 =%' then 'formula' when c1 is null then 'heading' else 'note' end,
              null, case when c0 = '•' then null else c0 end, coalesce(c1, c0));
    end if;
  end loop;
  -- 평가_유형별기준
  insert into public.qb_rules (ver, sheet, ord, kind, section, label, content)
  select p_ver, '평가_유형별기준', row_no, 'type_rule', trim(cells->>0), trim(cells->>1), cells->>2
    from public.qb_sheet_rows where ver = p_ver and sheet = '평가_유형별기준' and coalesce(cells->>0, '') not in ('', '질문 유형') and cells->>2 is not null;
  -- AI피드백규칙
  sec := null;
  for r in select row_no, cells from public.qb_sheet_rows where ver = p_ver and sheet = 'AI피드백규칙' order by row_no loop
    c0 := trim(r.cells->>0); c1 := r.cells->>1;
    if c1 is null then
      if r.row_no > 2 then sec := c0; end if;
      insert into public.qb_rules (ver, sheet, ord, kind, section, content, for_prompt) values (p_ver, 'AI피드백규칙', r.row_no, case when r.row_no <= 2 then 'intro' else 'heading' end, sec, c0, true);
      continue;
    end if;
    if c0 in ('단계', '확인') then continue; end if;
    k := case when c0 ~ '^\d\.\s' then 'step' when c0 = '금지' then 'ban' when c0 = '규칙' then 'rule'
              when c0 = '점수 보정 방법' then 'calibration' when sec = '피드백 예시' then 'example' when sec = '전문가 검수 체크리스트' then 'checklist' else 'note' end;
    insert into public.qb_rules (ver, sheet, ord, kind, section, label, content, for_prompt)
    values (p_ver, 'AI피드백규칙', r.row_no, k, sec, nullif(c0, ''), c1, k not in ('checklist', 'calibration'));
  end loop;
  -- AI면접관안전장치: 1~8번은 AI 설정에 넣는 지시문, '참고'는 사람용
  sec := null; fp := true;
  for r in select row_no, cells from public.qb_sheet_rows where ver = p_ver and sheet = 'AI면접관안전장치' order by row_no loop
    c0 := trim(r.cells->>0); c1 := r.cells->>1; c2 := r.cells->>2;
    if c1 is null and c2 is null then
      if c0 ~ '^\d\.\s' then sec := c0; fp := true; elsif c0 like '참고%' then sec := c0; fp := false; end if;
      insert into public.qb_rules (ver, sheet, ord, kind, section, content, for_prompt)
      values (p_ver, 'AI면접관안전장치', r.row_no, case when r.row_no <= 2 then 'intro' else 'heading' end, sec, c0, r.row_no > 2 and fp);
      continue;
    end if;
    if c0 = '분류' then continue; end if;
    k := case when c0 = '•' then 'directive' when sec like '2.%' then 'banned_category' else 'note' end;
    insert into public.qb_rules (ver, sheet, ord, kind, section, label, content, extra, for_prompt)
    values (p_ver, 'AI면접관안전장치', r.row_no, k, sec, case when c0 = '•' then null else c0 end, c1, c2, fp);
  end loop;
end $$;

-- ── 4) 검사: 숫자가 맞는지 확인하고 결과를 남김 ──
create or replace function public.qb_import_check(p_ver integer, p_token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb; probs text[] := '{}'; nq integer; nc integer; nco integer; ntypes integer; total_row jsonb; sheet_total integer;
        bad_w jsonb; nax integer; ngr integer; ndir integer; ncat integer; nsteps integer; nbans integer; ntr integer; types jsonb; v_blocked jsonb; mism jsonb; noq jsonb; nw integer;
begin
  if not public.qb_can_import(p_token) then raise exception '관리자만 할 수 있어요' using errcode = '42501'; end if;
  perform public.qb_parse_rules(p_ver);
  select count(*) into nq from public.qb_questions where ver = p_ver;
  select count(*) into nc from public.qb_companies where ver = p_ver;
  select count(distinct company_key) into nco from public.qb_questions where ver = p_ver;
  select count(*), jsonb_object_agg(qtype, n) into ntypes, types
    from (select qtype, count(*) n from public.qb_questions where ver = p_ver group by qtype) t;
  select cells into total_row from public.qb_sheet_rows where ver = p_ver and sheet = '기업목록:합계';
  -- 기업목록 합계 줄의 '질문 수'는 6번째 칸(0부터 세면 5)
  sheet_total := coalesce(qb_int(total_row->>5), (select sum(q_count) from public.qb_companies where ver = p_ver)::int);
  select coalesce(jsonb_agg(jsonb_build_object('유형', qtype, '합계', coalesce(a,0)+coalesce(b,0)+coalesce(c,0)+coalesce(d,0)+coalesce(e,0))), '[]'::jsonb) into bad_w
    from public.qb_eval_weights where ver = p_ver and coalesce(a,0)+coalesce(b,0)+coalesce(c,0)+coalesce(d,0)+coalesce(e,0) <> 100;
  select count(*) into nw from public.qb_eval_weights where ver = p_ver;
  select count(*) into nax from public.qb_eval_axes where ver = p_ver;
  select count(*) into ngr from public.qb_eval_grades where ver = p_ver;
  select count(*) into ndir from public.qb_rules where ver = p_ver and sheet = 'AI면접관안전장치' and for_prompt and kind = 'directive';
  select count(*) into ncat from public.qb_rules where ver = p_ver and sheet = 'AI면접관안전장치' and kind = 'banned_category';
  select count(*) into nsteps from public.qb_rules where ver = p_ver and sheet = 'AI피드백규칙' and kind = 'step';
  select count(*) into nbans from public.qb_rules where ver = p_ver and sheet = 'AI피드백규칙' and kind = 'ban';
  select count(*) into ntr from public.qb_rules where ver = p_ver and sheet = '평가_유형별기준';
  select coalesce(jsonb_object_agg(b, n), '{}'::jsonb) into v_blocked from (select q.blocked b, count(*) n from public.qb_questions q where q.ver = p_ver and q.blocked is not null group by q.blocked) t;
  select coalesce(jsonb_agg(jsonb_build_object('기업', c.name, '목록', c.q_count, '실제', coalesce(q.n, 0))), '[]'::jsonb) into mism
    from public.qb_companies c left join (select company_key, count(*) n from public.qb_questions where ver = p_ver group by company_key) q on q.company_key = c.key
   where c.ver = p_ver and coalesce(c.q_count, 0) <> coalesce(q.n, 0);
  select coalesce(jsonb_agg(c.name), '[]'::jsonb) into noq from public.qb_companies c where c.ver = p_ver and not exists (select 1 from public.qb_questions q where q.ver = p_ver and q.company_key = c.key);

  if nq = 0 then probs := probs || '질문이 하나도 없어요'::text; end if;
  if nq <> sheet_total then probs := probs || format('질문 수 %s개가 기업목록 합계 %s개와 달라요', nq, sheet_total); end if;
  if nc = 0 then probs := probs || '기업이 하나도 없어요'::text; end if;
  if nw <> ntypes then probs := probs || format('평가_가중치 유형 수(%s)가 질문 유형 수(%s)와 달라요', nw, ntypes); end if;
  if exists (select 1 from (select distinct qtype from public.qb_questions where ver = p_ver) t where not exists (select 1 from public.qb_eval_weights w where w.ver = p_ver and w.qtype = t.qtype)) then
    probs := probs || '가중치가 없는 질문 유형이 있어요'::text; end if;
  if jsonb_array_length(bad_w) > 0 then probs := probs || ('가중치 합계가 100이 아닌 줄이 있어요: ' || bad_w::text); end if;
  if nax <> 5 then probs := probs || format('평가 항목이 %s개예요 (A~E 5개여야 해요)', nax); end if;
  if ngr = 0 then probs := probs || '등급 기준이 없어요'::text; end if;
  if ndir = 0 then probs := probs || 'AI 면접관 지시문이 없어요'::text; end if;
  if ncat <> 9 then probs := probs || format('금지 질문 분류가 %s개예요 (9개여야 해요)', ncat); end if;
  if nsteps <> 5 then probs := probs || format('피드백 단계가 %s개예요 (5단계여야 해요)', nsteps); end if;
  if jsonb_array_length(mism) > 0 then probs := probs || format('기업목록의 질문 수와 실제 질문 수가 다른 기업이 %s곳 있어요', jsonb_array_length(mism)); end if;

  res := jsonb_build_object('질문', nq, '기업목록_합계', sheet_total, '기업', nc, '질문있는_기업', nco, '질문없는_기업', noq, '질문_유형_수', ntypes, '유형별_질문', types,
    '가중치_줄', nw, '가중치_합계_틀린_줄', bad_w, '평가_항목', nax, '등급', ngr,
    '유형별기준_줄', ntr, '피드백_단계', nsteps, '피드백_금지', nbans, '면접관_지시문', ndir, '금지_분류', ncat,
    '출제_안함_금지낱말', v_blocked, '출제_안함_기타유형', coalesce((types->>'기타')::int, 0), '질문수_다른_기업', mism, '문제', to_jsonb(probs));
  update public.qb_imports set counts = res, status = case when cardinality(probs) = 0 then 'checked' else 'problem' end where ver = p_ver;
  return res;
end $$;

-- ── 5) 바꾸기: 검사를 통과한 판을 '사용 중'으로. 기관 704곳과의 연결도 이름으로 다시 만듦 ──
create or replace function public.qb_import_activate(p_ver integer, p_token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur integer := public.qb_active_ver(); n_ex integer; n_lo integer;
begin
  if not public.qb_can_import(p_token) then raise exception '관리자만 할 수 있어요' using errcode = '42501'; end if;
  if not exists (select 1 from public.qb_imports where ver = p_ver and status in ('checked', 'old', 'active')) then raise exception '검사를 통과한 판만 바꿀 수 있어요'; end if;
  insert into public.app_settings (key, value, updated_at) values ('qbank', jsonb_build_object('active', p_ver, 'prev', case when cur = p_ver then null else cur end, 'at', now()), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  update public.qb_imports set status = 'old' where status = 'active' and ver <> p_ver;
  update public.qb_imports set status = 'active', activated_at = now() where ver = p_ver;
  delete from public.qb_company_links where how in ('exact', 'loose');
  insert into public.qb_company_links (talent_id, company_key, how)
  select t.id, c.key, 'exact' from public.qb_companies c join public.company_talent t on t.name = c.name where c.ver = p_ver
  on conflict do nothing;
  get diagnostics n_ex = row_count;
  insert into public.qb_company_links (talent_id, company_key, how)
  select t.id, c.key, 'loose' from public.qb_companies c join public.company_talent t
      on replace(t.name, ' ', '') = replace(regexp_replace(c.name, '\s*\(.*\)$', ''), ' ', '')
      or replace(regexp_replace(t.name, '\s*\(.*\)$', ''), ' ', '') = replace(regexp_replace(c.name, '\s*\(.*\)$', ''), ' ', '')
   where c.ver = p_ver and not exists (select 1 from public.qb_company_links l where l.company_key = c.key)
  on conflict do nothing;
  get diagnostics n_lo = row_count;
  return jsonb_build_object('사용_중', p_ver, '바로_전', cur, '이름_같은_연결', n_ex, '비슷한_이름_연결', n_lo,
    '연결_없는_기업', (select coalesce(jsonb_agg(c.name), '[]'::jsonb) from public.qb_companies c where c.ver = p_ver and not exists (select 1 from public.qb_company_links l where l.company_key = c.key)));
end $$;

-- ── 6) 되돌리기: 바로 전 판으로 ──
create or replace function public.qb_import_rollback(p_token text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev integer := (select nullif(value->>'prev', '')::int from public.app_settings where key = 'qbank');
begin
  if not public.qb_can_import(p_token) then raise exception '관리자만 할 수 있어요' using errcode = '42501'; end if;
  if prev is null or not exists (select 1 from public.qb_questions where ver = prev limit 1) then raise exception '되돌릴 판이 없어요'; end if;
  return public.qb_import_activate(prev, p_token);
end $$;

-- ── 7) 정리: 사용 중·바로 전·넣는 중인 판 말고는 지움 (한 번에 p_limit줄씩, 0이 나올 때까지 부름) ──
create or replace function public.qb_import_purge(p_token text default null, p_limit integer default 20000) returns integer
language plpgsql security definer set search_path = public as $$
declare keep integer[]; n integer := 0; m integer;
begin
  if not public.qb_can_import(p_token) then raise exception '관리자만 할 수 있어요' using errcode = '42501'; end if;
  select array_agg(v) into keep from (
    select public.qb_active_ver() v union select nullif(value->>'prev', '')::int from public.app_settings where key = 'qbank'
    union select ver from public.qb_imports where status in ('loading', 'checked', 'problem') and created_at > now() - interval '1 day') t where v is not null;
  keep := coalesce(keep, '{}');
  delete from public.qb_questions where ctid in (select ctid from public.qb_questions where not (ver = any(keep)) limit p_limit);
  get diagnostics m = row_count; n := n + m;
  if m < p_limit then
    delete from public.qb_companies where not (ver = any(keep)); get diagnostics m = row_count; n := n + m;
    delete from public.qb_sheet_rows where not (ver = any(keep)); get diagnostics m = row_count; n := n + m;
    delete from public.qb_rules where not (ver = any(keep)); get diagnostics m = row_count; n := n + m;
    delete from public.qb_eval_axes where not (ver = any(keep)); delete from public.qb_eval_weights where not (ver = any(keep)); delete from public.qb_eval_grades where not (ver = any(keep));
    update public.qb_imports set status = 'deleted' where not (ver = any(keep)) and status <> 'deleted';
  end if;
  return n;
end $$;

revoke all on function public.qb_import_begin(text, text) from public, anon;
revoke all on function public.qb_import_rows(integer, text, jsonb, jsonb, text) from public, anon;
revoke all on function public.qb_import_check(integer, text) from public, anon;
revoke all on function public.qb_import_activate(integer, text) from public, anon;
revoke all on function public.qb_import_rollback(text) from public, anon;
revoke all on function public.qb_import_purge(text, integer) from public, anon;
revoke all on function public.qb_parse_rules(integer) from public, anon, authenticated;
revoke all on function public.qb_can_import(text) from public, anon;
grant execute on function public.qb_import_begin(text, text) to authenticated;
grant execute on function public.qb_import_rows(integer, text, jsonb, jsonb, text) to authenticated;
grant execute on function public.qb_import_check(integer, text) to authenticated;
grant execute on function public.qb_import_activate(integer, text) to authenticated;
grant execute on function public.qb_import_rollback(text) to authenticated;
grant execute on function public.qb_import_purge(text, integer) to authenticated;
grant execute on function public.qb_active_ver() to authenticated;

-- 이름이 달라 자동으로 이어지지 않는 8곳 (엑셀 기업키 → 사이트 기관 목록 id). 바꾸기를 해도 지워지지 않음
insert into public.qb_company_links (talent_id, company_key, how) values
  ('G2-37', 'SS08', 'manual'),   -- 삼성SDS = 삼성에스디에스
  ('G2-75', 'LG05', 'manual'),   -- LG CNS = LG씨엔에스
  ('G2-74', 'SS12', 'manual'),   -- 삼성바이오에피스 = 삼성에피스홀딩스(삼성바이오에피스)
  ('G1-25', 'TR03', 'manual'),   -- S-OIL = 에쓰-오일(S-OIL) (대기업 그룹)
  ('G2-47', 'TR03', 'manual'),   -- S-OIL = 에쓰-오일(S-OIL) (시가총액 상위)
  ('G2-65', 'FN10', 'manual'),   -- 한국투자증권 = 한국금융지주(한국투자증권)
  ('G2-14', 'FN02', 'manual'),   -- 신한은행 → 신한지주 (목록에 은행이 따로 없음)
  ('G2-18', 'FN03', 'manual'),   -- 하나은행 → 하나금융지주
  ('G2-25', 'FN04', 'manual'),   -- 우리은행 → 우리금융지주
  ('G1-09', 'FN05', 'manual'),   -- NH농협 → 농협(NH농협)
  ('G8-02', 'FN05', 'manual'),   -- NH농협 → NH농협은행
  ('G1-07', 'PO01', 'manual'),   -- 포스코 → 포스코그룹
  ('G2-28', 'PO01', 'manual'),   -- 포스코 → POSCO홀딩스
  ('G2-27', 'FN07', 'manual'),   -- 메리츠 → 메리츠금융지주
  ('G8-16', 'FN07', 'manual')    -- 메리츠 → 메리츠증권
on conflict do nothing;
