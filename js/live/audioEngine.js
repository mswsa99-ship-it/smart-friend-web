// الميكروفون والسماعة للمحادثة المباشرة — مقابل AudioEngine.kt
// - يلتقط صوت الطفل 16kHz مع إلغاء الصدى، وبلا تضخيم تلقائي (إلا في وضع «الغرفة كلها»).
// - يشغّل صوت Gemini (24kHz) بسلاسة ويعرف كم تم تشغيله لحساب نسبة الشرح (قاعدة 75%).
import * as Log from '../services/debugLog.js';
import { rms } from '../core/nearGate.js';

let sharedCtx = null;
/** يُستدعى داخل ضغطة المستخدم (شرط سفاري لتشغيل الصوت) */
export function audioContext() {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    const AC = window.AudioContext || window.webkitAudioContext;
    sharedCtx = new AC({ latencyHint: 'interactive' });
  }
  if (sharedCtx.state !== 'running') sharedCtx.resume().catch(() => {});
  return sharedCtx;
}
export const audioReady = () => !!sharedCtx && sharedCtx.state === 'running';

export class AudioEngine {
  constructor() {
    this.onMic = null;
    this.boostDistant = false;
    this.running = false;
    this.enqueuedFrames = 0;   // كل ما وصل من Gemini (بإطارات 24kHz)
    this.base = 0;             // ما شُغّل من مقاطع انتهت
    this.segments = [];        // [{start, frames, src}]
    this.nextTime = 0;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    const ctx = this.ctx = audioContext();
    try { await ctx.resume(); } catch {}
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        // لا مخفّض ضوضاء: قد يشوّه كلام الطفل. ولا تضخيم: يرفع أصوات البعيدين
        noiseSuppression: false,
        autoGainControl: this.boostDistant,
      },
    });
    if (!this.running) { this.stream.getTracks().forEach((t) => t.stop()); return; }
    await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
    this.src = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'pcm-capture');
    this.mute = ctx.createGain(); this.mute.gain.value = 0;
    this.src.connect(this.node); this.node.connect(this.mute); this.mute.connect(ctx.destination);
    let peak = 0, count = 0;
    this.node.port.onmessage = (ev) => {
      if (!this.running) return;
      const chunk = ev.data;
      const r = rms(chunk);
      if (r > peak) peak = r;
      if (++count % 30 === 0) { Log.d('MIC', `أعلى مستوى صوت آخر 3ث = ${Math.round(peak)}`); peak = 0; }
      Log.guard('MIC', () => this.onMic?.(chunk, r));
    };
    const s = this.stream.getAudioTracks()[0]?.getSettings?.() || {};
    Log.d('MIC', `بدء التسجيل: معدل=${ctx.sampleRate}Hz حالة=${ctx.state} إلغاء الصدى=${s.echoCancellation} تضخيم=${s.autoGainControl} (مطلوب=${this.boostDistant}) مخفّض=${s.noiseSuppression}`);
  }

  /** يضيف صوتًا من Gemini لقائمة التشغيل */
  enqueue(pcm, rate = 24000) {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const buf = ctx.createBuffer(1, pcm.length, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    const start = Math.max(ctx.currentTime + 0.04, this.nextTime);
    src.start(start);
    this.nextTime = start + pcm.length / rate;
    const frames = Math.round(pcm.length * 24000 / rate);
    this.segments.push({ start, frames, src, rate });
    this.enqueuedFrames += frames;
  }

  /** كل ما شُغّل حتى الآن (بإطارات 24kHz) */
  playedFrames() {
    const now = this.ctx?.currentTime ?? 0;
    let partial = 0;
    while (this.segments.length && now >= this.segments[0].start + this.segments[0].frames / 24000) {
      this.base += this.segments.shift().frames;
    }
    for (const s of this.segments) partial += Math.max(0, Math.min(s.frames, Math.floor((now - s.start) * 24000)));
    return this.base + partial;
  }

  isPlaying() { return this.enqueuedFrames - this.playedFrames() > 480; }

  /** إيقاف الكلام فورًا (عند مقاطعة الطفل) */
  clearPlayback() {
    const played = this.playedFrames();
    Log.d('SPK', `إيقاف الكلام فورًا (بقي ${this.enqueuedFrames - played} إطار)`);
    this.segments.forEach((s) => { try { s.src.stop(); } catch {} });
    this.segments = [];
    this.base = played;
    this.enqueuedFrames = played;
    this.nextTime = 0;
  }

  stop() {
    if (!this.running) return;
    Log.d('MIC', 'إيقاف الميكروفون والسماعة');
    this.running = false;
    this.segments.forEach((s) => { try { s.src.stop(); } catch {} });
    this.segments = [];
    try { this.src?.disconnect(); this.node?.disconnect(); this.mute?.disconnect(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
