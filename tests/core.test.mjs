// اختبارات المنطق — منقولة من اختبارات تطبيق أندرويد (94 اختبارًا) مع نفس الأسباب والملاحظات
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildLive, greeting } from '../js/core/prompt.js';
import { buildSetup, ARABIC, ARABIC_ENGLISH, SILENCE_MS } from '../js/core/liveConfig.js';
import { classify, CloseAction, backoffMs, MAX_RECONNECTS, orderLiveModels, orderTextModels, whenNoModelWorks } from '../js/core/livePolicy.js';
import { evaluate as calc } from '../js/core/calculator.js';
import { respond } from '../js/core/liveTools.js';
import * as M from '../js/core/memory.js';
import { parsePage } from '../js/core/pageResult.js';
import { upsertMessage, displayChildText } from '../js/core/messages.js';
import { SpeechGate, isLocked } from '../js/core/speechGate.js';
import { NearFieldGate, Mode, modeFrom } from '../js/core/nearGate.js';
import * as P from '../js/core/pageReading.js';

const child = { name: 'عادل', age: 9, grade: 'الثالث الابتدائي' };
const prompt = buildLive(child);

// ===================== الموجّه =====================
test('الموجّه بلا «يا بطل» ولا في أي نص بالصفحة', () => {
  assert.ok(!(prompt + greeting(child)).includes('يا بطل'));
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const offenders = [...walk('js'), 'index.html'].filter((f) => readFileSync(f, 'utf8').includes('يا بطل'));
  assert.deepEqual(offenders, []);
});
test('الطفل يتحدث العربية دائمًا، والإنجليزية في درسها فقط', () => {
  assert.ok(prompt.includes('الطفل يتحدث العربية دائمًا'));
  assert.ok(prompt.includes('درس اللغة الإنجليزية'));
});
test('لين وتعاطف واحترام، وتنويع العودة للدرس', () => {
  for (const w of ['تعاطف', 'احترام', 'قصة', 'فكرة', 'مرحة', 'لا تكرر']) assert.ok(prompt.includes(w), w);
});
test('يصر على تصوير صفحة الكتاب ويطلب إعادة التصوير', () => {
  assert.ok(prompt.includes('صوّر صفحة الكتاب') || prompt.includes('يصوّر صفحة الكتاب'));
  assert.ok(prompt.includes('أعد تصوير'));
});
test('يكمل الدرس السابق من الذاكرة ولا يبني على كلمات غريبة', () => {
  assert.ok(prompt.includes('[ذاكرة الدرس]'));
  assert.ok(prompt.includes('لا تبنِ ردك على كلمات غريبة'));
  assert.ok(prompt.includes('حديثًا جانبيًا') && prompt.includes('لا ترد عليه'));
});
test('قواعد الدقة: أداة الحساب، المراجعة عند الاعتراض، نص الخيار', () => {
  for (const w of ['أداة الحساب', 'لا تحسب في ذهنك', 'إذا اعترض', 'أخطأتُ', 'نص الخيار', 'لست متأكدًا']) assert.ok(prompt.includes(w), w);
});

