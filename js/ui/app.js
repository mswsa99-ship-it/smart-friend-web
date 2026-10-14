// صديقك الذكي — نسخة الويب. نفس منطق وشاشات تطبيق أندرويد (MainViewModel + Screens).
import { h, icon, toast, modal } from './dom.js';
import { Buddy, miniBuddyUrl } from './buddy.js';
import * as Log from '../services/debugLog.js';
import * as Store from '../services/store.js';
import * as Gemini from '../services/gemini.js';
import * as Mem from '../core/memory.js';
import { buildLive, greeting } from '../core/prompt.js';
import { ARABIC, ARABIC_ENGLISH } from '../core/liveConfig.js';
import { modeFrom } from '../core/nearGate.js';
import { upsertMessage, displayChildText, isolateMath } from '../core/messages.js';
import { LiveTutor, Phase, Problem } from '../live/liveTutor.js';
import { audioContext, audioReady } from '../live/audioEngine.js';

export const VERSION = '1.0.0';
const GEMINI_KEY_PAGE = 'https://aistudio.google.com/apikey';
const KEY_PATTERN = /AIza[0-9A-Za-z_\-]{30,}/;

/** أصوات Gemini المتاحة للصديق */
const FRIEND_VOICES = [['Puck', 'مرِح ونشيط'], ['Achird', 'ودود'], ['Leda', 'شبابي'], ['Sulafat', 'دافئ'], ['Vindemiatrix', 'لطيف وهادئ'], ['Zephyr', 'مشرق']];
const PICKUP_MODES = [
  ['Near', 'قريب جدًا', 'إن كان أحد ملاصقًا للطالب'],
  ['Normal', 'عادي (مُستحسن)', 'صوت الطالب فقط على بعد 20–30 سم'],
  ['Room', 'الغرفة كلها', 'يسمع كل الأصوات'],
];
const GRADES = [
  ['الأول الابتدائي', 'الأول', 'ابتدائي'], ['الثاني الابتدائي', 'الثاني', 'ابتدائي'], ['الثالث الابتدائي', 'الثالث', 'ابتدائي'],
  ['الرابع الابتدائي', 'الرابع', 'ابتدائي'], ['الخامس الابتدائي', 'الخامس', 'ابتدائي'], ['السادس الابتدائي', 'السادس', 'ابتدائي'],
  ['الأول المتوسط', 'الأول', 'متوسط'], ['الثاني المتوسط', 'الثاني', 'متوسط'], ['الثالث المتوسط', 'الثالث', 'متوسط'],
];
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* ======================= الحالة ======================= */
const S = {
  screen: 'Loading', profile: null, hasPin: false, voice: 'Puck', pickup: 'Normal',
  linking: false, linkError: null,
  messages: [], phase: null, micPaused: false, thinking: false, listening: false, speaking: false,
  interruptible: true, waitingToTalk: false, progress: 0, hasPage: false, readingPage: false,
  issue: null, issueRetrying: false, note: null, needTap: false,
};
let memory = Mem.emptyMemory();
let live = null;
let wasLiveBeforeHidden = false;
let inCamera = false;
const root = document.getElementById('app');

function set(patch) {
  const prevScreen = S.screen;
  Object.assign(S, patch);
  if (S.screen !== prevScreen) render(); else if (S.screen === 'Chat') updateChat(); else if (S.screen === 'Link') updateLink();
}

/* ======================= التوجيه ======================= */
async function route() {
  const key = await Store.loadKey();
  const profile = Store.profile();
  const hasPin = Store.hasPin();
  Object.assign(S, { profile, hasPin, voice: Store.voice(), pickup: modeFrom(Store.pickup()).name });
  Log.d('NAV', `توجيه: مربوط=${!!key} ملف الطفل=${!!profile} رقم سري=${hasPin} صوت=${S.voice}`);
  if (!key) set({ screen: 'Link' });
  else if (!profile || !hasPin) set({ screen: 'Setup' });
  else openChat();
}

/* ---------------- ربط حساب Gemini ---------------- */
async function link(raw) {
  const key = String(raw || '').trim();
  if (S.linking || !key) return;
  Log.d('LINK', `محاولة ربط برمز طوله ${key.length}`);
  set({ linking: true, linkError: null });
  try {
    await Gemini.verifyKey(key);
    await Store.saveKey(key);
    Log.d('LINK', '✅ تم الربط');
    set({ linking: false, issue: null });
    route();
  } catch (err) {
    Log.e('LINK', 'فشل الربط', err);
    const msg = err.kind === 'InvalidKey' ? 'الرمز غير صحيح. انسخه كاملًا من صفحة Google وحاول مرة أخرى.'
      : err.kind === 'Network' ? 'لا يوجد اتصال بالإنترنت.' : 'تعذّر الربط الآن، حاول بعد قليل.';
    set({ linking: false, linkError: msg });
  }
}

/* ---------------- ولي الأمر ---------------- */
async function saveProfile(profile, newPin) {
  Log.d('SETUP', `حفظ: ${profile.name}، ${profile.age} سنوات، ${profile.grade}، رقم سري جديد=${!!newPin}`);
  Store.saveProfileData(profile);
  if (newPin) await Store.setPin(newPin);
  S.hasPin = true; S.profile = profile;
  route();
}
async function verifyPin(pin) {
  const ok = await Store.verifyPin(pin);
  Log.d('PIN', ok ? 'فتح القفل' : 'رقم سري خاطئ');
  return ok;
}
function setPickup(mode) {
  Log.d('NEAR', `تغيير حساسية الالتقاط إلى ${mode}`);
  Store.setPickup(mode); set({ pickup: mode });
  if (live) restartLive();
}
function setVoice(name) {
  Log.d('VOICE', `تغيير صوت الصديق إلى ${name}`);
  Store.setVoice(name); set({ voice: name });
  if (live) restartLive();
}
function editProfile() { stopLive(); set({ screen: 'Setup' }); }
function relink() { stopLive(); Store.clearKey(); set({ screen: 'Link', linkError: null, issue: null }); }
function resetAll() {
  Log.d('NAV', 'إعادة ضبط كاملة');
  stopLive(); Store.clearAll(); memory = Mem.emptyMemory();
  Object.assign(S, { profile: null, hasPin: false, messages: [], hasPage: false, issue: null });
  set({ screen: 'Link' });
}

