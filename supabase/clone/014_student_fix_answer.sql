-- 2026-11-04 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 학생이 결과 화면에서 "받아쓴 말 고치기"로 자기 답변을 고치고 다시 채점한 결과를 저장
--   · 본인 기록만 (interview_records.user_id = auth.uid())
--   · 처음 받아 적은 글은 answer_raw에 한 번만 남김 (관리자가 원래 글을 볼 수 있게), answer_fixed_at에 고친 시각
--   · 기록의 종합 점수도 화면에서 다시 계산한 값으로 바꿈
create or replace function public.student_fix_answer(p_record uuid, p_index integer, p_text text, p_score integer, p_feedback text, p_record_score integer default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not exists (select 1 from public.interview_records r where r.id = p_record and r.user_id = auth.uid()) then
    raise exception 'not your record' using errcode = '42501';
  end if;
  update public.interview_answers a
     set answer_raw = coalesce(a.answer_raw, a.answer_text),
         answer_text = left(coalesce(p_text, ''), 4000),
         answer_fixed_at = now(),
         score = case when p_score is null then a.score else least(100, greatest(0, p_score)) end,
         feedback = case when p_feedback is null then a.feedback else left(p_feedback, 6000) end
   where a.record_id = p_record and a.question_index = p_index;
  get diagnostics n = row_count;
  if n > 0 and p_record_score is not null then
    update public.interview_records set score = least(100, greatest(0, p_record_score)) where id = p_record;
  end if;
  return n;
end $$;
revoke all on function public.student_fix_answer(uuid, integer, text, integer, text, integer) from public, anon;
grant execute on function public.student_fix_answer(uuid, integer, text, integer, text, integer) to authenticated;
