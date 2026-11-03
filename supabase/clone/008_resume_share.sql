-- 2026-11-03 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 007_roles.sql 다음에 실행
--
-- 학생이 '학교 교직원과 서류 함께 보기'를 켠 경우에만 교직원·학과 담당이 자기소개서·이력서를 읽을 수 있게 함
--   share_staff    : 학생 동의 여부 (기본 꺼짐)
--   share_staff_at : 동의한 때 (끄면 비움)
-- 관리자는 005의 '관리자 읽기' 그대로. 교직원·학과 담당은 동의한 학생 + 볼 수 있는 학생(can_see_user)만, 읽기만

alter table public.user_resumes
  add column if not exists share_staff boolean not null default false,
  add column if not exists share_staff_at timestamptz;

drop policy if exists "user_resumes: 교직원 읽기 (학생 동의)" on public.user_resumes;
create policy "user_resumes: 교직원 읽기 (학생 동의)" on public.user_resumes for select to authenticated
  using (share_staff and public.is_school_staff() and public.can_see_user(user_id));