// ===================== إعداد الجلسة =====================
const setup = buildSetup('m', 'p', 'Puck', null, ARABIC).setup;
test('العربية فقط في الدروس، والعربية والإنجليزية في درس الإنجليزي', () => {
  assert.deepEqual(setup.inputAudioTranscription.languageCodes, ['ar']);
  assert.deepEqual(buildSetup('m', 'p', 'Puck', null, ARABIC_ENGLISH).setup.inputAudioTranscription.languageCodes, ['ar', 'en']);
});
test('صبور مع توقفات الطفل ويلتقط بداية كلامه فورًا', () => {
  const vad = setup.realtimeInputConfig.automaticActivityDetection;
  assert.ok(SILENCE_MS >= 1500 && vad.silenceDurationMs === SILENCE_MS);
  assert.equal(vad.startOfSpeechSensitivity, 'START_SENSITIVITY_HIGH');
  assert.equal(vad.endOfSpeechSensitivity, 'END_SENSITIVITY_LOW');
});
test('الرد بصوت Gemini المختار، بدقة لا ارتجال', () => {
  assert.deepEqual(setup.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
  assert.ok(setup.generationConfig.temperature <= 0.4);
});
test('حاسبة الصفحة معرّفة (لا codeExecution المرفوضة)، ويمكن البدء بدونها', () => {
  const tool = setup.tools[0];
  assert.ok(!('codeExecution' in tool));
  assert.equal(tool.functionDeclarations[0].name, 'calculate');
  assert.ok(!('tools' in buildSetup('m', 'p', 'Puck', null, ARABIC, false).setup));
});

// ===================== الاتصال =====================
const models = JSON.stringify({ models: [
  { name: 'models/gemini-2.5-flash-native-audio-latest', supportedGenerationMethods: ['bidiGenerateContent'] },
  { name: 'models/gemini-3.8-live', supportedGenerationMethods: ['bidiGenerateContent'] },
  { name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['bidiGenerateContent'] },
  { name: 'models/gemini-live-translate', supportedGenerationMethods: ['bidiGenerateContent'] },
  { name: 'models/gemini-robotics-er-1.5', supportedGenerationMethods: ['bidiGenerateContent'] },
  { name: 'models/gemini-3.8-live-extended-thinking', supportedGenerationMethods: ['bidiGenerateContent'] },
  { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
] });
test('نماذج المحادثة: الأفضل أولًا بلا ترجمة ولا روبوتات ولا تفكير موسّع', () => {
  const live = orderLiveModels(models);
  assert.equal(live[0], 'gemini-3.8-live');
  assert.ok(!live.some((m) => /translate|robotics|extended/.test(m)));
});
test('نماذج قراءة الصفحة: الخفيف السريع أولًا', () => {
  assert.equal(orderTextModels(models)[0], 'gemini-3.5-flash-lite');
});
test('قرارات الانقطاع مطابقة للتطبيق', () => {
  assert.equal(classify(1007, 'API key not valid', false), CloseAction.Relink);
  assert.equal(classify(1011, 'RESOURCE_EXHAUSTED quota', true), CloseAction.Quota);
  assert.equal(classify(-1, 'network error', false), CloseAction.NoInternet);
  assert.equal(classify(1008, 'models/x is not found', false), CloseAction.NextModel);
  assert.equal(classify(1000, '', true), CloseAction.Reconnect);
  assert.equal(classify(1007, 'Session history not found', true), CloseAction.ResumeFailed);
  assert.equal(classify(1007, 'Code Execution tool is not supported for this model.', false), CloseAction.BadConfig);
  assert.equal(classify(1007, 'Invalid JSON payload: unknown name languageCodes', false), CloseAction.BadConfig);
  assert.equal(whenNoModelWorks(), 'ShowError');
});
test('إعادة الاتصال بانتظار متزايد ثم التوقف', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(backoffMs), [1000, 2000, 4000, 8000, 15000, 15000]);
  assert.equal(MAX_RECONNECTS, 8);
});

