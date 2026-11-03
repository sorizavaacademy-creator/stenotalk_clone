-- 2026-11-03 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 004_company_student_read.sql, 005_student_activity.sql 다음에 실행
--
-- 1) prep_state: 학생이 면접 준비 창에 입력한 것 (다른 기기·새로고침 뒤에도 남게)
--    experiences : 직접 입력한 경험 [{id,type,text}]
--    prep        : 질문 미리 연습 기록 {"<회사ID 또는 분야>": {"<질문 키>": {memo, done, best}}}
--    profile     : 학년 등 면접 준비 창 기본값 {grade}
-- 2) get_company_pack: 회사 카드에 '자료 확인 중'을 보여 주려고 needs_review(점검 필요 여부)만 더함 (점검 사유는 여전히 주지 않음)

create table if not exists public.prep_state (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  experiences jsonb not null default '[]'::jsonb,
  prep jsonb not null default '{}'::jsonb,
  profile jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.prep_state enable row level security;
create policy "prep_state: 본인 전체" on public.prep_state for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "prep_state: 관리자 읽기" on public.prep_state for select to authenticated using (public.is_admin());

create or replace function public.get_company_pack(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'talent', jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category, 'talent_type', t.talent_type,
               'keywords', t.keywords, 'keyword_meanings', t.keyword_meanings, 'summary', t.summary, 'themes', t.themes,
               'verify_status', t.verify_status, 'reference_only', t.reference_only, 'merge_planned', t.merge_planned,
               'needs_review', t.needs_review),
    'process', (select jsonb_build_object('provide_level', p.provide_level, 'stages', p.stages, 'interview_types', p.interview_types,
               'detail', p.detail, 'base_posting', p.base_posting, 'posted_month', p.posted_month,
               'group_common', p.group_common, 'secondary_source', p.secondary_source)
               from public.company_interview_process p where p.company_id = t.id),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('seq', q.seq, 'question', q.question, 'linked_talent', q.linked_talent,
                                                              'eval_point', q.eval_point, 'basis', q.basis) order by q.seq)
                           from public.company_interview_question q where q.company_id = t.id), '[]'::jsonb))
  from public.company_talent t
  where t.id = p_id and auth.uid() is not null;
$$;
revoke all on function public.get_company_pack(text) from public, anon;
grant execute on function public.get_company_pack(text) to authenticated;
