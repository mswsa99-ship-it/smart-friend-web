// ملاحظة المستخدم (منطق خالص): نص المستخدم + المحادثة الأخيرة + صفحة الكتاب + السجل، بصيغة Markdown.
// البريد اختياري، ولا يُرسل رمز Gemini ولا الصور أبدًا.
export const CATEGORIES = ['إجابة أو معلومة خاطئة', 'لم يسمع الطالب جيدًا', 'مشكلة في الصوت أو الاتصال', 'اقتراح', 'أخرى'];
const MAX_LOG_CHARS = 200_000;
const keyPattern = /AIza[0-9A-Za-z_\-]{10,}/g;
const clean = (s) => String(s ?? '').replace(keyPattern, 'AIza…(مخفي)').replace(/data:image\/[^\s)"']+/g, '(صورة)');
const fence = (s) => '```\n' + String(s).replace(/```/g, 'ˋˋˋ') + '\n```';

export function newReportId() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(5));
  return 'SF-' + [...r].map((x) => abc[x % abc.length]).join('');
}

/** @returns {{id: string, category: string, markdown: string}} */
export function buildReport({ id, category, note, email, version, device, profile, memory, log = [], now = new Date() }) {
  const when = now.toLocaleString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' });
  const conv = (memory?.messages || []).slice(-20).map((m) => `${m.c ? 'الطفل' : 'الصديق'}: ${m.t}`).join('\n');
  let logText = log.map(clean).join('\n');
  if (logText.length > MAX_LOG_CHARS) logText = '…(أقدم السجل محذوف)\n' + logText.slice(-MAX_LOG_CHARS);
  const md = [
    `# ملاحظة ${id} — ${category}`,
    '',
    `- **التاريخ:** ${when}`,
    `- **البريد:** ${email?.trim() ? clean(email.trim()) : 'لم يُكتب'}`,
    `- **النسخة:** ${clean(version)}`,
    `- **الجهاز:** ${clean(device)}`,
    profile ? `- **الطالب:** ${profile.age} سنوات، ${profile.grade}` : '',
    memory?.subject || memory?.title ? `- **الدرس:** ${[memory.subject, memory.title].filter(Boolean).join(' — ')}` : '',
    '',
    '## الملاحظة',
    '',
    clean(note).trim() || '(بلا نص)',
    '',
    '## آخر ما دار في الدرس',
    '',
    conv ? fence(clean(conv)) : '(لا توجد محادثة)',
    '',
    '## صفحة الكتاب كما قُرئت',
    '',
    memory?.page ? fence(clean(memory.page)) : '(لم تُصوَّر صفحة)',
    '',
    '## السجل',
    '',
    fence(logText),
    '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  return { id, category, markdown: md };
}
