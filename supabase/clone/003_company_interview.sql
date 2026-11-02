-- 2026-11-02 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용: 회사별 면접 자료
-- 원본: 회사별_면접자료_20261102.xlsx — 면접 전형(공식) 581곳 · 예상 질문(자체 작성) 704곳×6문항 · 공식 정보 제공 현황 704곳
-- 회사 키는 회사명이 아니라 ID(company_talent.id)로 함
--   · 회사명이 겹치는 곳이 있음 (카카오 G1-15·G2-49, 에쓰-오일(S-OIL) G1-25·G2-47)
--   · G5-043은 인재상 엑셀 v3에 옛 이름(강릉원주대학교치과병원)으로 있음. 대학 통합으로 강원대학교치과병원이 됐고 인재상 DB 이름도 바꿈(2026-11-02)
-- 데이터는 scripts/import_company_interview.py로 엑셀에서 INSERT 문을 만들어 넣음
-- 001_profiles.sql, 002_company_talent.sql 다음에 실행. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
--
-- 쓸 때 지킬 것 (엑셀 '보고 요약')
--  · 면접 전형은 공식 출처의 사실 정보지만 공고·직무·연도마다 바뀜 → 화면에 '기준 공고·공고일'을 함께 보여 줌
--  · 예상 질문은 자체 작성한 연습용 질문이고 실제 기출이 아님 → 화면·AI 답변 어디에서도 '기출'·'실제로 묻는 질문'이라고 하지 않음
--  · provide_level '미제공'이면 전형을 지어내지 않고 일반 면접 방식으로 진행

-- 회사 1곳당 1줄: 공식 정보 제공 현황(704곳) + 면접 전형(공식, 581곳은 값이 있고 '미제공' 123곳은 비어 있음)
create table if not exists public.company_interview_process (
  company_id text primary key references public.company_talent(id) on delete cascade,
  sheet_name text not null,                   -- 면접 자료 엑셀에 적힌 회사명 (인재상 엑셀과 다를 수 있어 따로 둠)
  provide_level text not null check (provide_level in ('제공','일부 제공','미제공')),
  provide_reason text,                        -- 사유 (미제공·일부 제공)
  checked_url text,                           -- 확인한 채용사이트·공고
  stages text,                                -- 전형 단계 (예: 서류 → 인적성 → 직무 면접 → 종합 면접)
  interview_types text[] not null default '{}', -- 면접 유형 (인성, 직무PT, 토론, AI역량검사, 상황(SJT) …)
  detail text,                                -- 면접 세부(요약)
  base_posting text,                          -- 기준 공고
  posted_month text,                          -- 공고일 (YYYY-MM, 없을 수 있음)
  source_type text,                           -- 출처 유형 (공식 채용사이트 / 공식 공고게시판 / 2차 출처(공고 전재) …)
  source_url text,
  note text,                                  -- 비고
  group_common boolean not null default false,   -- 출처 유형에 '(그룹 공통 절차)' → 계열사 고유 전형으로 단정하지 않음
  secondary_source boolean not null default false, -- 2차 출처(공고 전재)
  data_date date not null default '2026-11-02',
  updated_at timestamptz not null default now()
);

-- 회사마다 6문항
create table if not exists public.company_interview_question (
  company_id text not null references public.company_talent(id) on delete cascade,
  seq smallint not null check (seq between 1 and 6),
  question text not null,                     -- 예상 질문 (자체 작성)
  linked_talent text,                         -- 연결 인재상 (근거 키워드 원문)
  eval_point text,                            -- 평가포인트 (면접관이 확인하려는 행동)
  basis text not null check (basis in ('회사 인재상','업종 공통(인재상 미확보)')),
  data_date date not null default '2026-11-02',
  updated_at timestamptz not null default now(),
  primary key (company_id, seq)
);

alter table public.company_interview_process enable row level security;
alter table public.company_interview_question enable row level security;

create policy "company_interview_process: 로그인하면 읽기" on public.company_interview_process for select to authenticated using (true);
create policy "company_interview_process: 관리자 쓰기" on public.company_interview_process for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "company_interview_question: 로그인하면 읽기" on public.company_interview_question for select to authenticated using (true);
create policy "company_interview_question: 관리자 쓰기" on public.company_interview_question for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 회사 하나를 고르면 ① 인재상 ② 공식 면접 전형 ③ 예상 질문·평가포인트를 한 번에 돌려줌
-- security invoker(기본값)라 부른 사람의 RLS가 그대로 적용됨 → 로그인한 사람만 읽힘
create or replace function public.get_company_pack(p_id text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'talent', to_jsonb(t) - 'updated_at',
    'process', (select to_jsonb(p) - 'updated_at' - 'company_id' from public.company_interview_process p where p.company_id = t.id),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('seq', q.seq, 'question', q.question, 'linked_talent', q.linked_talent,
                                                              'eval_point', q.eval_point, 'basis', q.basis) order by q.seq)
                           from public.company_interview_question q where q.company_id = t.id), '[]'::jsonb))
  from public.company_talent t where t.id = p_id;
$$;
revoke all on function public.get_company_pack(text) from public, anon;
grant execute on function public.get_company_pack(text) to authenticated;
