// نتيجة قراءة صفحة الكتاب — مطابقة لـ PageResult.kt
const ENGLISH_HINTS = ['إنجليزي', 'انجليزي', 'الإنجليزية', 'الانجليزية', 'english'];

export function parsePage(raw) {
  const lines = String(raw).trim().split('\n');
  const field = (name) => {
    const l = lines.find((x) => x.trim().startsWith(name));
    if (!l) return null;
    const v = l.slice(l.indexOf(':') + 1).trim();
    return l.includes(':') && v ? v : null;
  };
  const clarity = field('الوضوح') || '';
  const unclear = clarity.includes('غير واضح') || clarity.includes('ليست') || clarity.includes('لا توجد') ||
    String(raw).trim().startsWith('[غير واضحة]');
  const subject = field('المادة');
  const title = field('العنوان');
  const english = subject ? ENGLISH_HINTS.some((h) => subject.toLowerCase().includes(h)) : false;
  const content = lines.filter((l) => !l.trim().startsWith('الوضوح')).join('\n').trim();
  let unclearReason = null;
  if (unclear) {
    const after = clarity.includes('-') ? clarity.slice(clarity.indexOf('-') + 1).trim() : '';
    unclearReason = after || clarity || null;
  }
  return { clear: !unclear, content, subject, title, english, unclearReason };
}
