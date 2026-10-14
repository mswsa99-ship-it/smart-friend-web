// مدير المحادثة الصوتية المباشرة — مقابل LiveTutor.kt
// قاعدة عدم المقاطعة: أثناء أول 75% من شرح الصديق لا يُرسل صوت الطفل؛ يُحفظ ويُرسل عند 75%.
import * as Log from '../services/debugLog.js';
import { LiveSession } from './liveSession.js';
import { AudioEngine } from './audioEngine.js';
import { SpeechGate, isLocked } from '../core/speechGate.js';
import { NearFieldGate, Mode } from '../core/nearGate.js';
import { classify, CloseAction, MAX_RECONNECTS, backoffMs } from '../core/livePolicy.js';
import { ARABIC } from '../core/liveConfig.js';

export const Phase = Object.freeze({ Connecting: 'Connecting', Listening: 'Listening', ChildTalking: 'ChildTalking', Thinking: 'Thinking', Speaking: 'Speaking', Paused: 'Paused' });
export const Problem = Object.freeze({ NoInternet: 'NoInternet', Relink: 'Relink', Quota: 'Quota', Unavailable: 'Unavailable', NoMic: 'NoMic' });

const LOUD_RMS = 1100;
const now = () => performance.now();

export class LiveTutor {
  /**
   * @param {{apiKey, systemPrompt, voice, models: string[], greeting, cb, initialLanguages?, contextProvider?, pickup?}} o
   * cb: {onFriendText(text,done), onChildText(text,done), onPhase(phase,progress,locked,waiting), onProblem(p,retrying), onProblemCleared()}
   */
  constructor(o) {
    Object.assign(this, { apiKey: o.apiKey, systemPrompt: o.systemPrompt, voice: o.voice, models: o.models, greeting: o.greeting, cb: o.cb });
    this.languages = o.initialLanguages || ARABIC;
    this.contextProvider = o.contextProvider || (() => null);
    this.gate = new SpeechGate({ loudRms: LOUD_RMS });
    this.near = new NearFieldGate(o.pickup || Mode.Normal);
    this.engine = new AudioEngine();
    this.session = null; this.modelIndex = 0; this.resumeHandle = null; this.greeted = false; this.reconnects = 0;
    this.useLanguages = true; this.useTools = true; this.lastProblem = null; this.pending = []; this.needContext = false;
    this.active = false; this.paused = false;
    this.turnActive = false; this.genComplete = false; this.turnBaseEnqueued = 0; this.turnBasePlayed = 0;
    this.lastLoudAt = 0; this.awaitingReplySince = 0; this.turnChunks = 0;
    this.friendBuf = ''; this.childBuf = '';
    this.blockedRun = 0; this.blockedPeak = 0;
    this.last = { phase: null, progress: -1, locked: false, waiting: false };
  }

  async start() {
    if (this.active) return;
    Log.d('LIVE', `بدء المحادثة المباشرة — النماذج المرشحة=[${this.models}]`);
    this.active = true; this.paused = false;
    this.engine.onMic = (c, r) => this.onMic(c, r);
    this.engine.boostDistant = this.near.mode === Mode.Room;
    Log.d('MIC', `حساسية الالتقاط=${this.near.mode.name}`);
    try { await this.engine.start(); }
    catch (err) {
      Log.e('MIC', 'تعذّر تشغيل الميكروفون', err);
      this.active = false;
      this.cb.onProblem(Problem.NoMic, false);
      return;
    }
    if (!this.active) return;
    this.connect();
    this.timer = setInterval(() => Log.guard('STATE', () => this.tick()), 100);
  }

  stop() {
    Log.d('LIVE', 'إيقاف المحادثة المباشرة');
    this.active = false;
    clearInterval(this.timer); clearTimeout(this.retryTimer);
    this.session?.close(); this.session = null;
    this.engine.stop();
  }

