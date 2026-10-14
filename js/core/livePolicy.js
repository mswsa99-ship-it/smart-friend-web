// قرارات الاتصال (منطق خالص) — مطابقة لـ LivePolicy.kt
export const CloseAction = Object.freeze({
  NextModel: 'NextModel', Reconnect: 'Reconnect', Relink: 'Relink', Quota: 'Quota',
  NoInternet: 'NoInternet', BadConfig: 'BadConfig', ResumeFailed: 'ResumeFailed',
});

const NETWORK_HINTS = [
  'unable to resolve host', 'failed to connect', 'timeout', 'timed out', 'network',
  'unreachable', 'connection reset', 'software caused connection abort', 'no address', 'connection refused',
];

/** يحدد سبب انقطاع الجلسة وما يجب فعله */
export function classify(code, reason, wasReady) {
  const r = String(reason || '').toLowerCase();
  const has = (...w) => w.some((x) => r.includes(x));
  if (has('api key', 'api_key', 'permission_denied') || code === 401 || code === 403) return CloseAction.Relink;
  if (has('quota', 'resource_exhausted', 'rate limit') || code === 429) return CloseAction.Quota;
  if (NETWORK_HINTS.some((h) => r.includes(h))) return CloseAction.NoInternet;
  if (has('already connected', 'session history not found', 'session handle')) return CloseAction.ResumeFailed;
  if (!wasReady && has('code execution', 'code_execution', 'codeexecution', 'tool', 'function')) return CloseAction.BadConfig;
  if (!wasReady && (has('not found', 'not supported', 'unsupported') || code === 404)) return CloseAction.NextModel;
  if (!wasReady && has('unknown name', 'invalid json', 'languagecodes', 'invalid argument')) return CloseAction.BadConfig;
  // المتصفح: انقطاع بلا سبب قبل الجاهزية (1006) غالبًا شبكة
  if (!wasReady && (code === -1 || code === 1006)) return CloseAction.NoInternet;
  if (!wasReady) return CloseAction.NextModel;
  return CloseAction.Reconnect;
}

/** لا انتقال أبدًا لصوت الجهاز: نعرض المشكلة بإجراء واضح */
export const whenNoModelWorks = () => 'ShowError';

export const MAX_RECONNECTS = 8;

/** انتظار متزايد: 1، 2، 4، 8، ثم 15 ثانية */
export function backoffMs(attempt) {
  return Math.min(15000, 1000 * 2 ** Math.min(4, Math.max(0, attempt - 1)));
}

const version = (re, s) => { const m = re.exec(s); return m ? parseFloat(m[1]) : 0; };

/** نماذج المحادثة المباشرة، بالترتيب المفضّل */
export function orderLiveModels(modelsJson) {
  const arr = (typeof modelsJson === 'string' ? JSON.parse(modelsJson) : modelsJson).models || [];
  const found = [];
  for (const m of arr) {
    const name = String(m.name || '').replace(/^models\//, '');
    if (!(m.supportedGenerationMethods || []).includes('bidiGenerateContent')) continue;
    if (['tts', 'image', 'transcribe', 'embedding', 'translate', 'robotics', '-er-', 'extended', 'thinking'].some((x) => name.includes(x))) continue;
    if (!found.includes(name)) found.push(name);
  }
  const v = /(\d+(?:\.\d+)?)/;
  return found.sort((a, b) =>
    (a.includes('live') ? 0 : 1) - (b.includes('live') ? 0 : 1) ||
    (a.includes('preview') ? 1 : 0) - (b.includes('preview') ? 1 : 0) ||
    version(v, b) - version(v, a));
}

const TEXT_EXCLUDED = ['tts', 'live', 'image', 'transcribe', 'embedding', 'audio', 'native',
  'computer', 'robotics', 'nano', 'banana', 'exp', 'learnlm', 'gemma'];

/** نماذج النص (لقراءة صفحات الكتاب): الخفيف السريع أولًا */
export function orderTextModels(modelsJson) {
  const arr = (typeof modelsJson === 'string' ? JSON.parse(modelsJson) : modelsJson).models || [];
  const found = [];
  for (const m of arr) {
    const name = String(m.name || '').replace(/^models\//, '');
    if (!name.startsWith('gemini') || !name.includes('flash')) continue;
    if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue;
    if (TEXT_EXCLUDED.some((x) => name.includes(x))) continue;
    if (!found.includes(name)) found.push(name);
  }
  const v = /gemini-(\d+(?:\.\d+)?)/;
  return found.sort((a, b) =>
    (a.includes('lite') ? 0 : 1) - (b.includes('lite') ? 0 : 1) ||
    ((a.includes('preview') || a.includes('latest')) ? 1 : 0) - ((b.includes('preview') || b.includes('latest')) ? 1 : 0) ||
    version(v, b) - version(v, a) ||
    a.length - b.length);
}
