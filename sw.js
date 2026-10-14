// عامل الخدمة: يحفظ ملفات الصفحة لتفتح بسرعة، ويجلب النسخة الجديدة تلقائيًا عند كل نشر.
// BUILD يُستبدل تلقائيًا عند النشر برقم النسخة، فيعرف المتصفح أن هناك تحديثًا.
const BUILD = '__BUILD__';
const CACHE = `sf-${BUILD}`;
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'fonts/baloo_regular.woff2', 'fonts/baloo_semibold.woff2', 'fonts/baloo_bold.woff2', 'fonts/baloo_extrabold.woff2',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'js/ui/app.js', 'js/ui/dom.js', 'js/ui/buddy.js',
  'js/services/debugLog.js', 'js/services/store.js', 'js/services/gemini.js',
  'js/live/audioEngine.js', 'js/live/capture-worklet.js', 'js/live/liveSession.js', 'js/live/liveTutor.js',
  'js/core/prompt.js', 'js/core/liveConfig.js', 'js/core/livePolicy.js', 'js/core/calculator.js', 'js/core/liveTools.js',
  'js/core/memory.js', 'js/core/report.js', 'js/services/feedback.js', 'js/core/pageResult.js', 'js/core/messages.js', 'js/core/speechGate.js', 'js/core/nearGate.js', 'js/core/pageReading.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // طلبات Gemini وغيرها تمر كما هي
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
