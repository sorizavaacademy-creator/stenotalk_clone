-- 2026-11-05 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 018_interview_collection.sql 다음에 실행. 015_interview_db.sql의 qb_can_import()(관리자 또는 임시 열쇠)를 씀
--
-- 1) 넣기: ic_import_reset() → ic_import(표, 줄 배열)를 여러 번 (scripts/import_interview_collection.py --json 결과)
--    관리자 로그인 또는 짧게 쓰는 임시 열쇠(qb_import_tokens)로만 됨. 넣을 수 있는 표는 018의 표 4개뿐
-- 2) 쓰기: get_company_pack(회사 ID)에 아래 세 가지를 더함 (학생 화면이 이 함수로 읽음)
--      target : 이 회사가 묶인 수집 대상 (이름·구분·면접 전형(조사값)·채용 방식·최근 공고). 출처·메모·원문 대조 칸은 빼고 줌
--      jobs   : 채용 직무 (부문 → 직무군 → 세부 직무)
--      past   : 2024·2025 면접 기출 (질문 요약·연도·상하반기·직무 구분). 출처는 DB에도 없음
--    공무원 시험 구분 14곳은 회사 ID가 없어 get_gov_collection()으로 따로 읽음

create or replace function public.ic_import_reset(p_token text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.qb_can_import(p_token) then raise exception '관리자만 할 수 있어요' using errcode = '42501'; end if;
  delete from public.interview_past_question where true;
  delete from public.interview_target_job where true;
  delete from public.interview_target_talent where true;
  delete from public.interview_target where true;
end $$;

create or replace function public.ic_import(p_table text, p_rows jsonb, p_token text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.qb_can_import(p_token) then raise exception '관리자만 할 수 있어요' using errcode = '42501'; end if;
  if p_table = 'interview_target' then
    insert into public.interview_target (key, no, priority, category, name, group_memo, recruit_channel, recruit_method, recent_posting,
      interview_process, research_memo, job_count, verify_status, posting_source, original_checked, original_changes, login_required)
    select key, no, priority, category, name, group_memo, recruit_channel, recruit_method, recent_posting,
      interview_process, research_memo, job_count, verify_status, posting_source, original_checked, original_changes, login_required
    from jsonb_populate_recordset(null::public.interview_target, p_rows);
  elsif p_table = 'interview_target_talent' then
    insert into public.interview_target_talent (talent_id, target_key, reason)
    select talent_id, target_key, reason from jsonb_populate_recordset(null::public.interview_target_talent, p_rows);
  elsif p_table = 'interview_target_job' then
    insert into public.interview_target_job (target_key, seq, division, job_group, job_detail, note, verify_status)
    select target_key, seq, division, job_group, job_detail, note, verify_status from jsonb_populate_recordset(null::public.interview_target_job, p_rows);
  elsif p_table = 'interview_past_question' then
    insert into public.interview_past_question (orig_no, target_key, question, year, half, job_category, review_company, employment_type, note)
    select orig_no, target_key, question, year, half, job_category, review_company, employment_type, note
    from jsonb_populate_recordset(null::public.interview_past_question, p_rows);
  else
    raise exception '넣을 수 없는 표: %', p_table;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ic_import_reset(text) from public;
revoke all on function public.ic_import(text, jsonb, text) from public;
grant execute on function public.ic_import_reset(text) to anon, authenticated;
grant execute on function public.ic_import(text, jsonb, text) to anon, authenticated;

-- 회사 1곳의 수집 대상·채용 직무·기출 (get_company_pack과 공무원 함수가 같이 씀)
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
                      from public.interview_past_question q where q.target_key = g.key), '[]'::jsonb))
  from public.interview_target g where g.key = p_key;
$$;
revoke all on function public.ic_target_json(text) from public, anon, authenticated;

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
                           from public.company_interview_question q where q.company_id = t.id), '[]'::jsonb),
    'collection', (select public.ic_target_json(l.target_key) from public.interview_target_talent l where l.talent_id = t.id))
  from public.company_talent t
  where t.id = p_id and auth.uid() is not null;
$$;
revoke all on function public.get_company_pack(text) from public, anon;
grant execute on function public.get_company_pack(text) to authenticated;

-- 공무원 시험 구분 14곳 (회사 ID 없음): 목록과 각 구분의 직렬·기출
create or replace function public.get_gov_collection() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public.ic_target_json(g.key) order by g.no), '[]'::jsonb)
  from public.interview_target g where g.category = '공무원' and auth.uid() is not null;
$$;
revoke all on function public.get_gov_collection() from public, anon;
grant execute on function public.get_gov_collection() to authenticated;
