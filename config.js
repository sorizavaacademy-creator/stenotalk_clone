// 클론(stenotalk_clone) 전용 DB 연결 정보 — Supabase 프로젝트 ZAVAPASS-clone
// 로컬·GitHub 주소로 열 때 이 파일을 씀. Vercel 배포 때는 scripts/build.mjs가
// 환경 변수 VITE_SUPABASE_URL·VITE_SUPABASE_ANON_KEY로 이 파일을 새로 만듦.
// 운영 ZAVAPASS DB 값은 절대 넣지 말 것 (index.html이 연결을 막음).
window.ZAVAPASS_ENV = {
  VITE_SUPABASE_URL: 'https://yiuraowvnadqdrnysdce.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpdXJhb3d2bmFkcWRybnlzZGNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1NzkwODIsImV4cCI6MjEwOTE1NTA4Mn0.JdrsonuieY4OVxwNv23hrphsaxICLycWRRuPGhFfq5A'
};
