// ملاحظات المستخدمين (14 أكتوبر): زر «إرسال ملاحظة» يرسل الملاحظة مع السجل لمجلد على Drive.
// البريد اختياري، ولا يُرسل رمز Gemini ولا الصور أبدًا.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReport, newReportId, CATEGORIES } from '../js/core/report.js';
import * as Mem from '../js/core/memory.js';

let memory = Mem.add(Mem.add(Mem.emptyMemory(), true, 'كم 5 أس 6؟', 1), false, 'الناتج 36', 2);
memory = Mem.withPage(memory, 'المادة: الرياضيات\nاحسب 5^6', 'الرياضيات', 'القوى', false, 3);
const base = {
  id: 'SF-AB12', category: CATEGORIES[0], note: 'قال إن 5 أس 6 = 36 وهذا خطأ', email: '',
  version: '1.0.0 (5)', device: 'iPhone Safari', profile: { name: 'عادل', age: 9, grade: 'الرابع الابتدائي' }, memory,
  log: ['10:00:00.000 [LIVE] اتصال… key=AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMY12345', '10:00:01.000 [TEXT] الصديق: الناتج 36'],
  now: new Date('2026-10-14T07:12:00Z'),
};

test('الملاحظة تحمل نص المستخدم ونوعها ورقمها والنسخة والجهاز', () => {
  const md = buildReport(base).markdown;
  for (const w of ['SF-AB12', CATEGORIES[0], 'قال إن 5 أس 6 = 36 وهذا خطأ', '1.0.0 (5)', 'iPhone Safari', 'الرابع الابتدائي']) assert.ok(md.includes(w), w);
});
test('البريد اختياري: يُكتب إن وُجد، وإلا «لم يُكتب»', () => {
  assert.ok(buildReport(base).markdown.includes('لم يُكتب'));
  assert.ok(buildReport({ ...base, email: 'a@b.com' }).markdown.includes('a@b.com'));
});
test('تُرفق المحادثة الأخيرة وصفحة الكتاب والسجل للمطابقة', () => {
  const md = buildReport(base).markdown;
  assert.ok(md.includes('الطفل: كم 5 أس 6؟') && md.includes('الصديق: الناتج 36'));
  assert.ok(md.includes('احسب 5^6'));
  assert.ok(md.includes('[TEXT] الصديق: الناتج 36'));
});
test('رمز Gemini لا يُرسل أبدًا، ولا الصور', () => {
  const md = buildReport({ ...base, note: 'رمزي AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMY99999' }).markdown;
  assert.ok(!/AIza[0-9A-Za-z_\-]{10,}/.test(md));
  assert.ok(!md.includes('data:image'));
});
test('حجم الملاحظة محدود حتى مع سجل كبير', () => {
  const log = Array.from({ length: 20000 }, (_, i) => `سطر طويل من السجل رقم ${i} `.repeat(3));
  const md = buildReport({ ...base, log }).markdown;
  assert.ok(md.length < 300_000, String(md.length));
  assert.ok(md.includes('رقم 19999'), 'الأحدث يبقى');
});
test('رقم الملاحظة قصير ومميز', () => {
  const a = newReportId(), b = newReportId();
  assert.match(a, /^SF-[A-Z0-9]{5}$/);
  assert.notEqual(a, b);
});
test('الإعدادات فيها «إرسال ملاحظة»، وتنبيه الذكاء الاصطناعي ظاهر', () => {
  const app = readFileSync('js/ui/app.js', 'utf8');
  assert.ok(app.includes('إرسال ملاحظة'));
  assert.ok(app.includes('(اختياري)'));
  assert.ok(app.includes('يعتمد على الذكاء الاصطناعي'));
});
