# stenotalk_clone 작업 규칙

이 레포는 운영 중인 ZAVAPASS(원본 레포 `sorizavaacademy-creator/stenotalk`)의 연습·개발용 복사본입니다.

## 반드시 지킬 것

1. 모든 기능 추가·수정·테스트는 이 레포(`sorizavaacademy-creator/stenotalk_clone`)에서만 합니다. 코드 수정, 커밋, 푸시도 이 레포에만 합니다.
2. 원본 레포 `sorizavaacademy-creator/stenotalk`에는 읽기 외에 어떤 변경도 하지 않습니다 (커밋, 푸시, 브랜치, PR, 이슈 모두 금지).
3. 운영 Supabase 프로젝트 **ZAVAPASS (`aqkukxcjcbfxqfesmuva`)** 에는 쓰기를 하지 않습니다. SQL 실행, 마이그레이션, Edge Function 배포, 시크릿 변경, 데이터 수정 모두 금지입니다.
4. DB 작업과 테스트는 클론 Supabase 프로젝트 **ZAVAPASS-clone (`yiuraowvnadqdrnysdce`)** 에서만 합니다.
5. 수정한 뒤에는 캡처나 변경 내용을 먼저 사용자에게 보여 주고, 사용자가 커밋·푸시하라고 할 때만 커밋·푸시합니다.
6. `main` 브랜치 합치기(PR)는 묻지 않습니다. 작업 브랜치에만 푸시합니다.

## 연결 정보

- 앱은 `config.js`의 `window.ZAVAPASS_ENV`에서 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 읽습니다. 코드에 주소나 키를 직접 쓰지 않습니다.
- Vercel 배포는 `vercel.json` → `node scripts/build.mjs`로 `dist/`를 만들고, 환경 변수로 `dist/config.js`를 씁니다.
- `index.html`과 `scripts/build.mjs` 모두 운영 프로젝트 ref가 보이면 연결·빌드를 멈춥니다. 이 막는 장치를 지우거나 우회하지 않습니다.
