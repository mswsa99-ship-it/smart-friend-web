// الطلبات النصية إلى Gemini: التحقق من الرمز، النماذج المتاحة، قراءة صفحة الكتاب — مطابقة لـ GeminiTutor.kt
import * as Log from './debugLog.js';
import { orderLiveModels, orderTextModels } from '../core/livePolicy.js';
import { parsePage } from '../core/pageResult.js';
import * as P from '../core/pageReading.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_TEXT = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-2.5-flash-lite'];
const FALLBACK_LIVE = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview'];

export class TutorError extends Error {
  constructor(kind, code = 0) { super(`${kind} ${code}`); this.kind = kind; this.code = code; }
}

let textModels = null, liveModelsCache = null, useThinkingLevel = true;

async function call(url, key, init = {}, timeoutMs = 60000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal, headers: { ...(init.headers || {}), 'x-goog-api-key': key } });
  } catch (err) {
    Log.e('REST', 'تعذّر الوصول للخادم', err);
    throw new TutorError('Network');
  } finally { clearTimeout(t); }
}

/** يتحقق أن الرمز صالح ويجهّز قائمة النماذج */
export async function verifyKey(key) {
  const r = await call(`${BASE}/models?pageSize=200`, key, {}, 20000);
  Log.d('REST', `التحقق من الرمز: HTTP ${r.status}`);
  if (r.status === 200) {
    const body = await r.json();
    textModels = orderTextModels(body);
    liveModelsCache = orderLiveModels(body);
    Log.d('REST', `قائمة النماذج: نص=[${textModels}] | مباشر=[${liveModelsCache}]`);
  } else if ([400, 401, 403].includes(r.status)) throw new TutorError('InvalidKey', r.status);
  else if (r.status !== 429) throw new TutorError('Server', r.status);
}

export async function liveModels(key) {
  if (!liveModelsCache?.length) { try { await verifyKey(key); } catch {} }
  const list = liveModelsCache?.length ? liveModelsCache : FALLBACK_LIVE;
  Log.d('LIVE', `نماذج Live المتاحة: [${list}]`);
  return list;
}
async function getTextModels(key) {
  if (!textModels?.length) { try { await verifyKey(key); } catch {} }
  return textModels?.length ? textModels : FALLBACK_TEXT;
}

/** يصغّر صورة الصفحة ويحوّلها إلى JPEG (مع تصحيح اتجاه الكاميرا) */
export async function prepareImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  }
  const [w, h] = P.scaledSize(bmp.width, bmp.height);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const dataUrl = c.toDataURL('image/jpeg', P.PAGE_JPEG_QUALITY);
  return { dataUrl, base64: dataUrl.split(',')[1], w, h };
}

function extractText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => !p.thought).map((p) => p.text || '').join('').trim() || null;
}

export async function readPage(img, key) {
  const t0 = performance.now();
  Log.d('PHOTO', `قراءة صفحة الكتاب: ${img.w}x${img.h} حجم=${Math.round(img.base64.length * 0.75 / 1024)}KB`);
  const contents = [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: img.base64 } }, { text: P.PAGE_INSTRUCTION }] }];
  let last = new TutorError('Server');
  for (const model of (await getTextModels(key)).slice(0, 4)) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const generationConfig = { temperature: 0.2, maxOutputTokens: P.PAGE_MAX_TOKENS };
      if (useThinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: P.PAGE_THINKING };
      const t1 = performance.now();
      const r = await call(`${BASE}/models/${model}:generateContent`, key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_instruction: { parts: [{ text: P.PAGE_SYSTEM }] }, contents, generationConfig }),
      });
      const body = await r.text();
      Log.d('REST', `طلب ${model} تفكير=${useThinkingLevel ? P.PAGE_THINKING : 'افتراضي'} → HTTP ${r.status} خلال ${Math.round(performance.now() - t1)}ms${r.status !== 200 ? ` | ${body.slice(0, 250)}` : ''}`);
      if (r.status === 200) {
        const text = extractText(JSON.parse(body));
        if (!text) break;
        const page = parsePage(text);
        Log.d('PHOTO', `قُرئت الصفحة خلال ${Math.round(performance.now() - t0)}ms — واضحة=${page.clear} مادة=${page.subject} إنجليزي=${page.english}:\n${text.slice(0, 1500)}`);
        return page;
      }
      if (r.status === 401 || body.includes('API_KEY') || body.includes('API key')) throw new TutorError('InvalidKey', r.status);
      if (r.status === 400 && useThinkingLevel) { useThinkingLevel = false; continue; }
      last = new TutorError(r.status === 429 ? 'QuotaExceeded' : 'Server', r.status);
      break;
    }
  }
  throw last;
}