/* ---------------- الدرس ---------------- */
function openChat() {
  memory = Store.loadMemory();
  const restored = memory.messages.map((m) => ({ fromChild: m.c, text: m.t }));
  Log.d('NAV', `فتح الدرس — ذاكرة سابقة: ${restored.length} رسالة، صفحة=${!!memory.page}`);
  Object.assign(S, { messages: restored, micPaused: false, hasPage: !!memory.page, issue: null, note: null });
  set({ screen: 'Chat' });
  // سفاري والمتصفحات تشترط ضغطة قبل تشغيل الصوت والميكروفون
  if (audioReady()) startLive(); else set({ needTap: true });
}

async function startLive() {
  const profile = S.profile; if (!profile) return;
  const key = await Store.loadKey(); if (!key) return relink();
  set({ needTap: false, phase: Phase.Connecting });
  const models = await Gemini.liveModels(key);
  const opening = Mem.primer(memory, profile.name) || greeting(profile);
  Log.d('MEMORY', Mem.isEmpty(memory) ? 'بداية جديدة' : 'استكمال الدرس السابق من الذاكرة');
  live?.stop();
  live = new LiveTutor({
    apiKey: key, systemPrompt: buildLive(profile), voice: Store.voice(), models, greeting: opening, cb: liveCallbacks,
    initialLanguages: memory.english ? ARABIC_ENGLISH : ARABIC,
    contextProvider: () => Mem.primer(memory, profile.name),
    pickup: modeFrom(Store.pickup()),
  });
  set({ micPaused: false, issue: null });
  live.start();
}
function restartLive() { live?.stop(); live = null; startLive(); }
function stopLive() { live?.stop(); live = null; set({ phase: null, speaking: false, listening: false, thinking: false }); }

const liveCallbacks = {
  onFriendText: (t, done) => onText(false, t, done),
  onChildText: (t, done) => onText(true, t, done),
  onPhase(phase, progress, locked, waiting) {
    set({
      phase, progress, interruptible: !locked, waitingToTalk: waiting,
      speaking: phase === Phase.Speaking,
      listening: phase === Phase.Listening || phase === Phase.ChildTalking,
      thinking: phase === Phase.Thinking || S.readingPage,
    });
  },
  onProblem(problem, retrying) {
    Log.d('ISSUE', `مشكلة: ${problem} (محاولة تلقائية=${retrying})`);
    if (!retrying) live = null;
    set({ issue: problem, issueRetrying: retrying });
  },
  onProblemCleared() { Log.d('ISSUE', 'زالت المشكلة'); set({ issue: null, issueRetrying: false }); },
};

/** نص يصل كلمة بكلمة؛ عند اكتماله يُحفظ في ذاكرة الدرس */
function onText(fromChild, text, done) {
  const shown = fromChild ? displayChildText(text, memory.english) : text;
  if (fromChild && shown == null && done) Log.d('TEXT', `تفريغ بلغة أخرى أُخفي: «${text}»`);
  set({ messages: upsertMessage(S.messages, fromChild, shown ?? '🎤 …', done) });
  if (done && shown != null) remember(fromChild, shown);
}
function remember(fromChild, text) {
  memory = Mem.add(memory, fromChild, text, Date.now());
  Store.saveMemory(memory);
}

function retry() {
  const wasNoMic = S.issue === Problem.NoMic;
  Log.d('ISSUE', 'المستخدم ضغط: حاول مرة أخرى');
  audioContext();
  set({ issue: null });
  if (wasNoMic) startLive(); else restartLive();
}

function send(text) {
  const t = String(text).trim(); if (!t) return;
  Log.d('INPUT', `سؤال مكتوب: ${t}`);
  if (!live) { set({ note: 'الاتصال متوقف، اضغط «حاول مرة أخرى».' }); return; }
  set({ messages: [...S.messages, { fromChild: true, text: t }] });
  remember(true, t);
  live.sendText(t);
}

async function sendPhoto(file) {
  inCamera = false;
  if (!S.micPaused) live?.setPaused(false);
  let img;
  try { img = await Gemini.prepareImage(file); }
  catch (err) { Log.e('PHOTO', 'تعذّر فتح الصورة', err); set({ note: 'تعذّر فتح الصورة، صوّر مرة أخرى.' }); return; }
  Log.d('PHOTO', `صورة جديدة ${img.w}x${img.h}`);
  set({ messages: [...S.messages, { fromChild: true, text: '📷 صفحة من الكتاب', image: img.dataUrl }], readingPage: true, thinking: true, note: null });
  const key = await Store.loadKey(); if (!key) return relink();
  try {
    const page = await Gemini.readPage(img, key);
    if (!page.clear) {
      const why = page.unclearReason || 'غير واضحة';
      Log.d('PHOTO', `الصورة غير واضحة: ${why} — طلب إعادة التصوير`);
      addCard(`📷 الصورة غير واضحة (${why}). أعد تصوير الصفحة مع إضاءة جيدة ويد ثابتة.`);
      live?.sendText(`[من التطبيق] الصورة التي صوّرها الطفل غير واضحة (${why}). اطلب منه بلطف أن يعيد تصوير الصفحة، مع نصيحة قصيرة واحدة.`);
    } else {
      memory = Mem.withPage(memory, page.content, page.subject, page.title, page.english, Date.now());
      Store.saveMemory(memory);
      const head = [page.subject, page.title].filter(Boolean).join(' — ') || 'صفحة الدرس';
      const body = page.content.split('\n').filter((l) => !/^\s*(المادة|العنوان)/.test(l)).join('\n').trim().slice(0, 500);
      addCard(`📖 ${head}\n${body}`);
      set({ hasPage: true });
      if (!live) Log.d('PHOTO', 'لا توجد جلسة الآن — الصفحة محفوظة وستُرسل مع ذاكرة الدرس');
      else {
        live.setLanguages(page.english ? ARABIC_ENGLISH : ARABIC);
        live.sendText(`[صفحة من كتاب الطفل]\n${page.content}`);
      }
    }
  } catch (err) {
    Log.e('PHOTO', 'فشل قراءة الصفحة', err);
    const msg = err.kind === 'Network' ? 'تعذّرت قراءة الصورة: تحقق من الإنترنت ثم صوّر مرة أخرى.'
      : err.kind === 'InvalidKey' ? 'ربط حساب Gemini يحتاج تحديثًا من ولي الأمر.'
      : err.kind === 'QuotaExceeded' ? 'وصل الحساب لحد الاستخدام المجاني مؤقتًا، حاول بعد قليل.'
      : 'تعذّرت قراءة الصورة، صوّر الصفحة مرة أخرى من فضلك.';
    set({ note: msg });
  }
  set({ readingPage: false, thinking: false });
}
const addCard = (text) => set({ messages: [...S.messages, { fromChild: false, text, card: true }] });

