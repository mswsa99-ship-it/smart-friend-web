// المراجعة الأمنية (14 أكتوبر، طلب ولي الأمر: «كن صارمًا للجميع»)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildReport } from '../js/core/report.js';
import * as Mem from '../js/core/memory.js';
import { afterWrongPin, isLocked as pinLocked, MAX_TRIES } from '../js/core/pinGuard.js';

const html = readFileSync('index.html', 'utf8');
const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] || '';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

test('سياسة أمان المحتوى: لا يعمل إلا كود الصفحة نفسها، والاتصال بـ Google فقط', () => {
  assert.ok(csp, 'يوجد CSP');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(csp, /default-src 'none'/);
  const connect = /connect-src ([^;]+)/.exec(csp)[1].split(/\s+/);
  for (const c of connect) assert.ok(["'self'", 'https://generativelanguage.googleapis.com', 'wss://generativelanguage.googleapis.com', 'https://script.google.com', 'https://script.googleusercontent.com'].includes(c), c);
  assert.match(html, /name="referrer" content="no-referrer"/);
});

test('لا إدراج لنص كـ HTML في أي مكان (يمنع حقن الكود من ردود Gemini أو الملاحظات)', () => {
  const offenders = walk('js').filter((f) => /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('لا مكتبات أو خطوط أو سكربتات من مواقع خارجية', () => {
  const ext = [...walk('js'), 'index.html', 'css/app.css'].filter((f) => /(src|href)=["']https?:|@import|url\(["']?https?:|import .* from ['"]https?:/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(ext, []);
});

test('إجراءات النشر مثبّتة برقم إصدار لا يتغير (حماية من اختراق طرف ثالث)', () => {
  const wf = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const uses = [...wf.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 5);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, u);
  assert.match(wf, /permissions:\s*\n\s*contents: read/);
});

test('الملاحظات لا تحمل اسم الطفل', () => {
  let m = Mem.add(Mem.emptyMemory(), false, 'أحسنت يا عادل! عادل ذكي', 1);
  const md = buildReport({ id: 'SF-1', category: 'أخرى', note: 'ابني عادل لاحظ خطأ', email: '', version: '1', device: 'x',
    profile: { name: 'عادل', age: 9, grade: 'الرابع' }, memory: m, log: ['[TEXT] الصديق: أهلًا يا عادل'] }).markdown;
  assert.ok(!md.includes('عادل'));
  assert.ok(md.includes('[الطالب]'));
});

test('قفل الرقم السري بعد 5 محاولات خاطئة لمدة دقيقة، ويبقى حتى بعد إعادة فتح الصفحة', () => {
  let st = { fails: 0, until: 0 };
  for (let i = 0; i < MAX_TRIES - 1; i++) st = afterWrongPin(st, 1000);
  assert.ok(!pinLocked(st, 1000));
  st = afterWrongPin(st, 1000);
  assert.ok(pinLocked(st, 1000 + 59_000));
  assert.ok(!pinLocked(st, 1000 + 61_000));
  // الحالة تُحفظ في التخزين (لا تُصفَّر بإعادة التحميل)
  assert.ok(readFileSync('js/services/store.js', 'utf8').includes('sf.pinGuard'));
});

test('مستقبِل الملاحظات يرفض غير ملاحظات التطبيق ويحدّ من الإغراق', () => {
  const gs = readFileSync('feedback/Code.gs', 'utf8');
  assert.match(gs, /MAX_PER_DAY/);
  assert.match(gs, /startsWith\('# ملاحظة SF-'\)/);
  assert.match(gs, /MAX_PER_HOUR/);
});
