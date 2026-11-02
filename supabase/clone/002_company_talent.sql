-- 2026-11-02 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용: 회사별 인재상 데이터
-- 원본: 회사별 인재상 데이터베이스 엑셀(기준일 2026-11-02, v3) — 본문 9개 시트 704곳 + 제외·보류 명단 47건
-- 데이터는 scripts/import_company_talent.py로 엑셀에서 INSERT 문을 만들어 넣음
-- 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
--
-- 질문 생성에 쓸 때 지킬 것 (한림대 UI/UX 지시서 '데이터·연동 기준')
--  · 회사 ID와 회사명이 맞는지 확인하고, 비슷한 회사·그룹으로 바꿔 쓰지 않음
--  · verify_status '미확인'이거나 keywords가 비어 있으면 일반·직무 질문으로 대신함
--  · '부분확인'은 그룹 공통·2차 출처일 수 있어 그 회사 고유 기준으로 단정하지 않음
--  · needs_review(엑셀 '점검필요' 탭)·reference_only(시총 101~200위·코스닥 참고용)·merge_planned(통폐합 예정)는 화면에서 구분

create table if not exists public.company_talent (
  id text primary key,                         -- 엑셀 ID (예: G1-01)
  category text not null,                      -- 엑셀 시트 이름 (대기업 그룹, 공기업 …)
  category_order integer not null,             -- 시트 순서 1~9
  no integer,                                  -- 시트 안 번호
  name text not null,                          -- 회사·기관명 (공식 표기)
  talent_type text,                            -- 인재상 유형 (회사가 게시한 이름 그대로)
  keywords text[] not null default '{}',       -- 키워드 (원문 표기)
  keyword_meanings text[] not null default '{}', -- 키워드별 뜻 (자체 작성)
  summary text,                                -- 한 줄 요약 (자체 작성)
  themes text[] not null default '{}',         -- 주요 테마 (도전, 창의·혁신 …)
  verify_status text not null check (verify_status in ('확인','부분확인','미확인')),
  source_url text,
  note text,                                   -- 비고
  reference_only boolean not null default false, -- 시총 101~200위·코스닥 (별도 참고용)
  merge_planned boolean not null default false,  -- 비고에 [통폐합 예정]
  needs_review boolean not null default false,   -- 엑셀 '점검필요' 탭에 있음
  review_reason text,                            -- 점검 사유
  data_date date not null default '2026-11-02',
  updated_at timestamptz not null default now()
);
create index if not exists company_talent_name_idx on public.company_talent (name);
create index if not exists company_talent_cat_idx on public.company_talent (category_order, no);

create table if not exists public.company_talent_excluded (
  no integer primary key,
  original_category text,
  name text not null,
  action text not null,       -- 제외 / 중복 제외 / 보류(데이터 유지) / 통폐합 예정(데이터 유지) / 탭 이동 / 이름 수정 / 값 수정
  reason text,
  evidence_url text,
  data_date date not null default '2026-11-02'
);

alter table public.company_talent enable row level security;
alter table public.company_talent_excluded enable row level security;

-- 로그인한 사람은 읽기만, 고치기는 관리자만 (public.is_admin()은 001_profiles.sql)
create policy "company_talent: 로그인하면 읽기" on public.company_talent for select to authenticated using (true);
create policy "company_talent: 관리자 쓰기" on public.company_talent for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "company_talent_excluded: 로그인하면 읽기" on public.company_talent_excluded for select to authenticated using (true);
create policy "company_talent_excluded: 관리자 쓰기" on public.company_talent_excluded for all to authenticated using (public.is_admin()) with check (public.is_admin());