/** الزر الأزرق: يوقف/يشغّل الاستماع، أو يعيد الاتصال إن كان متوقفًا */
function onMicPressed() {
  audioContext();
  if (!live) { Log.d('MIC', 'إعادة تشغيل المحادثة'); set({ issue: null }); startLive(); return; }
  const p = !live.isPaused();
  live.setPaused(p); set({ micPaused: p });
}

/** درس جديد: يمسح ذاكرة الدرس الحالي ويبدأ من جديد */
function newLesson() {
  Log.d('NAV', 'درس جديد — مسح الذاكرة');
  stopLive(); Store.clearMemory(); memory = Mem.emptyMemory();
  set({ messages: [], hasPage: false, note: null, issue: null });
  audioContext();
  startLive();
}

/* الصفحة خرجت للخلفية: نغلق الميكروفون والاتصال (الذاكرة محفوظة) */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    Log.flush();
    if (inCamera) { live?.setPaused(true); return; }
    wasLiveBeforeHidden = !!live;
    if (live) Log.d('APP', 'الصفحة في الخلفية — إيقاف المحادثة (الذاكرة محفوظة)');
    live?.stop(); live = null;
  } else {
    if (inCamera) { inCamera = false; if (!S.micPaused) live?.setPaused(false); return; }
    if (wasLiveBeforeHidden && S.screen === 'Chat') {
      Log.d('APP', 'عودة للصفحة — استكمال الدرس من الذاكرة');
      wasLiveBeforeHidden = false;
      if (audioReady()) startLive(); else set({ needTap: true });
    }
  }
});

/* ======================= العرض ======================= */
function render() {
  root.replaceChildren();
  const view = { Loading: viewLoading, Link: viewLink, Setup: viewSetup, Chat: viewChat }[S.screen]();
  root.append(view);
}

function viewLoading() {
  return h('div', { class: 'screen center', style: 'justify-content:center' }, new Buddy(140, 'Thinking').el);
}

