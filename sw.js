// ZAVAPASS AI · 홈 화면 앱용 서비스 워커 (2026-10-08, 2026-10-19 이름 변경)
// 화면 파일을 저장(캐시)하지 않습니다. 사이트를 고쳐 올리면 아이콘으로 열어도 항상 최신 화면이 열려요.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
