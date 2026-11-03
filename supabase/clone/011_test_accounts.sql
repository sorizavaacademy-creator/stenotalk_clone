-- 2026-11-03 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 010_career_inbody.sql 다음에 실행
--
-- 테스트 계정 표시: 관리 화면에 '테스트' 배지를 달고, '테스트 계정 빼고 보기'로 통계에서 뺄 수 있게 함
-- 테스트 데이터는 seed/test_students.sql로 넣고, seed/remove_test_accounts.sql로 한 번에 지움

alter table public.profiles add column if not exists is_test boolean not null default false;
