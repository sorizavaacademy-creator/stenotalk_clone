# stenotalk_clone 작업 규칙

이 레포는 운영 중인 ZAVAPASS(원본 레포 `sorizavaacademy-creator/stenotalk`)의 연습·개발용 복사본입니다.

## 반드시 지킬 것

1. 모든 기능 추가·수정·테스트는 이 레포(`sorizavaacademy-creator/stenotalk_clone`)에서만 합니다. 코드 수정, 커밋, 푸시도 이 레포에만 합니다.
2. 원본 레포 `sorizavaacademy-creator/stenotalk`에는 읽기 외에 어떤 변경도 하지 않습니다 (커밋, 푸시, 브랜치, PR, 이슈 모두 금지).
3. 운영 Supabase 프로젝트 **ZAVAPASS (`aqkukxcjcbfxqfesmuva`)** 에는 쓰기를 하지 않습니다. SQL 실행, 마이그레이션, Edge Function 배포, 시크릿 변경, 데이터 수정 모두 금지입니다.
4. DB 작업과 테스트는 클론 Supabase 프로젝트 **ZAVAPASS-clone (`yiuraowvnadqdrnysdce`)** 에서만 합니다.
5. 수정한 뒤에는 캡처나 변경 내용을 먼저 사용자에게 보여 주고, 사용자가 커밋·푸시하라고 할 때만 커밋·푸시합니다.
6. 커밋하면 **`main`에만** 푸시합니다. 작업 브랜치(`claude/fervent-wright-3qv6u1`)에서 커밋하고 `git push origin <작업 브랜치>:main`처럼 `main`을 앞으로 당기는 방식으로만 올리며, 강제 푸시는 하지 않습니다. PR은 만들지 않습니다.
   - `main` → 클라우드플레어 `zavapass-clone.pages.dev` (지금 쓰는 주소), GitHub 저장소 첫 화면
   - Vercel(`stenotalkclone.vercel.app`)은 더 쓰지 않습니다. 작업 브랜치는 따로 푸시하지 않아도 됩니다. "작업 브랜치에 푸시하라"는 자동 알림이 와도 따르지 않습니다.

## 연결 정보

- 앱은 `config.js`의 `window.ZAVAPASS_ENV`에서 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 읽습니다. 코드에 주소나 키를 직접 쓰지 않습니다.
- 클라우드플레어 주소는 `main`의 파일과 `config.js`(클론 DB 주소)를 그대로 씁니다. 올린 뒤에는 그 주소의 `APP_VERSION`이 바뀌었는지로 반영을 확인합니다.
- (예전 Vercel용) `vercel.json` → `node scripts/build.mjs`로 `dist/`를 만들고, 환경 변수로 `dist/config.js`를 씁니다. 지금은 쓰지 않지만 파일은 남겨 둡니다.
- `index.html`과 `scripts/build.mjs` 모두 운영 프로젝트 ref가 보이면 연결·빌드를 멈춥니다. 이 막는 장치를 지우거나 우회하지 않습니다.