// ===================== الحاسبة =====================
test('الحاسبة: قوى دقيقة وصيغ الطفل والكسور والأخطاء', () => {
  assert.equal(calc('5^6'), '15625');
  assert.equal(calc('5 ** 6'), '15625');
  assert.equal(calc('10^3'), '1000');
  assert.equal(calc('2^100'), '1267650600228229401496703205376');
  assert.equal(calc('50 × 960'), '48000');
  assert.equal(calc('٥٠ × ٩٦٠'), '48000');
  assert.equal(calc('٥^٦'), '15625');
  assert.equal(calc('(2 + 3) * 4'), '20');
  assert.equal(calc('2 + 3 × 4'), '14');
  assert.equal(calc('-3 + 5'), '2');
  assert.equal(calc('12.5 * 4'), '50');
  assert.equal(calc('sqrt(144)'), '12');
  assert.equal(calc('27 ÷ 3'), '9');
  assert.equal(calc('3/4'), '3/4 = 0.75');
  assert.equal(calc('1/3'), '1/3 ≈ 0.3333333333');
  assert.equal(calc('1/2 + 1/3'), '5/6 ≈ 0.8333333333');
  assert.equal(calc('6/3'), '2');
  for (const bad of ['7 ÷ 0', '5 + ', 'مرحبا']) assert.ok(calc(bad).startsWith('خطأ'), bad);
});
test('استدعاء الأداة يعود بالنتيجة، والأداة المجهولة بخطأ', () => {
  const r = respond({ functionCalls: [{ id: 'c1', name: 'calculate', args: { expression: '5^6' } }] }).toolResponse.functionResponses[0];
  assert.deepEqual(r, { id: 'c1', name: 'calculate', response: { result: '15625' } });
  const e = respond({ functionCalls: [{ id: 'x', name: 'search', args: {} }] }).toolResponse.functionResponses[0];
  assert.ok(e.response.error);
});

// ===================== الذاكرة وقراءة الصفحة =====================
const lesson = () => M.withPage(M.add(M.add(M.emptyMemory(), true, 'ما الفرق بين الجمعين؟', 1), false, 'جمع التكسير يتغير فيه شكل المفرد', 2),
  'المادة: لغتي\nجمع المذكر السالم وجمع التكسير', 'لغتي', 'الجموع', false, 3);
test('الذاكرة تبقى بعد الحفظ والتحميل، وتكمل الدرس السابق', () => {
  const m = M.fromJson(M.toJson(lesson()));
  assert.deepEqual(m, lesson());
  const p = M.primer(m, 'عادل');
  assert.ok(p.startsWith('[ذاكرة الدرس]') && p.includes('جمع التكسير') && p.includes('لغتي'));
});
test('ذاكرة فارغة = بداية جديدة، وبلا صفحة يطلب التصوير، ومحدودة الحجم', () => {
  assert.equal(M.primer(M.emptyMemory(), 'عادل'), null);
  assert.ok(M.primer(M.add(M.emptyMemory(), true, 'مرحبا', 1), 'عادل').includes('تصويرها'));
  let m = M.emptyMemory();
  for (let i = 0; i < 200; i++) m = M.add(m, i % 2 === 0, 'رسالة طويلة '.repeat(30) + i, i);
  assert.equal(m.messages.length, M.MAX_MESSAGES);
  assert.ok(M.primer(m, 'عادل').length <= M.MAX_PRIMER_CHARS);
});
test('الذاكرة لا تعيد «يا بطل» للصديق', () => {
  const p = M.primer(M.add(M.add(M.emptyMemory(), false, 'أهلاً بك يا عادل يا بطل. لنكمل درسنا', 1), true, 'نعم', 2), 'عادل');
  assert.ok(!p.includes('بطل') && p.includes('لنكمل درسنا'));
});
test('قراءة الصفحة: الواضحة، وغير الواضحة، ودرس الإنجليزي', () => {
  const ok = parsePage('الوضوح: واضحة\nالمادة: الرياضيات\nالعنوان: القوى\nاحسب 5^6');
  assert.ok(ok.clear && ok.subject === 'الرياضيات' && ok.title === 'القوى' && ok.content.includes('5^6') && !ok.english);
  const bad = parsePage('الوضوح: غير واضحة - الصورة مظلمة');
  assert.ok(!bad.clear && bad.unclearReason === 'الصورة مظلمة');
  assert.ok(parsePage('الوضوح: واضحة\nالمادة: الإنجليزي (English)').english);
});
test('قراءة الصفحة بدقة: صورة أوضح، تفكير أعمق، نسخ حرفي للأس والكسور والخيارات', () => {
  assert.ok(P.PAGE_MAX_DIM >= 1600 && P.PAGE_JPEG_QUALITY >= 0.85 && P.PAGE_THINKING !== 'minimal' && P.PAGE_MAX_TOKENS >= 2000);
  for (const w of ['حرفيًا', '5^6', '3/4', 'الخيارات']) assert.ok(P.PAGE_INSTRUCTION.includes(w), w);
  assert.ok(!P.PAGE_INSTRUCTION.includes('باختصار'));
  assert.deepEqual(P.scaledSize(3000, 4000), [1200, 1600]);
  assert.deepEqual(P.scaledSize(800, 600), [800, 600]);
});
test('الرسائل تصل كلمة بكلمة ثم تكتمل، ونص الطفل بلغة أخرى يُخفى', () => {
  let l = upsertMessage([], false, 'أهلًا', false);
  l = upsertMessage(l, false, 'أهلًا يا عادل', true);
  assert.equal(l.length, 1); assert.equal(l[0].streaming, false);
  assert.equal(displayChildText('हां।', false), null);
  assert.equal(displayChildText('la main de ma lettre', false), null);
  assert.equal(displayChildText('the apple', true), 'the apple');
  assert.equal(displayChildText('جمع تكسير', false), 'جمع تكسير');
});