  /** إيقاف الاستماع مؤقتًا (زر الميكروفون) */
  setPaused(p) {
    Log.d('MIC', p ? 'الطفل أوقف الميكروفون' : 'الطفل شغّل الميكروفون');
    this.paused = p;
    if (p) { this.gate.reset(); this.near.reset(); }
  }
  isPaused() { return this.paused; }

  /** سؤال مكتوب أو محتوى صفحة الكتاب */
  sendText(text, interrupt = true) {
    if (interrupt && this.turnActive) { this.engine.clearPlayback(); this.endTurn(true); }
    this.awaitingReplySince = now();
    if (this.session?.ready) this.session.sendText(text);
    else { Log.d('LIVE', 'الجلسة غير جاهزة — حفظ النص لإرساله بعد الاتصال'); this.pending.push(text); }
  }

  connect() {
    if (!this.active) return;
    const model = this.models[this.modelIndex];
    if (!model) {
      // لا ننتقل أبدًا لصوت الجهاز
      Log.e('LIVE', 'لم ينجح أي نموذج Live — عرض المشكلة للمستخدم');
      this.giveUp(this.lastProblem || Problem.Unavailable); return;
    }
    this.emitPhase(Phase.Connecting, 0, false, false, true);
    const self = this;
    this.session = new LiveSession({
      tools: this.useTools, apiKey: this.apiKey, model, systemPrompt: this.systemPrompt, voice: this.voice,
      resumeHandle: this.resumeHandle, languages: this.useLanguages ? this.languages : [],
      listener: {
        onReady() {
          self.reconnects = 0;
          if (self.lastProblem) { self.lastProblem = null; self.cb.onProblemCleared(); }
          if (!self.greeted) {
            self.greeted = true; self.needContext = false; self.awaitingReplySince = now();
            self.session?.sendText(self.greeting);
          } else if (self.needContext) {
            self.needContext = false;
            const ctx = self.contextProvider();
            if (ctx) { Log.d('MEMORY', 'جلسة جديدة بعد انقطاع — إرسال ذاكرة الدرس'); self.session?.sendText(ctx); }
          }
          const queued = self.pending.splice(0);
          queued.forEach((t) => { self.awaitingReplySince = now(); self.session?.sendText(t); });
        },
        onAudio(pcm, rate) {
          if (!self.turnActive) {
            const wait = self.awaitingReplySince > 0 ? Math.round(now() - self.awaitingReplySince) : -1;
            Log.d('LIVE', `🔊 بدأ الصديق يتكلم (${rate}Hz) — زمن الانتظار=${wait}ms`);
            self.turnChunks = 0; self.turnActive = true; self.genComplete = false;
            self.turnBaseEnqueued = self.engine.enqueuedFrames; self.turnBasePlayed = self.engine.playedFrames();
            self.flushChildText();
          }
          self.awaitingReplySince = 0; self.turnChunks++;
          self.engine.enqueue(pcm, rate);
        },
        onOutputText(t) { self.friendBuf += t; self.cb.onFriendText(self.friendBuf.trim(), false); },
        onInputText(t) { self.childBuf += t; self.cb.onChildText(self.childBuf.trim(), false); },
        onInterrupted() {
          Log.d('LIVE', `⛔ Gemini أعلن مقاطعة (الطفل تكلّم) عند ${Math.round(self.progress() * 100)}%`);
          self.engine.clearPlayback(); self.endTurn(true);
        },
        onGenerationComplete() {
          const secs = (self.engine.enqueuedFrames - self.turnBaseEnqueued) / 24000;
          Log.d('LIVE', `اكتمل توليد الرد: ${self.turnChunks} مقطع ≈ ${secs.toFixed(1)}ث صوت`);
          self.genComplete = true;
        },
        onTurnComplete() { Log.d('LIVE', 'انتهى دور الصديق (turnComplete)'); self.genComplete = true; self.flushFriendText(''); },
        onResumeHandle(h) { self.resumeHandle = h; },
        onGoAway() { Log.d('LIVE', 'الخادم طلب إعادة الاتصال (goAway)'); self.session?.close(); self.connect(); },
        onClosed(code, reason, wasReady) { self.onClosed(code, reason, wasReady); },
      },
    });
    this.session.connect();
  }

