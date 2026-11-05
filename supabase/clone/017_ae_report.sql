-- 2026-11-05 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 면접 DB 5단계: 면접 기록에 A~E 종합 리포트(항목별 평균·총점·등급·가장 약한 항목·다음 연습 유형)를 함께 저장
alter table public.interview_records add column if not exists ae_report jsonb;
comment on column public.interview_records.ae_report is 'A~E 종합 리포트 {n, avg:{A..E}, total, grade, weakest, types[]} (면접 DB 채점 기준)';
-- 학생 화면이 사용 중인 판 번호를 알 수 있게 (관리자는 모든 판을 읽을 수 있어서 판 번호로 걸러야 함)
grant execute on function public.qb_active_ver() to authenticated;
