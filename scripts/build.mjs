// Vercel 빌드: 정적 파일을 dist/로 복사하고, 환경 변수로 dist/config.js를 만듦.
// 환경 변수가 없거나 운영 ZAVAPASS DB 값이면 빌드를 실패시켜 배포를 막음.
import { readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
const PROD_SUPABASE_REFS = ['aqkukxcjcbfxqfesmuva'];   // 운영 ZAVAPASS 프로젝트
const SKIP = new Set(['.git', '.github', '.gitignore', '.vercel', 'dist', 'scripts', 'node_modules', 'config.js', 'vercel.json', 'CLAUDE.md', 'README.md']);

function fail(msg){ console.error('[build] ' + msg); process.exit(1); }

const url = (process.env.VITE_SUPABASE_URL || '').trim();
const key = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();
if(!url || !key) fail('VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 환경 변수를 클론 프로젝트 값으로 설정하세요.');

let keyRef = '';
try{ keyRef = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).ref || ''; }catch(_){}
const hit = PROD_SUPABASE_REFS.find(r => url.includes(r) || keyRef === r);
if(hit) fail(`운영 DB(${hit}) 값이 들어 있어 빌드를 멈춥니다. 클론 프로젝트 값으로 바꾸세요.`);
// 형식 검사: 주소는 https://<20자>.supabase.co, 키는 같은 프로젝트의 anon 키여야 함 (따옴표·https:// 빠짐·주소와 키 뒤바뀜 등)
const urlRef = (url.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/) || [])[1];
if(!urlRef) fail('VITE_SUPABASE_URL 형식이 달라요. https://<프로젝트ID>.supabase.co 형태로, 따옴표·공백 없이 넣어 주세요.');
// 새 방식 publishable 키(sb_publishable_…)는 프로젝트를 키에서 알 수 없어 형식만 봄
// 키에 영문·숫자·. _ - 말고 다른 글자(줄바꿈·눈에 안 보이는 공백 등)가 섞이면 브라우저가 요청을 못 만들어 '인터넷 연결' 오류처럼 보임
if(!/^[A-Za-z0-9._-]+$/.test(key)) fail(`VITE_SUPABASE_ANON_KEY 안에 쓸 수 없는 글자가 섞여 있어요(줄바꿈·보이지 않는 공백 등). 키를 다시 복사해 넣어 주세요. (길이 ${key.length}자)`);
if(/^sb_secret_/.test(key)) fail('VITE_SUPABASE_ANON_KEY에 secret 키가 들어 있어요. 화면에 공개되므로 anon(또는 publishable) 키를 넣어 주세요.');
if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && keyRef !== urlRef) fail(`VITE_SUPABASE_ANON_KEY가 주소(${urlRef})와 같은 프로젝트의 anon 키가 아니에요${keyRef ? ` (키의 프로젝트: ${keyRef})` : ''}.`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
for(const name of readdirSync(ROOT)){
  if(SKIP.has(name) || !statSync(join(ROOT, name)).isFile()) continue;
  copyFileSync(join(ROOT, name), join(OUT, name));
}
writeFileSync(join(OUT, 'config.js'),
  '// scripts/build.mjs가 환경 변수로 만든 파일\nwindow.ZAVAPASS_ENV = ' +
  JSON.stringify({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key }, null, 2) + ';\n');
console.log('[build] dist/ 완료 · DB:', url);