/* ---------------- شاشة الربط ---------------- */
let linkRefs = null;
function viewLink() {
  const buddy = new Buddy(120, 'Happy');
  const status = h('div', { class: 'note hidden' });
  const progress = h('div', { class: 'hidden', style: 'font-size:17px' }, '⏳ وصل الرمز! أتحقق منه الآن…');
  const input = h('input', { class: 'field', type: 'password', placeholder: 'الصق رمز الربط هنا', autocomplete: 'off', style: 'font-size:18px', dir: 'ltr' });
  const linkBtn = h('button', { class: 'btn wide mid', onclick: () => link(input.value) }, 'ربط');
  input.addEventListener('input', () => { linkBtn.disabled = input.value.trim().length < 30; });
  linkBtn.disabled = true;
  const manual = h('div', { class: 'card hidden', style: 'width:100%;display:grid;gap:12px' }, input, linkBtn);

  const mock = (inner) => h('div', { class: 'mock' }, inner);
  const step = (n, text, m) => h('div', { class: 'card step' }, h('div', { class: 'step-head' }, h('span', { class: 'num' }, n), h('span', {}, text)), m);

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText();
      const found = KEY_PATTERN.exec(clip || '')?.[0];
      Log.d('LINK', `لصق من الحافظة: فيها نص=${!!clip} فيها رمز=${!!found}`);
      if (found) { input.value = found; link(found); }
      else { toast('لم أجد الرمز في الحافظة. انسخه من صفحة Google ثم اضغط هنا.'); manual.classList.remove('hidden'); }
    } catch (err) {
      Log.d('LINK', `تعذّر قراءة الحافظة: ${err?.name}`);
      manual.classList.remove('hidden'); input.focus();
      toast('الصق الرمز في الخانة ثم اضغط «ربط».');
    }
  }

  linkRefs = { buddy, status, progress, input };
  const install = installHint();
  const el = h('div', { class: 'screen' }, h('div', { class: 'scroll' }, h('div', { class: 'center', style: 'padding:6px 4px 20px' },
    buddy.el,
    h('h1', {}, 'لنُشغّل صديقك الذكي'),
    h('p', { class: 'muted' }, 'خطوة لولي الأمر، مرة واحدة فقط.', h('br'), 'اتبع الصور، وسأكمل الباقي بنفسي ✨'),
    install,
    step(1, 'اضغط «ابدأ الربط» واختر حساب Gmail الخاص بك', mock(h('div', {},
      h('div', { style: 'font-weight:700;margin-bottom:10px' }, 'Choose an account'),
      h('span', { class: 'hl' }, h('span', { style: 'display:inline-flex;gap:10px;align-items:center;background:#fff;border-radius:12px;padding:8px 12px' },
        h('span', { style: 'width:30px;height:30px;border-radius:50%;background:#A897FF;display:inline-block' }),
        h('span', { style: 'text-align:left;font-size:13px' }, h('b', {}, 'Your name'), h('br'), h('span', { style: 'color:#7A8099' }, 'you@gmail.com'))))))),
    step(2, 'اضغط زر Create API key\n(إن سألك عن مشروع، اختر الأول أو أنشئ جديدًا)', mock(h('div', {},
      h('div', { style: 'color:#7A8099;font-size:13px;text-align:left' }, '✦ Google AI Studio'),
      h('div', { style: 'font-weight:700;font-size:17px;text-align:left;margin:4px 0 10px' }, 'API Keys'),
      h('span', { class: 'hl' }, h('span', { style: 'display:inline-block;background:#1A73E8;color:#fff;border-radius:10px;padding:8px 14px;font-weight:700;font-size:14px' }, '+ Create API key'))))),
    step(3, 'اضغط زر النسخ بجانب الرمز، ثم ارجع إلى هنا واضغط «الصق الرمز»', mock(h('div', { style: 'text-align:left' },
      h('div', { style: 'color:#7A8099;font-size:13px;margin-bottom:8px' }, 'Your API key'),
      h('div', { style: 'display:flex;align-items:center;background:#fff;border-radius:10px;padding-left:12px' },
        h('span', { style: 'flex:1;font-size:14px' }, 'AIzaSy••••••••••••••••'),
        h('span', { class: 'hl', style: 'color:#1A73E8;font-size:18px' }, '⧉'))))),
    h('button', { class: 'btn mint wide', onclick: () => { Log.d('LINK', 'فتح صفحة رموز Gemini'); window.open(GEMINI_KEY_PAGE, '_blank', 'noopener'); } }, '🚀 ابدأ الربط'),
    h('button', { class: 'btn wide', onclick: pasteFromClipboard }, '📋 الصق الرمز الذي نسخته'),
    progress, status,
    h('button', { class: 'link', onclick: () => manual.classList.toggle('hidden') }, 'لم يرتبط؟ الصق الرمز يدويًا'),
    manual,
    h('p', { class: 'small' }, '🔒 يُحفظ الرمز مشفّرًا على هذا الجهاز فقط، والاستخدام مجاني على حسابك.'),
    h('p', { class: 'small' }, `نسخة الويب ${VERSION}`),
  )));
  // عند الرجوع من صفحة Google: نحاول قراءة الرمز المنسوخ (كروم أندرويد يسمح بعد الإذن)
  const onBack = async () => {
    if (document.hidden || S.screen !== 'Link' || S.linking) return;
    try {
      if (!navigator.clipboard?.readText) return;
      const perm = await navigator.permissions?.query?.({ name: 'clipboard-read' }).catch(() => null);
      if (perm && perm.state !== 'granted') return;
      const found = KEY_PATTERN.exec(await navigator.clipboard.readText())?.[0];
      if (found) { input.value = found; link(found); }
    } catch {}
  };
  if (!viewLink.listening) { viewLink.listening = true; document.addEventListener('visibilitychange', onBack); }
  updateLink();
  return el;
}
function updateLink() {
  if (!linkRefs) return;
  linkRefs.buddy.setMood(S.linking ? 'Thinking' : 'Happy');
  linkRefs.progress.classList.toggle('hidden', !S.linking);
  linkRefs.status.textContent = S.linkError || '';
  linkRefs.status.classList.toggle('hidden', !S.linkError);
}

/** إرشاد التثبيت على الشاشة الرئيسية */
let deferredInstall = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });
function installHint() {
  if (isStandalone()) return null;
  if (isIOS) {
    return h('div', { class: 'install' }, h('b', {}, '📲 لتجربة أفضل على الآيفون والآيباد:'), h('br'),
      'اضغط زر المشاركة ', h('b', {}, '⬆️'), ' في سفاري، ثم ', h('b', {}, '«إضافة إلى الشاشة الرئيسية»'), '. سيظهر صديقك الذكي كتطبيق.');
  }
  const btn = h('button', { class: 'btn sun wide mid', onclick: async () => {
    if (!deferredInstall) { toast('من قائمة المتصفح ⋮ اختر «إضافة إلى الشاشة الرئيسية».'); return; }
    deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null;
  } }, '📲 تثبيت على الشاشة الرئيسية');
  return h('div', { style: 'width:100%' }, btn);
}

