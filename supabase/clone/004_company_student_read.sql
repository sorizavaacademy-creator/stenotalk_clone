-- 2026-11-02 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용: 면접자가 읽는 회사 자료를 화면에 필요한 칸으로 좁힘
-- 003_company_interview.sql 다음에 실행. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
--
-- 바꾸는 것
--  · 표 4개(company_talent, company_talent_excluded, company_interview_process, company_interview_question)를 직접 읽는 건 관리자만
--  · 면접자는 아래 함수 두 개로만 읽음 (출처 링크·비고·점검 사유·제공 사유 같은 내부 메모는 빠짐)
--      list_companies()      : 회사 검색용 목록 (ID·이름·구분·확인상태)
--      get_company_pack(id)  : 고른 회사의 인재상·공식 전형·예상 질문 (AI 면접관 Edge Function도 이 함수를 씀)

drop policy if exists "company_talent: 로그인하면 읽기" on public.company_talent;
drop policy if exists "company_talent_excluded: 로그인하면 읽기" on public.company_talent_excluded;
drop policy if exists "company_interview_process: 로그인하면 읽기" on public.company_interview_process;
drop policy if exists "company_interview_question: 로그인하면 읽기" on public.company_interview_question;
-- 관리자 쓰기 정책(for all)이 관리자 읽기도 함께 허용함

create or replace function public.list_companies() returns table (id text, name text, category text, category_order integer, no integer, verify_status text, reference_only boolean)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.category, t.category_order, t.no, t.verify_status, t.reference_only
  from public.company_talent t
  where auth.uid() is not null
  order by t.category_order, t.no;
$$;
revoke all on function public.list_companies() from public, anon;
grant execute on function public.list_companies() to authenticated;

create or replace function public.get_company_pack(p_id text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'talent', jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category, 'talent_type', t.talent_type,
               'keywords', t.keywords, 'keyword_meanings', t.keyword_meanings, 'summary', t.summary, 'themes', t.themes,
               'verify_status', t.verify_status, 'reference_only', t.reference_only, 'merge_planned', t.merge_planned),
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