// ===================== بوابة الـ 75% =====================
const ch = (v, n = 1600) => new Int16Array(n).fill(v);
test('مقفل قبل 75% ومفتوح عند 75%', () => {
  assert.ok(isLocked(true, false, 0.9));
  assert.ok(isLocked(true, true, 0.5));
  assert.ok(!isLocked(true, true, 0.75));
  assert.ok(!isLocked(false, false, 0));
});
test('كلام الطفل أثناء القفل يُحفظ ثم يُرسل بالترتيب، والصمت يُهمل', () => {
  const g = new SpeechGate();
  const started = [1, 2, 3, 4].map((i) => g.onChunk(ch(i), 2000, true)).some((d) => d.childStartedDuringLock);
  assert.ok(started);
  const d = g.onChunk(ch(9), 2000, false);
  assert.deepEqual(d.toSend.map((c) => c[0]), [1, 2, 3, 4, 9]);
  const s = new SpeechGate();
  for (let i = 0; i < 30; i++) s.onChunk(ch(1), 10, true);
  assert.equal(s.onChunk(ch(2), 10, false).toSend.length, 1);
});
test('الصدى ليس كلام الطفل، وصوت الطفل فوق الصدى يُسمع، والصدى بعد 75% يصبح صمتًا', () => {
  const g = new SpeechGate();
  for (let i = 0; i < 20; i++) g.onChunk(ch(1), 1500, true, true);
  assert.ok(!g.heardDuringLock);
  let heard = false;
  for (let i = 0; i < 4; i++) heard = g.onChunk(ch(2), 6000, true, true).childStartedDuringLock || heard;
  assert.ok(heard);
  const e = new SpeechGate();
  for (let i = 0; i < 20; i++) e.onChunk(ch(1), 1500, true, true);
  e.reset();
  assert.ok(e.onChunk(ch(5), 1500, false, true).toSend[0].every((x) => x === 0));
  assert.equal(e.onChunk(ch(5), 8000, false, true).toSend[0][0], 5);
  assert.equal(new SpeechGate().onChunk(ch(3), 50, false, false).toSend[0][0], 3);
});