/* ---------------- شاشة الإعداد (3 خطوات) ---------------- */
function viewSetup() {
  const cur = S.profile;
  const st = { step: 0, name: cur?.name || '', age: cur?.age || 8, grade: cur?.grade || GRADES[2][0] };
  const body = h('div', { class: 'scroll' });
  const back = h('button', { class: 'tool', style: 'box-shadow:none;background:transparent', onclick: () => { st.step--; draw(); } }, icon('back', { flip: true }));
  const dots = h('div', { class: 'dots' });
  const el = h('div', { class: 'screen' },
    h('div', { style: 'display:flex;align-items:center;height:48px' }, back, h('div', { style: 'flex:1' }, dots), h('div', { style: 'width:48px' })),
    body);

  function draw() {
    back.style.visibility = st.step > 0 ? 'visible' : 'hidden';
    dots.replaceChildren(...[0, 1, 2].map((i) => h('i', { class: i === st.step ? 'on' : '' })));
    body.replaceChildren(st.step === 0 ? nameStep() : st.step === 1 ? ageGradeStep() : pinStep());
  }
  function nameStep() {
    const input = h('input', { class: 'field', placeholder: 'اسم الطفل', maxlength: 20, value: st.name, enterkeyhint: 'next' });
    const next = h('button', { class: 'btn wide', onclick: () => { st.step = 1; draw(); } }, 'التالي');
    const sync = () => { st.name = input.value.slice(0, 20); next.disabled = !st.name.trim(); };
    input.addEventListener('input', sync);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && st.name.trim()) next.click(); });
    sync();
    return h('div', { class: 'center', style: 'min-height:100%;justify-content:center;gap:18px' },
      new Buddy(140, 'Happy').el, h('h1', {}, 'أهلًا! ما اسم الطالب؟'), h('p', { class: 'muted' }, 'سأناديه باسمه طوال الدرس'), input, next);
  }
  function ageGradeStep() {
    const val = h('b', {}, st.age);
    const minus = h('button', { class: 'btn sun round', onclick: () => setAge(st.age - 1) }, icon('remove'));
    const plus = h('button', { class: 'btn sun round', onclick: () => setAge(st.age + 1) }, icon('add'));
    function setAge(a) { st.age = Math.max(4, Math.min(15, a)); val.textContent = st.age; minus.disabled = st.age <= 4; plus.disabled = st.age >= 15; }
    setAge(st.age);
    const grades = h('div', { class: 'grades' }, GRADES.map(([full, ord, stage]) =>
      h('button', { class: `grade${full === st.grade ? ' on' : ''}`, onclick: (e) => {
        st.grade = full; grades.querySelectorAll('.grade').forEach((g) => g.classList.remove('on')); e.currentTarget.classList.add('on');
      } }, h('b', {}, ord), h('span', {}, stage))));
    return h('div', { class: 'center', style: 'gap:16px;padding-bottom:12px' },
      h('h2', {}, `كم عمر ${st.name.trim()}؟`),
      h('div', { class: 'age' }, minus, h('div', { class: 'age-val' }, val, h('span', { class: 'small' }, 'سنوات')), plus),
      h('h2', {}, 'في أي صف يدرس؟'), grades,
      h('button', { class: 'btn wide', onclick: () => { st.step = 2; draw(); } }, 'التالي'));
  }
  function pinStep() {
    let first = null, entry = '', busy = false;
    const title = h('h2', {}, 'رقم سري لولي الأمر');
    const hint = h('p', { class: 'muted' }, '4 أرقام تحمي الإعدادات من التغيير');
    const pd = h('div', { class: 'pin-dots' });
    const paint = (err = false) => { pd.className = `pin-dots${err ? ' err' : ''}`; pd.replaceChildren(...[0, 1, 2, 3].map((i) => h('i', { class: i < entry.length ? 'on' : '' }))); };
    paint();
    const done = (pin) => { audioContext(); saveProfile({ name: st.name.trim(), age: st.age, grade: st.grade }, pin); };
    const pad = numberPad((d) => {
      if (busy || entry.length >= 4) return;
      entry += d; paint();
      if (entry.length === 4) {
        busy = true;
        setTimeout(() => {
          if (first == null) { first = entry; entry = ''; title.textContent = 'اكتبه مرة أخرى للتأكيد'; paint(); busy = false; }
          else if (first === entry) done(entry);
          else {
            hint.textContent = 'الرقمان مختلفان، لنبدأ من جديد'; hint.style.color = 'var(--coral-deep)'; paint(true);
            setTimeout(() => { first = null; entry = ''; title.textContent = 'رقم سري لولي الأمر'; hint.textContent = '4 أرقام تحمي الإعدادات من التغيير'; hint.style.color = ''; paint(); busy = false; }, 650);
          }
        }, 180);
      }
    }, () => { entry = entry.slice(0, -1); paint(); });
    return h('div', { class: 'center', style: 'min-height:100%;justify-content:center;gap:16px' },
      h('div', { style: 'font-size:44px' }, '🔒'), title, hint, pd, pad,
      S.hasPin ? h('button', { class: 'link', style: 'font-weight:700;font-size:17px', onclick: () => done(null) }, 'إبقاء الرقم السري الحالي') : null);
  }
  draw();
  return el;
}

function numberPad(onDigit, onDelete) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  return h('div', { class: 'pad' }, keys.map((k) => h('button', {
    class: k ? '' : 'blank', 'aria-label': k === '⌫' ? 'حذف' : k,
    onclick: () => (k === '⌫' ? onDelete() : k && onDigit(k)),
  }, k)));
}

