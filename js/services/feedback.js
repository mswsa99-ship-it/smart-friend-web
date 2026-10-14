// إرسال ملاحظات المستخدمين إلى مجلد «ملاحظات صديقك الذكي» على Google Drive (عبر Apps Script).
// إن لم يتوفر الإنترنت تُحفظ الملاحظة وتُرسل تلقائيًا لاحقًا.
import * as Log from './debugLog.js';

/** رابط المستقبِل (Apps Script Web app) */
export const FEEDBACK_URL = '';
const QUEUE = 'sf.feedbackQueue';

const readQueue = () => { try { return JSON.parse(localStorage.getItem(QUEUE) || '[]'); } catch { return []; } };
const writeQueue = (q) => { try { localStorage.setItem(QUEUE, JSON.stringify(q.slice(-10))); } catch {} };

export const isConfigured = () => !!FEEDBACK_URL;

async function post(report) {
  // text/plain: طلب بسيط بلا «فحص مسبق» يقبله Apps Script
  const r = await fetch(FEEDBACK_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ app: 'smart-friend', ...report }),
  });
  const res = await r.json().catch(() => ({ ok: r.ok }));
  if (!res.ok) throw new Error(res.error || `HTTP ${r.status}`);
}

/** يرسل الملاحظة؛ يعيد true إن وصلت الآن، و false إن حُفظت لترسل لاحقًا */
export async function send(report) {
  if (!FEEDBACK_URL) { writeQueue([...readQueue(), report]); return false; }
  try {
    await post(report);
    Log.d('FEEDBACK', `✅ وصلت الملاحظة ${report.id}`);
    return true;
  } catch (err) {
    Log.e('FEEDBACK', `لم تصل الملاحظة ${report.id} — ستُرسل لاحقًا`, err);
    writeQueue([...readQueue(), report]);
    return false;
  }
}

/** يرسل الملاحظات المحفوظة عند عودة الإنترنت أو فتح الصفحة */
export async function flushQueue() {
  if (!FEEDBACK_URL || !navigator.onLine) return;
  const q = readQueue();
  if (!q.length) return;
  const left = [];
  for (const r of q) { try { await post(r); Log.d('FEEDBACK', `✅ أُرسلت الملاحظة المحفوظة ${r.id}`); } catch { left.push(r); } }
  writeQueue(left);
}
addEventListener('online', () => flushQueue());