// ===================== بوابة المسافة =====================
const silent = (o) => o.every((x) => x.pcm.every((v) => v === 0));
const say = (g, lvl, n = 2) => Array.from({ length: n }).flatMap(() => g.process(ch(lvl), lvl, false));
const childSpeaks = (g, lvl) => { say(g, lvl, 10); for (let i = 0; i < 10; i++) g.process(ch(20), 20, false); };
test('كلام المحيط محجوب من أول ثانية ولا يُتعلَّم منه', () => {
  const g = new NearFieldGate(Mode.Normal);
  for (const lvl of [600, 1374, 1011, 900, 1200, 1400, 715]) assert.ok(silent(g.process(ch(lvl), lvl, false)), String(lvl));
  for (let i = 0; i < 50; i++) g.process(ch(1100), 1100, false);
  assert.equal(g.childLevel, 0);
});
test('صوت الطفل القريب يمر، والبعيد يُحجب حتى لو كان عاليًا', () => {
  const g = new NearFieldGate(Mode.Normal);
  assert.ok(!silent([say(g, 3500).at(-1)]));
  const h = new NearFieldGate(Mode.Normal); childSpeaks(h, 5000);
  for (let i = 0; i < 10; i++) assert.ok(silent(h.process(ch(1400), 1400, false)));
});
test('صوت باب واحد لا يفتح البوابة، وبداية الكلمة الهادئة لا تضيع، والتوقفات تبقى', () => {
  const g = new NearFieldGate(Mode.Normal); childSpeaks(g, 3000);
  assert.ok(silent(g.process(ch(6000), 6000, false)));
  for (let i = 0; i < 8; i++) assert.ok(silent(g.process(ch(900), 900, false)));
  const s = new NearFieldGate(Mode.Normal); childSpeaks(s, 3000);
  s.process(ch(800), 800, false);
  assert.ok(say(s, 2900).some((o) => o.pcm[0] === 800));
  const p = new NearFieldGate(Mode.Normal); childSpeaks(p, 3000); say(p, 3000);
  for (let i = 0; i < 5; i++) assert.ok(!silent(p.process(ch(500), 500, false)));
});
test('الأوضاع: الغرفة كلها بلا حجب، وقريب جدًا أشد من العادي', () => {
  const r = new NearFieldGate(Mode.Room); childSpeaks(r, 3000);
  assert.equal(r.process(ch(900), 900, false)[0].pcm[0], 900);
  const n = new NearFieldGate(Mode.Normal), q = new NearFieldGate(Mode.Near);
  childSpeaks(n, 3000); childSpeaks(q, 3000);
  assert.ok(!silent([say(n, 1800).at(-1)]));
  assert.ok(silent(say(q, 1800)));
  assert.equal(modeFrom('Near'), Mode.Near); assert.equal(modeFrom(null), Mode.Normal); assert.equal(modeFrom('x'), Mode.Normal);
});
test('رفع صوت الطفل دون تشويه، والصدى لا يغيّر مستواه، ويتكيف إن ابتعد قليلًا', () => {
  const g = new NearFieldGate(Mode.Normal); childSpeaks(g, 1600);
  const o = say(g, 1600).at(-1);
  assert.ok(o.pcm[0] > 1800 && o.rms > 1800);
  const loud = g.process(new Int16Array([30000, -30000]), 30000, false).at(-1);
  assert.deepEqual([...loud.pcm], [32767, -32768]);
  const e = new NearFieldGate(Mode.Normal); childSpeaks(e, 2000);
  const before = e.childLevel;
  for (let i = 0; i < 30; i++) e.process(ch(6000), 6000, true);
  assert.ok(Math.abs(e.childLevel - before) < 1);
  const f = new NearFieldGate(Mode.Normal); childSpeaks(f, 3000); say(f, 1700);
  for (let i = 0; i < 30; i++) assert.ok(!silent(f.process(ch(1700), 1700, false)));
  assert.ok(f.childLevel < 2500);
});

// ===================== عرض المعادلات =====================
import { isolateMath } from '../js/core/messages.js';
test('المعادلات تُعرض كما في الكتاب داخل النص العربي (لا 6^5)', () => {
  assert.equal(isolateMath('احسب: 5^6'), 'احسب: ⁦5^6⁩');
  assert.equal(isolateMath('الناتج 50 × 960 = 48000 تمامًا'), 'الناتج ⁦50 × 960 = 48000⁩ تمامًا');
  assert.equal(isolateMath('1/2 + 1/3'), '⁦1/2 + 1/3⁩');
  assert.ok(isolateMath('5^6 = ?').startsWith('⁦'));
  assert.equal(isolateMath('أ- 36 ب- 15625'), 'أ- 36 ب- 15625', 'الأرقام المفردة لا تتغير');
  assert.equal(isolateMath('الصف الثالث'), 'الصف الثالث');
});