/* ---------------- شاشة الدرس ---------------- */
let C = null; // عناصر شاشة الدرس
function viewChat() {
  const buddy = new Buddy(112, 'Thinking');
  const status = h('div', { class: 'status' });
  const msgs = h('div', { class: 'msgs', 'aria-live': 'polite' });
  const issueBox = h('div');
  const note = h('div', { class: 'note hidden', style: 'margin:4px 16px' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden', onchange: (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) sendPhoto(f); } });
  const openCamera = () => { inCamera = true; Log.d('PHOTO', 'فتح الكاميرا'); fileInput.click(); };
  const reminder = h('button', { class: 'reminder', onclick: openCamera }, h('span', { style: 'font-size:22px' }, '📸'), h('span', {}, 'ابدأ بتصوير صفحة الكتاب حتى أشرحها لك'));

  const textarea = h('textarea', { rows: 1, placeholder: 'اكتب سؤالك هنا…' });
  const sendBtn = h('button', { class: 'btn round', style: 'width:54px;height:54px;min-height:54px', 'aria-label': 'إرسال', onclick: () => { send(textarea.value); textarea.value = ''; sendBtn.disabled = true; } }, icon('send', { flip: true, size: 24 }));
  sendBtn.disabled = true;
  textarea.addEventListener('input', () => { sendBtn.disabled = !textarea.value.trim(); });
  const typeRow = h('div', { class: 'type-row hidden' }, textarea, sendBtn);
  let typing = false;
  const kbBtn = h('button', { class: 'btn lav round', 'aria-label': 'اكتب', onclick: () => {
    typing = !typing; typeRow.classList.toggle('hidden', !typing);
    kbBtn.replaceChildren(icon(typing ? 'keyboardHide' : 'keyboard')); kbLabel.textContent = typing ? 'إخفاء' : 'اكتب';
    if (typing) textarea.focus();
  } }, icon('keyboard'));
  const kbLabel = h('span', {}, 'اكتب');

  const ringSize = 108, rr = 50, circ = 2 * Math.PI * rr;
  const ns = 'http://www.w3.org/2000/svg';
  const ring = document.createElementNS(ns, 'svg');
  ring.setAttribute('class', 'ring'); ring.setAttribute('viewBox', `0 0 ${ringSize} ${ringSize}`);
  const track = document.createElementNS(ns, 'circle');
  const arc = document.createElementNS(ns, 'circle');
  for (const c of [track, arc]) { c.setAttribute('cx', 54); c.setAttribute('cy', 54); c.setAttribute('r', rr); c.setAttribute('fill', 'none'); c.setAttribute('stroke-width', 6); }
  track.setAttribute('stroke', '#EAF2FF'); arc.setAttribute('stroke', '#FFB547'); arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-dasharray', circ);
  ring.append(track, arc);
  const micBtn = h('button', { class: 'btn round', 'aria-label': 'الميكروفون', onclick: () => {
    if (S.issue && !S.issueRetrying) retry(); else onMicPressed();
  } });
  const mic = h('div', { class: 'mic' }, ring, h('div', { class: 'halo' }), micBtn);

  const cover = h('div', { class: 'start-cover hidden' },
    new Buddy(140, 'Happy').el,
    h('h1', {}, `أهلًا يا ${S.profile?.name || ''} 👋`),
    h('p', { class: 'muted' }, 'اضغط الزر حتى يبدأ صديقك الكلام ويسمعك'),
    h('button', { class: 'btn mint wide', onclick: () => { audioContext(); startLive(); } }, '🎤 ابدأ الدرس'));

  C = { buddy, status, msgs, issueBox, note, reminder, mic, micBtn, arc, circ, cover, renderedCount: 0 };

  const el = h('div', { class: 'screen chat' },
    h('div', { class: 'topbar' },
      h('div', { class: 'who' }, h('b', {}, `أهلًا يا ${S.profile?.name || ''} 👋`), h('span', { class: 'small', style: 'font-size:14px' }, 'صديقك الذكي')),
      h('button', { class: 'tool', 'aria-label': 'درس جديد', style: 'color:var(--sun)', onclick: confirmNewLesson }, icon('sparkle')),
      h('button', { class: 'tool', 'aria-label': 'ولي الأمر', style: 'color:var(--muted)', onclick: () => parentGate() }, icon('lock'))),
    h('div', { class: 'buddy-wrap' }, buddy.el, status),
    msgs, issueBox, note, reminder,
    h('div', { class: 'panel' }, typeRow,
      h('div', { class: 'controls' },
        h('div', { class: 'side' }, h('button', { class: 'btn sun round', 'aria-label': 'صوّر الكتاب', onclick: openCamera }, icon('camera')), h('span', {}, 'صوّر الكتاب')),
        h('div', { class: 'mic-wrap' }, mic),
        h('div', { class: 'side' }, kbBtn, kbLabel))),
    fileInput, cover);
  updateChat();
  return el;
}

let noteTimer = null;
function updateChat() {
  if (!C) return;
  const ph = S.phase;
  const mood = ph == null || ph === Phase.Connecting ? 'Thinking'
    : S.micPaused && !S.speaking ? 'Idle'
    : ph === Phase.ChildTalking ? 'Listening'
    : S.speaking ? 'Speaking' : S.thinking ? 'Thinking' : 'Happy';
  C.buddy.setMood(mood);
  C.status.textContent = S.issue && !S.issueRetrying ? 'الاتصال متوقف'
    : S.issue === Problem.NoInternet ? 'أعيد الاتصال… تحقق من الإنترنت'
    : S.readingPage ? 'أقرأ صفحة الكتاب…'
    : S.needTap ? 'اضغط «ابدأ الدرس»'
    : ph == null || ph === Phase.Connecting ? 'أتصل بصديقك…'
    : S.micPaused && !S.speaking ? 'الميكروفون متوقف، اضغط الزر لنتكلم'
    : S.waitingToTalk ? 'سمعتك، سأجيبك بعد أن أكمل الفكرة'
    : S.speaking && !S.interruptible ? 'أشرح لك… استمع جيدًا'
    : S.speaking ? 'يمكنك أن تتكلم الآن'
    : ph === Phase.ChildTalking ? 'أستمع إليك… خذ وقتك'
    : S.thinking ? 'دعني أفكّر قليلًا…' : 'أنا أسمعك، تكلّم متى شئت 👂';

  // الرسائل: نعيد رسم آخر رسالة فقط إن كانت ما زالت تصل كلمة بكلمة
  const list = S.messages;
  const nodes = C.msgs.querySelectorAll(':scope > .msg');
  if (nodes.length > list.length) { C.msgs.querySelectorAll('.msg').forEach((n) => n.remove()); }
  const existing = C.msgs.querySelectorAll(':scope > .msg');
  for (let i = 0; i < list.length; i++) {
    const node = messageNode(list[i]);
    if (i < existing.length) { if (existing[i].dataset.sig !== node.dataset.sig) existing[i].replaceWith(node); }
    else C.msgs.insertBefore(node, C.msgs.querySelector('.thinking-row'));
  }
  let think = C.msgs.querySelector('.thinking-row');
  if (S.thinking && !think) C.msgs.append(h('div', { class: 'row thinking-row' }, h('img', { class: 'mini', src: miniBuddyUrl(), alt: '' }), h('div', { class: 'typing' }, h('i'), h('i'), h('i'))));
  if (!S.thinking && think) think.remove();
  if (list.length !== C.renderedCount || S.thinking) { C.msgs.scrollTop = C.msgs.scrollHeight; C.renderedCount = list.length; }
  else if (list.length && list[list.length - 1].streaming) C.msgs.scrollTop = C.msgs.scrollHeight;

  // بطاقة المشكلة
  C.issueBox.replaceChildren(S.issue ? issueCard(S.issue, S.issueRetrying) : '');
  C.note.textContent = S.note || '';
  C.note.classList.toggle('hidden', !S.note);
  if (S.note) { clearTimeout(noteTimer); noteTimer = setTimeout(() => set({ note: null }), 5000); }
  C.reminder.classList.toggle('hidden', S.hasPage || !!S.issue || S.readingPage);
  C.cover.classList.toggle('hidden', !S.needTap);

  // زر الميكروفون
  const stopped = S.issue && !S.issueRetrying;
  const [ic, cls] = stopped ? ['refresh', 'coral'] : S.micPaused ? ['micOff', 'gray'] : S.waitingToTalk ? ['hourglass', 'sun'] : ph === Phase.ChildTalking ? ['mic', 'mint'] : ['mic', ''];
  C.micBtn.className = `btn round ${cls}`;
  if (C.micBtn.dataset.ic !== ic) { C.micBtn.replaceChildren(icon(ic)); C.micBtn.dataset.ic = ic; }
  C.mic.classList.toggle('listening', S.listening && !S.micPaused);
  const prog = S.speaking ? S.progress : 0;
  C.arc.setAttribute('stroke-dashoffset', C.circ * (1 - prog));
  C.arc.style.opacity = S.speaking ? 1 : 0;
}

function messageNode(m) {
  m = { ...m, text: isolateMath(m.text) };
  const sig = `${m.fromChild}|${m.card}|${m.text}|${!!m.image}`;
  let n;
  if (m.fromChild) {
    n = h('div', { class: 'row child msg' }, h('div', { class: 'bubble kid' }, m.image ? h('img', { src: m.image, alt: 'صفحة الكتاب' }) : null, m.text));
  } else if (m.card) {
    n = h('div', { class: 'lesson-card msg' }, m.text);
  } else {
    n = h('div', { class: 'row msg' }, h('img', { class: 'mini', src: miniBuddyUrl(), alt: '' }), h('div', { class: 'bubble friend' }, m.text));
  }
  n.dataset.sig = sig;
  return n;
}

function issueCard(issue, retrying) {
  const [title, body] = {
    NoInternet: ['📶 لا يوجد اتصال بالإنترنت', retrying ? 'أحاول الاتصال تلقائيًا… تأكد أن الواي فاي أو البيانات تعمل.' : 'تأكد من الإنترنت ثم اضغط «حاول مرة أخرى».'],
    Relink: ['🔑 ربط حساب Gemini يحتاج تحديثًا', 'اطلب من ولي الأمر فتح القفل ثم «إعادة ربط حساب Gemini».'],
    Quota: ['⏳ وصل الحساب لحد الاستخدام المجاني مؤقتًا', 'انتظر قليلًا ثم اضغط «حاول مرة أخرى».'],
    Unavailable: ['⚠️ تعذّر الاتصال بصديقك', 'اضغط «حاول مرة أخرى». إن تكررت المشكلة أرسل «ملف المطور» للمطور.'],
    NoMic: ['🎤 صديقك يحتاج إذن الميكروفون', isIOS ? 'اضغط «حاول مرة أخرى» واختر «سماح». إن لم يظهر السؤال: الإعدادات ← سفاري ← الميكروفون ← سماح.' : 'اضغط «حاول مرة أخرى» واسمح باستخدام الميكروفون (من رمز القفل بجانب العنوان).'],
  }[issue];
  return h('div', { class: 'issue' }, h('b', {}, title), h('p', {}, body),
    retrying ? h('div', { class: 'bar' }, h('i'))
      : issue === Problem.Relink ? h('button', { class: 'btn lav wide mid', onclick: () => parentGate() }, 'فتح إعدادات ولي الأمر')
        : h('button', { class: 'btn coral wide mid', onclick: retry }, 'حاول مرة أخرى'));
}

function confirmNewLesson() {
  modal((box, close) => box.append(
    h('div', { style: 'font-size:36px' }, '✨'), h('h2', {}, 'نبدأ درسًا جديدًا؟'),
    h('p', { class: 'muted', style: 'font-size:15px' }, 'سيحفظ صديقك الدرس الحالي حتى تضغط هنا. الدرس الجديد يبدأ من الصفر.'),
    h('button', { class: 'btn sun mid', onclick: () => { close(); newLesson(); } }, 'نعم، درس جديد'),
    h('button', { class: 'link', onclick: close }, 'لا، نكمل درسنا')));
}

/* ---------------- قفل ولي الأمر والإعدادات ---------------- */
function parentGate() {
  let pin = '', wrongCount = 0, lockedUntil = 0, busy = false;
  modal((box, close) => {
    const showPin = () => {
      const pd = h('div', { class: 'pin-dots' });
      const sub = h('p', { class: 'muted', style: 'font-size:15px' }, 'اكتب الرقم السري');
      const paint = (err) => { pd.className = `pin-dots${err ? ' err' : ''}`; pd.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('i', { class: i < pin.length ? 'on' : '' }))); };
      paint();
      const openBtn = h('button', { class: 'btn mid', onclick: check }, 'فتح');
      const refresh = () => { openBtn.disabled = pin.length < 4 || busy || Date.now() < lockedUntil; };
      async function check() {
        busy = true; refresh();
        if (await verifyPin(pin)) return showOptions();
        wrongCount++; paint(true);
        setTimeout(() => {
          pin = ''; busy = false; paint();
          if (wrongCount >= 5) {
            wrongCount = 0; lockedUntil = Date.now() + 60000;
            const tick = setInterval(() => {
              const s = Math.ceil((lockedUntil - Date.now()) / 1000);
              if (s <= 0 || !box.isConnected) { clearInterval(tick); sub.textContent = 'اكتب الرقم السري'; sub.style.color = ''; refresh(); }
              else { sub.textContent = `محاولات كثيرة، انتظر ${s} ثانية`; sub.style.color = 'var(--coral-deep)'; }
            }, 500);
          }
          refresh();
        }, 550);
      }
      box.replaceChildren(h('div', { style: 'font-size:36px' }, '🔒'), h('h2', {}, 'لولي الأمر فقط'), sub, pd,
        numberPad((d) => { if (pin.length < 6 && !busy && Date.now() >= lockedUntil) { pin += d; paint(); refresh(); } }, () => { pin = pin.slice(0, -1); paint(); refresh(); }),
        openBtn, h('button', { class: 'link', onclick: close }, 'إغلاق'));
      refresh();
    };
    const opt = (emoji, text, cls, onclick, sub) => h('button', { class: `btn opt ${cls}`, onclick }, h('span', { style: 'font-size:22px' }, emoji), h('span', { class: 'txt' }, text, sub ? h('small', {}, sub) : null));
    const showOptions = () => box.replaceChildren(
      h('h2', {}, 'الإعدادات'),
      opt('🎙️', 'صوت الصديق', 'mint', showVoices),
      opt('👂', 'حساسية الالتقاط', 'sun', showPickup),
      opt('🧒', 'تعديل بيانات الطفل', '', () => { close(); editProfile(); }),
      opt('🔗', 'إعادة ربط حساب Gemini', 'lav', () => { close(); relink(); }),
      opt('↺', 'إعادة ضبط التطبيق', 'coral', showReset),
      opt('📲', 'التثبيت على الشاشة الرئيسية', '', showInstall),
      Log.ENABLED ? opt('🛠️', 'ملف المطور', 'gray', () => { close(); developerFile(); }) : null,
      h('p', { class: 'small' }, `نسخة الويب ${VERSION}`),
      h('button', { class: 'link', onclick: close }, 'إغلاق'));
    const showVoices = () => box.replaceChildren(h('h2', {}, 'صوت الصديق'), h('p', { class: 'muted', style: 'font-size:14px' }, 'أصوات Gemini الطبيعية'),
      ...FRIEND_VOICES.map(([name, label]) => h('button', { class: `btn mid ${name === S.voice ? 'mint' : ''}`, onclick: () => { setVoice(name); close(); } }, `${name === S.voice ? '✔ ' : ''}${label}`)),
      h('button', { class: 'link', onclick: showOptions }, 'رجوع'));
    const showPickup = () => box.replaceChildren(h('h2', {}, 'حساسية الالتقاط'),
      h('p', { class: 'muted', style: 'font-size:14px' }, 'يسمع صديقك صوت الطالب القريب من الجهاز فقط. إن لم يسمعه جيدًا فاختر «الغرفة كلها».'),
      ...PICKUP_MODES.map(([mode, label, hint]) => opt(mode === S.pickup ? '✔' : '•', label, mode === S.pickup ? 'mint' : '', () => { setPickup(mode); close(); }, hint)),
      h('button', { class: 'link', onclick: showOptions }, 'رجوع'));
    const showReset = () => box.replaceChildren(h('h2', {}, 'متأكد؟'), h('p', { class: 'muted' }, 'سيُحذف الربط وبيانات الطفل والرقم السري.'),
      opt('🗑️', 'نعم، أعد الضبط', 'coral', () => { close(); resetAll(); }), h('button', { class: 'link', onclick: showOptions }, 'رجوع'));
    const showInstall = () => box.replaceChildren(h('h2', {}, 'التثبيت على الشاشة الرئيسية'),
      isStandalone() ? h('p', { class: 'muted' }, '✅ صديقك الذكي مثبّت على الشاشة الرئيسية.') : (installHint() || ''),
      h('button', { class: 'link', onclick: showOptions }, 'رجوع'));
    showPin();
  });
}

