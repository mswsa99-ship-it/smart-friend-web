// بوابة المسافة — مطابقة لـ NearFieldGate.kt: لا يصل لـ Gemini إلا صوت من يتكلم قرب الجهاز.
// 1) حد أدنى ثابت من أول ثانية (عادي 1500، قريب جدًا 2200) لا يمر ما تحته ولا يُتعلَّم منه.
// 2) حد نسبي من صوت الطفل المتعلَّم من الكلام الذي مرّ فقط.
// 3) لا تُفتح إلا بمقطعين متتاليين عاليين (200ms). 4) ترسل 300ms قبلها، وتبقى مفتوحة 600ms.

export const Mode = Object.freeze({
  Near: { name: 'Near', floor: 2200, ratio: 0.6 },
  Normal: { name: 'Normal', floor: 1500, ratio: 0.45 },
  Room: { name: 'Room', floor: 0, ratio: 0 },
});
export const modeFrom = (s) => Mode[s] || Mode.Normal;

export const OPEN_RUN = 2, HANG_CHUNKS = 6, LOOKBACK_CHUNKS = 3, TARGET_LEVEL = 2500, MAX_GAIN = 3;

export function amplify(pcm, gain) {
  if (gain <= 1.0001) return pcm;
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.trunc(pcm[i] * gain)));
  return out;
}

export class NearFieldGate {
  constructor(mode = Mode.Normal) {
    this.mode = mode;
    this.childLevel = 0;
    this.hang = 0; this.run = 0; this.lookback = [];
  }
  threshold() { return Math.max(this.mode.floor, this.childLevel * this.mode.ratio); }
  get isOpen() { return this.hang > 0; }

  /** @returns {{pcm: Int16Array, rms: number, blocked: boolean}[]} */
  process(chunk, rms, playing) {
    if (this.mode === Mode.Room) return [{ pcm: chunk, rms, blocked: false }];
    const loud = rms >= this.threshold();
    const gain = this.gain();
    const pass = (c, r) => ({ pcm: amplify(c, gain), rms: r * gain, blocked: false });

    if (this.hang > 0) {
      if (loud) { this.hang = HANG_CHUNKS; if (!playing) this.learn(rms); } else this.hang--;
      return [pass(chunk, rms)];
    }
    this.run = loud ? this.run + 1 : 0;
    if (this.run >= OPEN_RUN) {
      const out = this.lookback.map(([c, r]) => pass(c, r));
      out.push(pass(chunk, rms));
      this.lookback = []; this.run = 0; this.hang = HANG_CHUNKS;
      if (!playing) this.learn(rms);
      return out;
    }
    this.lookback.push([chunk, rms]);
    while (this.lookback.length > LOOKBACK_CHUNKS) this.lookback.shift();
    return [{ pcm: new Int16Array(chunk.length), rms: 0, blocked: true }];
  }

  learn(rms) {
    if (this.childLevel === 0) { this.childLevel = rms; return; }
    const r = Math.min(rms, this.childLevel * 2);
    this.childLevel = r > this.childLevel ? this.childLevel * 0.8 + r * 0.2 : this.childLevel * 0.97 + r * 0.03;
  }
  gain() { return this.childLevel <= 0 ? 1 : Math.min(MAX_GAIN, Math.max(1, TARGET_LEVEL / this.childLevel)); }
  reset() { this.hang = 0; this.run = 0; this.lookback = []; }
}

export function rms(pcm) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return pcm.length ? Math.sqrt(sum / pcm.length) : 0;
}