  onClosed(code, reason, wasReady) {
    if (!this.active) return;
    const action = classify(code, reason, wasReady);
    Log.d('LIVE', `قرار بعد الانقطاع: ${action} (code=${code} كانت جاهزة=${wasReady})`);
    switch (action) {
      case CloseAction.Relink: return this.giveUp(Problem.Relink);
      case CloseAction.Quota:
        this.lastProblem = Problem.Quota;
        if (this.modelIndex + 1 < this.models.length) { this.modelIndex++; this.connect(); } else this.giveUp(Problem.Quota);
        return;
      case CloseAction.BadConfig: {
        const r = String(reason).toLowerCase();
        const toolIssue = r.includes('code') || r.includes('tool') || r.includes('function');
        if (this.useTools && (toolIssue || !this.useLanguages || !this.languages.length)) {
          Log.d('LIVE', 'النموذج رفض أداة الحساب — إعادة المحاولة بدونها'); this.useTools = false;
        } else if (this.useLanguages && this.languages.length) {
          Log.d('LIVE', 'الخادم رفض إعداد اللغة — إعادة المحاولة بدونه'); this.useLanguages = false;
        } else this.modelIndex++;
        return this.connect();
      }
      case CloseAction.NextModel: this.modelIndex++; return this.connect();
      case CloseAction.NoInternet: return this.scheduleReconnect(Problem.NoInternet);
      case CloseAction.Reconnect: return this.scheduleReconnect(null);
      case CloseAction.ResumeFailed:
        Log.d('LIVE', 'رُفض استئناف الجلسة — جلسة جديدة بنفس النموذج مع ذاكرة الدرس');
        this.resumeHandle = null; this.needContext = true;
        return this.scheduleReconnect(null);
    }
  }

  /** إعادة الاتصال بانتظار متزايد، مع الحفاظ على سياق الحوار */
  scheduleReconnect(problem) {
    if (!this.active) return;
    this.reconnects++;
    if (this.reconnects > MAX_RECONNECTS) {
      Log.e('LIVE', `فشلت إعادة الاتصال ${MAX_RECONNECTS} مرات`);
      return this.giveUp(problem || Problem.NoInternet);
    }
    const wait = backoffMs(this.reconnects);
    if (problem) { this.lastProblem = problem; this.cb.onProblem(problem, true); }
    Log.d('LIVE', `إعادة الاتصال رقم ${this.reconnects} بعد ${wait}ms`);
    this.engine.clearPlayback();
    if (this.turnActive) this.endTurn(true);
    this.retryTimer = setTimeout(() => Log.guard('LIVE', () => { if (this.active) this.connect(); }), wait);
  }

  /** نتوقف ونطلب من المستخدم إجراءً — بلا تحويل لصوت الجهاز */
  giveUp(problem) {
    Log.e('LIVE', `توقف الاتصال: ${problem} — بانتظار إجراء المستخدم`);
    this.active = false;
    clearInterval(this.timer);
    this.session?.close(); this.session = null;
    this.engine.stop();
    this.cb.onProblem(problem, false);
  }

  /** تبديل لغة الاستماع مع الحفاظ على الحوار */
  setLanguages(langs) {
    if (JSON.stringify(langs) === JSON.stringify(this.languages)) return;
    Log.d('LIVE', `تغيير لغة الاستماع إلى [${langs}]`);
    this.languages = langs;
    if (this.active && this.useLanguages) { this.session?.close(); this.connect(); }
  }

  endTurn(interrupted) { this.turnActive = false; this.genComplete = false; this.flushFriendText(interrupted ? '…' : ''); }
  flushFriendText(suffix) {
    const t = this.friendBuf.trim();
    if (t) { this.cb.onFriendText(t + suffix, true); Log.d('TEXT', `الصديق: ${t}${suffix}`); }
    this.friendBuf = '';
  }
  flushChildText() {
    const t = this.childBuf.trim();
    if (t) { this.cb.onChildText(t, true); Log.d('TEXT', `الطفل: ${t}`); }
    this.childBuf = '';
  }