/** ملف المطور: يفتح من إعدادات ولي الأمر فقط (لا يراه الطفل) */
function developerFile() {
  modal((box, close) => {
    const pre = h('div', { class: 'devlog' });
    const paint = () => { pre.textContent = Log.snapshot().slice(-600).join('\n'); pre.scrollTop = pre.scrollHeight; };
    paint();
    const off = Log.onChange(() => requestAnimationFrame(paint));
    const closeAll = () => { off(); close(); };
    box.append(h('h2', {}, '🛠️ ملف المطور'),
      h('div', { style: 'display:flex;gap:8px;width:100%' },
        h('button', { class: 'btn mint mid', style: 'flex:1', onclick: async () => {
          try { await navigator.clipboard.writeText(Log.exportText()); toast('✅ نُسخ الملف كاملًا. الصقه في الواتساب وأرسله للمطور.'); }
          catch { toast('تعذّر النسخ، استخدم «مشاركة».'); }
        } }, 'نسخ الكل'),
        h('button', { class: 'btn mid', style: 'flex:1', onclick: async () => {
          const text = Log.exportText();
          try {
            if (navigator.share) await navigator.share({ title: 'ملف المطور — صديقك الذكي', text });
            else { await navigator.clipboard.writeText(text); toast('نُسخ الملف — الصقه في الواتساب.'); }
          } catch {}
        } }, 'مشاركة')),
      pre,
      h('button', { class: 'link', onclick: () => { Log.clear(); paint(); } }, 'مسح السجل'),
      h('button', { class: 'link', onclick: closeAll }, 'إغلاق'));
  });
}

/* ======================= البدء ======================= */
Log.attach();
Log.header();
Log.d('APP', `نسخة الويب ${VERSION}`);
render();
route();

// تحديث النسخة: عامل الخدمة يتحقق من نسخة جديدة عند كل فتح
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          Log.d('APP', 'تحديث جديد متاح');
          const bar = h('button', { class: 'btn sun', style: 'position:fixed;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom) + 12px);z-index:40', onclick: () => location.reload() }, '✨ تحديث جديد متاح — اضغط للتحديث');
          if (S.screen !== 'Chat' || !live) location.reload(); else document.body.append(bar);
        }
      });
    });
  }).catch((err) => Log.e('APP', 'تعذّر تسجيل عامل الخدمة', err));
}
