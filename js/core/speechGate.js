// بوابة الـ 75% — مطابقة لـ SpeechGate.kt (المقاطع Int16Array بطول 100ms)
// - أثناء القفل: يُحفظ صوت الطفل ولا يُرسل؛ إن تكلّم فعلًا (3 مقاطع عالية = 300ms) نتذكّر ذلك.
// - عند فتح القفل: نرسل ما قاله ثم نكمل البث. إن لم يتكلم نحتفظ بآخر نصف ثانية فقط.
// - مقاومة الصدى: لا يُعتبر الصوت كلامًا للطفل إلا إذا كان أعلى من صدى الصديق بوضوح.

export const UNLOCK_AT = 0.75;
export const ECHO_RATIO = 2.5;

export function isLocked(turnActive, generationComplete, progress) {
  return turnActive && (!generationComplete || progress < UNLOCK_AT);
}

export class SpeechGate {
  constructor({ loudRms = 1100, loudChunksToTrigger = 3, maxHeldChunks = 80, keepChunksWhenSilent = 5 } = {}) {
    Object.assign(this, { loudRms, loudChunksToTrigger, maxHeldChunks, keepChunksWhenSilent });
    this.held = [];
    this.loudRun = 0;
    this.echoFloor = 0;
    this.heardDuringLock = false;
  }

  /** @returns {{toSend: Int16Array[], childStartedDuringLock: boolean, flushedChunks: number}} */
  onChunk(chunk, rms, locked, playing = false) {
    if (playing && this.echoFloor === 0) this.echoFloor = Math.max(1, rms);
    const threshold = playing ? Math.max(this.loudRms, this.echoFloor * ECHO_RATIO) : this.loudRms;
    const loud = rms > threshold;
    if (playing && !loud) this.echoFloor = this.echoFloor * 0.85 + rms * 0.15;
    if (locked) {
      if (this.held.length < this.maxHeldChunks) this.held.push(chunk);
      this.loudRun = loud ? this.loudRun + 1 : 0;
      let started = false;
      if (this.loudRun >= this.loudChunksToTrigger && !this.heardDuringLock) { this.heardDuringLock = true; started = true; }
      if (!this.heardDuringLock && this.held.length > this.keepChunksWhenSilent) this.held = this.held.slice(-this.keepChunksWhenSilent);
      return { toSend: [], childStartedDuringLock: started, flushedChunks: 0 };
    }
    const out = [];
    let flushed = 0;
    if (this.heardDuringLock && this.held.length) { out.push(...this.held); flushed = this.held.length; }
    this.held = []; this.heardDuringLock = false; this.loudRun = 0;
    // بعد 75% والصديق ما زال يتكلم: الصدى يُستبدل بصمت، وصوت الطفل الأعلى منه يمر كما هو
    const isEcho = playing && rms <= this.echoFloor * ECHO_RATIO;
    out.push(isEcho ? new Int16Array(chunk.length) : chunk);
    return { toSend: out, childStartedDuringLock: false, flushedChunks: flushed };
  }

  reset() { this.held = []; this.heardDuringLock = false; this.loudRun = 0; }
}
