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
