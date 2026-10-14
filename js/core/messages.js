// الرسائل المعروضة — مطابقة لـ Messages.kt

/** يضيف رسالة جديدة أو يحدّث الرسالة التي ما زالت تصل كلمة بكلمة */
export function upsertMessage(list, fromChild, text, done) {
  const out = [...list];
  let idx = -1;
  for (let i = out.length - 1; i >= 0; i--) if (out[i].fromChild === fromChild && out[i].streaming) { idx = i; break; }
  const msg = { fromChild, text, streaming: !done };
  if (idx >= 0) out[idx] = msg; else out.push(msg);
  return out;
}

/** نص الطفل كما يُعرض: العربي (أو الإنجليزي في درس الإنجليزي فقط)، وغير ذلك يُخفى (null) */
export function displayChildText(raw, allowEnglish) {
  const letters = [...String(raw)].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return String(raw).trim() || null;
  const arabic = letters.filter((c) => /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(c)).length;
  const latin = letters.filter((c) => /[a-zA-Z]/.test(c)).length;
  const other = letters.length - arabic - latin;
  if (other > 0 && other >= arabic) return null;
  if (arabic > 0) return raw;
  if (latin > 0 && allowEnglish) return raw;
  return null;
}

/**
 * المعادلات داخل نص عربي تنقلب في العرض («5^6» تظهر «6^5») بسبب اتجاه الكتابة.
 * نعزلها باتجاه يسار←يمين حتى تظهر كما في الكتاب.
 */
const MATH_RUN = /[0-9٠-٩](?:[0-9٠-٩.,\s]*[\^+\-−×÷*/=<>≈%()√][\s(]*[0-9٠-٩(√]+)+[0-9٠-٩.)%]*(?:\s*[=≈]\s*[?؟])?/g;
export function isolateMath(text) {
  return String(text).replace(MATH_RUN, (m) => `⁦${m.trim()}⁩${/\s$/.test(m) ? ' ' : ''}`);
}
