// التخزين على الجهاز فقط: بيانات الطفل، الرقم السري (بصمة فقط)، الصوت، الحساسية، الذاكرة، ورمز Gemini مشفّرًا.
import * as Log from './debugLog.js';
import * as Mem from '../core/memory.js';

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/* ---------------- بيانات الطفل والإعدادات ---------------- */
export function profile() { try { return JSON.parse(ls.get('sf.profile') || 'null'); } catch { return null; } }
export const saveProfileData = (p) => ls.set('sf.profile', JSON.stringify(p));
export const voice = () => ls.get('sf.voice') || 'Puck';
export const setVoice = (v) => ls.set('sf.voice', v);
export const pickup = () => ls.get('sf.pickup');
export const setPickup = (v) => ls.set('sf.pickup', v);
export const hasPin = () => !!ls.get('sf.pin');

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hash(salt, pin) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)));
}
/** لا يُحفظ الرقم نفسه، بل بصمته فقط */
export async function setPin(pin) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  ls.set('sf.pin', JSON.stringify({ salt, hash: await hash(salt, pin) }));
}
export async function verifyPin(pin) {
  try { const p = JSON.parse(ls.get('sf.pin')); return p.hash === await hash(p.salt, pin); } catch { return false; }
}

/** حالة قفل الرقم السري بعد المحاولات الخاطئة */
export function pinGuard() { try { return JSON.parse(ls.get('sf.pinGuard') || 'null') || { fails: 0, until: 0 }; } catch { return { fails: 0, until: 0 }; } }
export const setPinGuard = (st) => ls.set('sf.pinGuard', JSON.stringify(st));

/* ---------------- ذاكرة الدرس ---------------- */
export const loadMemory = () => Mem.fromJson(ls.get('sf.memory'));
export const saveMemory = (m) => ls.set('sf.memory', Mem.toJson(m));
export const clearMemory = () => ls.del('sf.memory');

/* ---------------- رمز Gemini مشفّرًا ----------------
 * مفتاح تشفير AES-GCM غير قابل للتصدير محفوظ في IndexedDB، والرمز المشفّر في localStorage.
 * لا يمكن نسخ الرمز من بيانات المتصفح مباشرة. */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('sf-vault', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbOp(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('keys', mode);
    const req = fn(tx.objectStore('keys'));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
  });
}
async function vaultKey(create) {
  let k = await idbOp('readonly', (s) => s.get('k'));
  if (!k && create) {
    k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idbOp('readwrite', (s) => s.put(k, 'k'));
  }
  return k;
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function saveKey(key) {
  try {
    const k = await vaultKey(true);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(key)));
    ls.set('sf.key', JSON.stringify({ iv: b64(iv), ct: b64(ct) }));
  } catch (err) {
    // متصفح يمنع IndexedDB (تصفح خفي قديم): نحفظه دون تشفير مع تسجيل ذلك
    Log.e('VAULT', 'تعذّر التشفير — حفظ عادي', err);
    ls.set('sf.key', JSON.stringify({ plain: key }));
  }
}
export async function loadKey() {
  const raw = ls.get('sf.key');
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o.plain) return o.plain;
    const k = await vaultKey(false);
    if (!k) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, k, unb64(o.ct));
    return new TextDecoder().decode(pt);
  } catch (err) { Log.e('VAULT', 'تعذّر فك الرمز', err); return null; }
}
export const clearKey = () => ls.del('sf.key');

export function clearAll() {
  ['sf.profile', 'sf.pin', 'sf.pinGuard', 'sf.voice', 'sf.pickup', 'sf.memory', 'sf.key', 'sf.email', 'sf.feedbackQueue'].forEach(ls.del);
  try { indexedDB.deleteDatabase('sf-vault'); } catch {}
}
