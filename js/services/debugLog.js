// ملف المطور — مطابق لـ DebugLog.kt: سجل لحظي يُحفظ على الجهاز، بلا رمز Gemini أبدًا، وحجم صغير ثابت.
export const ENABLED = true; // ⬅️ false لإخفاء «ملف المطور» بعد الاعتماد

const MAX_LINES = 3000;
const STORE_KEY = 'sf.log';
const MAX_STORED_CHARS = 180_000;
const keyPattern = /AIza[0-9A-Za-z_\-]{10,}/g;
const lines = [];
const listeners = new Set();
let previousLoaded = false;
let storeTimer = null;

const pad = (n, w = 2) => String(n).padStart(w, '0');
const time = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };

export const redact = (s) => String(s).replace(keyPattern, 'AIza…(مخفي)');

export function d(tag, msg) {
  const line = `${time()} [${tag}] ${redact(msg)}`;
  try { console.debug('SmartFriend', line); } catch {}
  lines.push(line);
  while (lines.length > MAX_LINES) lines.shift();
  scheduleStore();
  listeners.forEach((f) => { try { f(); } catch {} });
}
export const e = (tag, msg, err) => d(tag, `❌ ${msg}${err ? ` | ${err.name || 'Error'}: ${err.message || err}` : ''}`);

/** يشغّل الكود، وإن حدث خطأ يسجّله بدل أن تتوقف الصفحة */
export function guard(tag, fn) {
  try { return fn(); } catch (err) { e(tag, 'خطأ تم احتواؤه', err); d(tag, String(err?.stack || '').split('\n').slice(0, 6).join('\n')); }
}

export const snapshot = () => [...lines];
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
export function clear() { lines.length = 0; storeNow(); header(); }

export function deviceInfo() {
  const ua = navigator.userAgent;
  const standalone = matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  return `الجهاز: ${ua} | ${standalone ? 'مثبّت على الشاشة الرئيسية' : 'في المتصفح'}`;
}
export const header = () => d('APP', `بدء السجل — ${deviceInfo()}`);

export function exportText() {
  return ['=== سجل صديقك الذكي (نسخة الويب) ===', deviceInfo(), '', ...lines].join('\n');
}

/* ------------ الحفظ على الجهاز: الجلسات السابقة تبقى ------------ */
function scheduleStore() {
  if (storeTimer) return;
  storeTimer = setTimeout(storeNow, 1500);
}
function storeNow() {
  storeTimer = null;
  try {
    let text = lines.join('\n');
    if (text.length > MAX_STORED_CHARS) text = text.slice(-MAX_STORED_CHARS);
    localStorage.setItem(STORE_KEY, text);
  } catch {}
}
export const flush = storeNow;

/** يحمّل الجلسات السابقة مرة واحدة فقط */
export function attach() {
  if (previousLoaded) return;
  previousLoaded = true;
  let prev = [];
  try { prev = (localStorage.getItem(STORE_KEY) || '').split('\n').filter(Boolean).slice(-2000); } catch {}
  if (prev.length) lines.unshift('──────── الجلسات السابقة ────────', ...prev, '──────── نهاية الجلسات السابقة ────────', '──────── جلسة جديدة ────────');
  addEventListener('error', (ev) => e('CRASH', `💥 ${ev.message} @ ${ev.filename?.split('/').pop()}:${ev.lineno}`));
  addEventListener('unhandledrejection', (ev) => e('CRASH', `💥 وعد مرفوض: ${ev.reason?.message || ev.reason}`));
  addEventListener('pagehide', storeNow);
}
