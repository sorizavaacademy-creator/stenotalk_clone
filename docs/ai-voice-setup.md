# AI 면접관·타입캐스트 목소리 연결 안내 (클론 전용)

이 문서는 **클론 Supabase 프로젝트 ZAVAPASS-clone (`yiuraowvnadqdrnysdce`)** 에 AI 면접관(꼬리질문·채점·종합 의견)과
타입캐스트 면접관 목소리를 붙이는 순서입니다. 운영 프로젝트 ZAVAPASS(`aqkukxcjcbfxqfesmuva`)에는 아무것도 배포하거나 바꾸지 않습니다.

## 지금 준비된 것

| 항목 | 위치 | 상태 |
|---|---|---|
| 서버 함수 9개 코드 | `supabase/functions/<이름>/index.ts` | 운영에서 **읽기만** 해서 옮겨 둠. 속기사용 프롬프트는 한림대 대학생 채용 면접용으로 바꿈 |
| 회사 맞춤 프롬프트 조각 | `supabase/functions/_shared/company_prompt.ts` | 기업·직무 맞춤 면접이면 회사 인재상·평가포인트를 AI에게 함께 줌 |
| 함수가 쓰는 DB 표·함수·저장소 | `supabase/clone/012_ai_voice.sql` | 클론 DB에 적용 (AI 사용 횟수, 목소리 사용량, 질문 녹음 저장소 등) |
| 앱이 보내는 면접 맥락 | `index.html` `aiCtx()` | 면접관(persona), 회사(company_id), 목적, 직무, 전공을 함께 보냄 |
| 면접관 10명 목소리 화면 | 관리자 › AI·비용 › 면접관 10명 목소리 | 면접관마다 타입캐스트 목소리·속도·높낮이·감정 지정 (009) |
| 연결 점검 | 같은 화면 아래 '연결 점검' | 함수 배포 여부 · 키 여부를 버튼 하나로 확인 |

## 필요한 키

| 이름 | 어디에 쓰나 | 필수 |
|---|---|---|
| `OPENAI_API_KEY` | AI 꼬리질문·채점·종합 의견·자기소개 코치, OpenAI 목소리 | 필수 |
| `TYPECAST_API_KEY` | 타입캐스트 면접관 목소리·목록·미리 듣기 | 타입캐스트를 쓸 때 |
| `OPENAI_ADMIN_KEY` | 관리자 화면의 OpenAI 비용 보기 (`sk-admin-…`) | 선택 |
| `OPENAI_MODEL` | 채팅 모델 바꾸기 (기본값은 함수 코드에 있음) | 선택 |
| `OPENAI_TTS_MODEL` | OpenAI 목소리 모델 바꾸기 (기본 `gpt-4o-mini-tts`) | 선택 |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase가 함수에 자동으로 넣어 주므로 따로 넣지 않습니다.
키는 **채팅이나 코드에 붙여 넣지 말고** Supabase 대시보드에서 직접 넣어 주세요.

## 순서

1. **DB 준비** — 클론 DB에 `supabase/clone/012_ai_voice.sql` 적용 (이미 적용했으면 건너뜀).
2. **키 넣기** — Supabase 대시보드 → 프로젝트 **ZAVAPASS-clone** → Edge Functions → Secrets 에서 위 표의 키를 추가.
   (명령줄로 할 때: `supabase secrets set --project-ref yiuraowvnadqdrnysdce OPENAI_API_KEY=… TYPECAST_API_KEY=…`)
3. **함수 배포** — 저장소 최상위에서, 반드시 클론 프로젝트로:
   ```
   for f in followup-question grade-answer set-review intro-coach speak-text typecast-tts generate-audio openai-costs admin-set-password; do
     supabase functions deploy "$f" --project-ref yiuraowvnadqdrnysdce --no-verify-jwt
   done
   ```
   운영과 같이 JWT 확인은 함수 안에서 직접 하므로 `--no-verify-jwt`로 배포합니다. `--project-ref`를 빼거나 다른 값을 넣지 마세요.
4. **연결 점검** — 관리자 화면 › AI·비용 › 면접관 10명 목소리 › 연결 점검
   - `점검 (배포 여부)`: 9개 모두 '배포됨'이 나와야 함 (크레딧 안 듦)
   - `실제로 불러 보기`: 타입캐스트 목록, AI 꼬리질문, 면접관 목소리를 한 번씩 진짜로 불러 봄 (크레딧 조금). '정상 동작' 또는 '키 없음'으로 원인이 보임
5. **켜기**
   - 관리자 화면 › AI·비용 › AI 켜기 · 횟수 에서 AI 꼬리질문·AI 채점 켜기, 1인당 횟수 정하기
   - `index.html`의 `const DEMO_TTS_SERVER = false;` 를 `true`로 바꾸고 배포 → 면접 중 면접관 목소리를 서버(타입캐스트/OpenAI)로 읽음.
     꺼 두면 지금처럼 면접관마다 다른 브라우저 목소리로 읽음
6. **면접관 목소리 고르기** — 면접관 10명 목소리 화면에서 실제 타입캐스트 목록으로 다시 고르고 '저장하고 적용' (예시 목록으로 골라 둔 것은 실제 목소리로 바꿔야 함).
7. **질문 미리 녹음(선택)** — 자주 나오는 질문은 미리 녹음해 두면 면접 중에 바로 나오고 크레딧이 들지 않음.

## 확인할 점

- 운영 함수에서 옮긴 코드는 문법 검사만 했고 실제 실행은 배포 후 처음 해 봅니다. 연결 점검에서 오류가 나면 오류 문구를 그대로 알려 주세요.
- 학생이 AI를 쓰는 횟수·비용 한도는 012의 기본값을 쓰고, 관리자 화면에서 바꿀 수 있습니다.
- 타입캐스트 요금제가 학교 납품·상업 이용을 허용하는지 계약서로 확인이 필요합니다.
- 면접관 10명이 각자 목소리를 쓰면 녹음본도 면접관별로 만들어야 합니다 (면접관 10명 목소리 화면의 '다시 녹음 예상량' 참고).
