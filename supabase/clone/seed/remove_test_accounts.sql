-- 2026-11-03 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 테스트 계정(profiles.is_test = true)과 그 계정의 기록·답변·인바디·서류·준비 기록·상담 메모·의견을 모두 지움
-- (auth.users를 지우면 profiles와 학생 기록 표가 함께 지워짐. 테스트 계정이 남긴 상담 메모·권한 기록도 지움)
-- 지우기 전에 몇 개인지 먼저 확인:  select count(*) from public.profiles where is_test;

delete from public.staff_notes where author_id in (select id from public.profiles where is_test);
delete from public.role_log where user_id in (select id from public.profiles where is_test);
delete from public.feedback where user_id in (select id from public.profiles where is_test);
delete from auth.users where id in (select id from public.profiles where is_test);
