// يلتقط صوت الميكروفون ويحوّله إلى 16kHz بمقاطع 100ms (1600 عينة Int16) — يعمل في خيط الصوت
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.t = 0; this.sum = 0; this.n = 0;
    this.buf = new Int16Array(1600); this.len = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.n++; this.t += 1;
      if (this.t >= this.ratio) {
        this.t -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.sum / this.n));
        this.sum = 0; this.n = 0;
        this.buf[this.len++] = v < 0 ? v * 32768 : v * 32767;
        if (this.len === 1600) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Int16Array(1600); this.len = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
