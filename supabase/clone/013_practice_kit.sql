-- 2026-11-04 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 학생 연습 도구 4가지
--   ① 이 질문 다시 답하기   → answer_retries (다시 답한 답변·점수·피드백)
--   ② AI가 고친 답변 보기    → answer_rewrites (같은 답변은 다시 만들지 않게 저장)
--   ③ 면접 D-day 준비        → interview_plans (면접 날짜·기업·전날 점검표)
--   ④ 내 질문 모음           → question_bookmarks (별표한 질문)
-- 모두 본인 것만 쓰고 읽음. 교직원·학과 담당·관리자는 볼 수 있는 학생 것만 읽기(can_see_user).

create table if not exists public.question_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question text not null check (char_length(question) between 2 and 500),
  ref text,                       -- 모범답안 요지(있으면)
  field_id text,
  company_id text,
  company_name text,
  source text,                    -- result | record | practice | dday
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (user_id, question)
);
create index if not exists question_bookmarks_user_idx on public.question_bookmarks (user_id, created_at desc);

create table if not exists public.answer_retries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  record_id uuid references public.interview_records(id) on delete set null,
  question text not null check (char_length(question) <= 500),
  prev_answer text,
  prev_score integer,
  answer text not null check (char_length(answer) <= 4000),
  score integer check (score between 0 and 100),
  feedback text,
  axes jsonb,                     -- { 내용, 구조, 구체성, 분량, 태도·언어 }
  graded_by text,                 -- ai | local
  created_at timestamptz not null default now()
);
create index if not exists answer_retries_user_idx on public.answer_retries (user_id, created_at desc);

create table if not exists public.answer_rewrites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  akey text not null,             -- 질문+답변으로 만든 키 (같은 답변이면 다시 만들지 않음)
  question text,
  answer text,
  rewrite text not null,
  points jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, akey)
);

create table if not exists public.interview_plans (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  target_date date not null,
  company_id text,
  company_name text,
  field_id text,
  job text check (job is null or char_length(job) <= 60),
  format text,                    -- 대면 | 화상 | 모름
  checklist jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.question_bookmarks enable row level security;
alter table public.answer_retries enable row level security;
alter table public.answer_rewrites enable row level security;
alter table public.interview_plans enable row level security;

do $$ declare t text; begin
  foreach t in array array['question_bookmarks','answer_retries','answer_rewrites','interview_plans'] loop
    execute format('drop policy if exists "%1$s: 본인" on public.%1$s', t);
    execute format('create policy "%1$s: 본인" on public.%1$s for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "%1$s: 교직원 읽기" on public.%1$s', t);
    execute format('create policy "%1$s: 교직원 읽기" on public.%1$s for select to authenticated using (public.can_see_user(user_id))', t);
  end loop;
end $$;
