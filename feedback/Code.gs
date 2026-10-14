/**
 * مستقبِل ملاحظات «صديقك الذكي»
 * يستقبل كل ملاحظة من صفحة الويب ويحفظها ملف Markdown في مجلد على Google Drive الخاص بك:
 *   «ملاحظات صديقك الذكي» ← 2026-10-14_1012_SF-AB12_إجابة-خاطئة.md
 * لا جداول ولا خدمات أخرى. الملفات ملكك وحدك.
 */
const FOLDER_NAME = 'ملاحظات صديقك الذكي';
const MAX_PER_HOUR = 60;          // حماية من الإرسال المتكرر
const MAX_PER_DAY = 300;          // حد يومي: لا يمتلئ Drive حتى لو أساء أحد استخدام الرابط
const MAX_BYTES = 400 * 1024;     // أقصى حجم للملاحظة الواحدة

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.app !== 'smart-friend') return reply({ ok: false, error: 'unknown app' });

    // لا نقبل إلا ملاحظات بصيغة التطبيق
    if (!String(body.markdown || '').startsWith('# ملاحظة SF-')) return reply({ ok: false, error: 'bad format' });

    const cache = CacheService.getScriptCache();
    const dayKey = 'd' + Utilities.formatDate(new Date(), 'Etc/UTC', 'yyyyMMdd');
    const daily = Number(cache.get(dayKey) || 0);
    if (daily >= MAX_PER_DAY) return reply({ ok: false, error: 'busy' });
    cache.put(dayKey, String(daily + 1), 21600);
    const hourKey = 'n' + Utilities.formatDate(new Date(), 'Etc/UTC', 'yyyyMMddHH');
    const count = Number(cache.get(hourKey) || 0);
    if (count >= MAX_PER_HOUR) return reply({ ok: false, error: 'busy' });
    cache.put(hourKey, String(count + 1), 3600);

    let md = String(body.markdown || '');
    if (md.length > MAX_BYTES) md = md.slice(0, MAX_BYTES) + '\n\n…(اختُصر لكبر حجمه)';
    const id = String(body.id || '').replace(/[^\w-]/g, '').slice(0, 20) || 'SF';
    const cat = String(body.category || 'ملاحظة').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 30);
    const stamp = Utilities.formatDate(new Date(), 'Asia/Riyadh', 'yyyy-MM-dd_HHmm');

    folder().createFile(`${stamp}_${id}_${cat}.md`, md, MimeType.PLAIN_TEXT);
    return reply({ ok: true, id });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/** للتأكد أن المستقبِل يعمل: افتح رابطه في المتصفح */
function doGet() {
  // لا نكشف رابط المجلد لأي أحد
  return reply({ ok: true, app: 'smart-friend-feedback' });
}

function folder() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('folderId');
  if (saved) { try { return DriveApp.getFolderById(saved); } catch (e) {} }
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('folderId', f.getId());
  return f;
}

function reply(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
