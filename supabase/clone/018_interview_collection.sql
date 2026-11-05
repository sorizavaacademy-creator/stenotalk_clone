-- 2026-11-04 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용: 면접 자료 수집 대상 · 채용 직무 · 2024·2025 실제 면접 기출
-- (015~017은 한림대 모의면접 DB qb_* 표. 이 파일의 표 이름과 겹치지 않음)
-- 원본 1: 면접 자료 수집 대상·채용 직무 엑셀(작성 2026-11-02, 파일명 끝 1103)
--   '수집 대상 목록'(141곳: 대기업 97 · 공기업 30 · 공무원 14) · '채용 직무'(1,104줄) · '공무원 직렬'(확인상태만 가져옴) · '인재상DB 대조'(148건)
-- 원본 2: 2024·2025 면접 기출 엑셀(확인 2026-11-04) — 48곳 282문항
-- 데이터는 scripts/import_interview_collection.py로 엑셀에서 INSERT 문을 만들어 넣음
-- 002_company_talent.sql 다음에 실행. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
--
-- 정한 것
--  · 수집 대상은 자체 Key(SS01, PB01, GV01 …)로 구분. 인재상 DB의 여러 ID가 한 대상으로 묶이기도 해서(예: 삼성그룹 G1-01 → 삼성전자 SS01)
--    연결은 interview_target_talent에 따로 둠. 공무원 14곳은 인재상 DB에 없어 연결이 없음
--  · 작업용 시트('안내'·'현황'·'면접 기출 수집' 진행표·빈 '기출 문항 입력')는 넣지 않음
--  · 기출의 출처(출처 URL·출처 사이트·다시 확인하는 방법)는 넣지 않음 (2026-11-04 요청)
--  · 기출 질문은 후기를 요약한 문장이고, 48곳의 일부 후기만 모은 것 (전체 수집 아님)
--  · 이미 있는 company_interview_question(자체 작성 예상 질문)과는 다른 표. 둘을 섞지 않음
--  · 앱 화면에는 아직 쓰지 않음 → 네 표 모두 관리자만 읽고 씀

-- 수집 대상: 회사(기관) 1곳당 1줄
create table if not exists public.interview_target (
  key text primary key,                        -- SS01 형식 (대기업 SS·SK·HY…, 공기업 PB, 공무원 GV)
  no smallint not null,                        -- 엑셀 No (우선순위 → 구분 순 정렬)
  priority smallint not null check (priority between 1 and 3),
  category text not null check (category in ('대기업','공기업','공무원')),
  name text not null,                          -- 수집 대상 (예: 삼성전자, NH농협(농협은행·농협중앙회), 국가직 9급 공채)
  group_memo text,                             -- 정리 메모 (인재상 DB 행을 어떻게 묶었는지)
  recruit_channel text,                        -- 채용 채널
  recruit_method text,                         -- 채용 방식
  recent_posting text,                         -- 최근 공고
  interview_process text,                      -- 면접 전형 (조사값)
  research_memo text,                          -- 조사 메모
  job_count smallint not null default 0,       -- 채용 직무 수 (= interview_target_job 줄 수)
  verify_status text not null check (verify_status in ('확인','부분확인','미확인')),
  posting_source text,                         -- 채용 공고를 확인한 곳 (엑셀 '출처', 줄바꿈으로 여러 개)
  original_checked text,                       -- 원문 대조
  original_changes text,                       -- 원문 대조 변경 내용
  login_required text,                         -- 로그인 필요
  data_date date not null default '2026-11-02',
  updated_at timestamptz not null default now()
);

-- 인재상 DB ID → 수집 대상 (148건). 인재상 1곳은 수집 대상 1곳에만 묶임
create table if not exists public.interview_target_talent (
  talent_id text primary key references public.company_talent(id) on delete cascade,
  target_key text not null references public.interview_target(key) on delete cascade,
  reason text,                                 -- 묶은 이유
  updated_at timestamptz not null default now()
);
create index if not exists interview_target_talent_target_idx on public.interview_target_talent(target_key);

-- 채용 직무: 수집 대상 → 부문·채용구분 → 직무군·직렬 → 세부 직무·직류 (1,104줄)
create table if not exists public.interview_target_job (
  target_key text not null references public.interview_target(key) on delete cascade,
  seq smallint not null,                       -- 대상 안에서 엑셀 순서 (1부터)
  division text,                               -- 부문·채용구분 (공무원은 급수·채용 구분)
  job_group text,                              -- 직무군·직렬
  job_detail text,                             -- 세부 직무·직류
  note text,                                   -- 비고 (근무지, 공무원은 인원·과목 등)
  verify_status text check (verify_status in ('확인','부분확인','미확인')), -- 공무원 직렬만 있음
  data_date date not null default '2026-11-02',
  updated_at timestamptz not null default now(),
  primary key (target_key, seq)
);

-- 2024·2025 실제 면접 기출 (282문항, 후기 요약)
create table if not exists public.interview_past_question (
  orig_no integer primary key,                 -- 원본 번호 (기존 수집본 번호)
  target_key text not null references public.interview_target(key) on delete cascade,
  question text not null,                      -- 질문 요약
  year smallint not null check (year between 2000 and 2100),
  half text check (half in ('상반기','하반기')),
  job_category text,                           -- 직무 (후기 사이트의 원문 구분, 예: 경영/사무 · 연구개발/설계)
  review_company text,                         -- 후기에 표시된 기업 (수집 대상과 다를 수 있음: SK ↔ SK(주), 농협은행 ↔ NH농협)
  employment_type text,                        -- 고용형태 (지금은 모두 신입)
  note text,                                   -- 범위·주의사항
  data_date date not null default '2026-11-04',
  updated_at timestamptz not null default now()
);
create index if not exists interview_past_question_target_idx on public.interview_past_question(target_key);

alter table public.interview_target enable row level security;
alter table public.interview_target_talent enable row level security;
alter table public.interview_target_job enable row level security;
alter table public.interview_past_question enable row level security;

drop policy if exists "interview_target: 관리자만" on public.interview_target;
drop policy if exists "interview_target_talent: 관리자만" on public.interview_target_talent;
drop policy if exists "interview_target_job: 관리자만" on public.interview_target_job;
drop policy if exists "interview_past_question: 관리자만" on public.interview_past_question;
create policy "interview_target: 관리자만" on public.interview_target for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "interview_target_talent: 관리자만" on public.interview_target_talent for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "interview_target_job: 관리자만" on public.interview_target_job for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "interview_past_question: 관리자만" on public.interview_past_question for all to authenticated using (public.is_admin()) with check (public.is_admin());