  progress() {
    const total = this.engine.enqueuedFrames - this.turnBaseEnqueued;
    if (total <= 0) return 0;
    return Math.min(1, Math.max(0, (this.engine.playedFrames() - this.turnBasePlayed) / total));
  }
  locked() { return isLocked(this.turnActive, this.genComplete, this.progress()); }

  onMic(chunk, rms) {
    if (!this.active || this.paused) return;
    const s = this.session; if (!s) return;
    const playing = this.engine.isPlaying();
    // (1) بوابة المسافة: صوت من يتكلم بعيدًا يصبح صمتًا قبل أي شيء آخر
    const wasOpen = this.near.isOpen;
    for (const o of this.near.process(chunk, rms, playing)) {
      if (o.blocked) { this.blockedRun++; if (rms > this.blockedPeak) this.blockedPeak = rms; }
      else if (this.blockedRun > 0) {
        if (this.blockedRun >= 5) Log.d('NEAR', `حُجب صوت بعيد ${this.blockedRun * 100}ms (أعلاه=${Math.round(this.blockedPeak)} الحد=${Math.round(this.near.threshold())})`);
        this.blockedRun = 0; this.blockedPeak = 0;
      }
      this.onNearChunk(s, o.pcm, o.rms, playing);
    }
    if (!wasOpen && this.near.isOpen) Log.d('NEAR', `صوت قريب مرّ: مستوى=${Math.round(rms)} الحد=${Math.round(this.near.threshold())} صوت الطفل=${Math.round(this.near.childLevel)}`);
  }

  onNearChunk(s, chunk, rms, playing) {
    const d = this.gate.onChunk(chunk, rms, this.locked(), playing);
    if (d.childStartedDuringLock) Log.d('GATE', `الطفل تكلّم أثناء الشرح عند ${Math.round(this.progress() * 100)}% — حُفظ كلامه حتى 75%`);
    if (d.flushedChunks > 0) { Log.d('GATE', `فُتح القفل — إرسال كلام الطفل المحفوظ (${d.flushedChunks * 100}ms)`); this.lastLoudAt = now(); }
    d.toSend.forEach((c) => s.sendAudio(c));
    if (d.toSend.length && rms > LOUD_RMS && !playing) { this.lastLoudAt = now(); this.awaitingReplySince = this.lastLoudAt; }
  }

  tick() {
    const t = now();
    const playing = this.engine.isPlaying();
    if (this.turnActive && this.genComplete && !playing) this.endTurn(false);
    const locked = this.locked();
    const prog = this.turnActive ? this.progress() : 0;
    const ready = this.session?.ready === true;
    const phase = !ready ? Phase.Connecting
      : this.paused && !playing ? Phase.Paused
      : playing || this.turnActive ? Phase.Speaking
      : t - this.lastLoudAt < 500 ? Phase.ChildTalking
      : this.awaitingReplySince > 0 && t - this.awaitingReplySince < 15000 ? Phase.Thinking
      : Phase.Listening;
    this.emitPhase(phase, prog, locked, this.gate.heardDuringLock && locked);
  }

  emitPhase(phase, progress, locked, waiting, force = false) {
    const l = this.last;
    if (!force && phase === l.phase && locked === l.locked && waiting === l.waiting && Math.abs(progress - l.progress) < 0.02) return;
    if (phase !== l.phase || locked !== l.locked || waiting !== l.waiting) {
      Log.d('STATE', `الحالة=${phase} قفل=${locked} ينتظر=${waiting} تقدم=${Math.round(progress * 100)}%`);
    }
    this.last = { phase, progress, locked, waiting };
    this.cb.onPhase(phase, progress, locked, waiting);
  }
}
