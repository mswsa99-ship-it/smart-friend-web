// ذاكرة الدرس (منطق خالص) — مطابقة لـ LessonMemory.kt
export const MAX_MESSAGES = 60;
export const PRIMER_MESSAGES = 12;
export const MAX_PAGE_CHARS = 4000;
export const PRIMER_PAGE_CHARS = 2500;
export const MAX_PRIMER_CHARS = 5500;
/** ألقاب ممنوعة: لا نعيدها للصديق في الذاكرة حتى لا يقلّد كلامه السابق */
const BANNED_NICKNAMES = /\s*يا\s+(بطل|صغيري|حبيبي)/g;

export function emptyMemory() {
  return { messages: [], page: null, subject: null, title: null, english: false, updatedAt: 0 };
}

export const isEmpty = (m) => m.messages.length === 0 && m.page == null;

export function add(m, fromChild, text, now) {
  const t = String(text).trim();
  if (!t) return m;
  return { ...m, messages: [...m.messages, { c: fromChild, t }].slice(-MAX_MESSAGES), updatedAt: now };
}

export function withPage(m, page, subject, title, english, now) {
  return { ...m, page: page.slice(0, MAX_PAGE_CHARS), subject, title, english, updatedAt: now };
}

/** ملخص يُرسل للصديق عند بدء جلسة جديدة حتى يكمل الدرس السابق */
export function primer(m, childName) {
  if (isEmpty(m)) return null;
  let sb = `[ذاكرة الدرس] نكمل درسًا سابقًا مع ${childName}.\n`;
  if (m.subject) sb += `المادة: ${m.subject}\n`;
  if (m.title) sb += `العنوان: ${m.title}\n`;
  if (m.page) sb += `محتوى صفحة الكتاب:\n${m.page.slice(0, PRIMER_PAGE_CHARS)}\n`;
  if (m.messages.length) {
    sb += 'آخر ما دار بينكما:\n';
    for (const x of m.messages.slice(-PRIMER_MESSAGES)) {
      const text = x.c ? x.t : x.t.replace(BANNED_NICKNAMES, '');
      sb += `${x.c ? 'الطفل: ' : 'أنت: '}${text.slice(0, 220)}\n`;
    }
  }
  sb += 'رحّب بعودته بجملة قصيرة، وذكّره أين توقفتما، ثم أكمل الدرس بسؤال. لا تسأله ماذا ندرس اليوم.';
  if (!m.page) sb += ' لم يصوّر صفحة الكتاب بعد، فاطلب منه تصويرها.';
  return sb.slice(0, MAX_PRIMER_CHARS);
}

export const toJson = (m) => JSON.stringify({ v: 1, ...m });

export function fromJson(s) {
  if (!s) return emptyMemory();
  try {
    const o = JSON.parse(s);
    return {
      messages: Array.isArray(o.messages) ? o.messages.filter((x) => x && typeof x.t === 'string').map((x) => ({ c: !!x.c, t: x.t })) : [],
      page: o.page || null, subject: o.subject || null, title: o.title || null,
      english: !!o.english, updatedAt: Number(o.updatedAt) || 0,
    };
  } catch { return emptyMemory(); }
}
