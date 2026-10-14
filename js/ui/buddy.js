// شخصية «صديقك الذكي» — نفس رسمة تطبيق أندرويد (Buddy.kt): كرة زرقاء بهوائيين نجميين،
// ترمش وتطفو، تفتح فمها عند الكلام، تنظر للأعلى عند التفكير، ودوائر نابضة عند الاستماع.
const C = { ink: '#2D3250', body: '#6C9DFF', light: '#A9C6FF', mint: '#3CCB97', coral: '#FF8A7A', lav: '#A897FF', sun: '#FFB547' };
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

function star(g, x, y, radius) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? radius : radius * 0.5;
    const a = (i * 36 - 90) * Math.PI / 180;
    const px = x + rr * Math.cos(a), py = y + rr * Math.sin(a);
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath(); g.fillStyle = C.sun; g.fill();
}

/** يرسم الصديق على سياق رسم بحجم s، في لحظة t (ثوانٍ) وبمزاج mood */
export function drawBuddy(g, s, mood = 'Happy', t = 0, w = s, h = s) {
  const float = (Math.sin(t * Math.PI / 1.9) + 1) / 2;
  const blinkPhase = (t % 3.8) / 3.8;
  const blink = blinkPhase > 0.908 && blinkPhase < 0.968 ? 0.08 : 1;
  const talk = (Math.sin(t * Math.PI / 0.17) + 1) / 2;
  const pulse = (t % 1.5) / 1.5;
  const r = s * 0.33;
  const cx = w / 2, cy = h * 0.56 + (float - 0.5) * s * 0.05;

  g.fillStyle = rgba(C.ink, 0.08 + 0.04 * (1 - float));
  g.beginPath(); g.ellipse(cx, h * 0.955, r * 0.8, s * 0.025, 0, 0, Math.PI * 2); g.fill();

  if (mood === 'Listening') {
    for (let k = 0; k < 2; k++) {
      const p = (pulse + k * 0.5) % 1;
      g.strokeStyle = rgba(C.mint, (1 - p) * 0.55); g.lineWidth = s * 0.022;
      g.beginPath(); g.arc(cx, cy, r * (1.05 + p * 0.45), 0, Math.PI * 2); g.stroke();
    }
  }
  const wobble = (float - 0.5) * 10 + (mood === 'Speaking' ? (talk - 0.5) * 8 : 0);
  for (const ang of [-28 + wobble, 28 - wobble]) {
    const a = (ang - 90) * Math.PI / 180;
    const bx = cx + r * 0.55 * Math.cos(a), by = cy + r * 0.55 * Math.sin(a);
    const tx = cx + r * 1.32 * Math.cos(a), ty = cy + r * 1.32 * Math.sin(a);
    g.strokeStyle = C.body; g.lineWidth = s * 0.028; g.lineCap = 'round';
    g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke();
    star(g, tx, ty, s * 0.055);
  }
  const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.45, 0, cx - r * 0.35, cy - r * 0.45, r * 1.5);
  grad.addColorStop(0, C.light); grad.addColorStop(1, C.body);
  g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(cx - r * 0.37, cy - r * 0.64, r * 0.25, r * 0.14, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.ellipse(cx, cy + r * 0.525, r * 0.55, r * 0.375, 0, 0, Math.PI * 2); g.fill();

  const eyeR = r * 0.21, eyeY = cy - r * 0.1;
  const look = mood === 'Thinking' ? [eyeR * 0.3, -eyeR * 0.38] : mood === 'Listening' ? [0, 0] : [0, eyeR * 0.12];
  const open = mood === 'Happy' ? 0.55 : blink;
  for (const side of [-1, 1]) {
    const ex = cx + side * r * 0.38;
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(ex, eyeY, eyeR, eyeR * open, 0, 0, Math.PI * 2); g.fill();
    if (open > 0.3) {
      const pr = eyeR * (mood === 'Listening' ? 0.62 : 0.55);
      g.fillStyle = C.ink; g.beginPath(); g.arc(ex + look[0], eyeY + look[1], pr * Math.min(1, open), 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + look[0] - pr * 0.32, eyeY + look[1] - pr * 0.32, pr * 0.32, 0, Math.PI * 2); g.fill();
    }
  }
  g.fillStyle = rgba(C.coral, 0.45);
  for (const side of [-1, 1]) { g.beginPath(); g.arc(cx + side * r * 0.62, cy + r * 0.2, r * 0.12, 0, Math.PI * 2); g.fill(); }

  const mx = cx, my = cy + r * 0.38;
  g.fillStyle = C.ink; g.strokeStyle = C.ink;
  if (mood === 'Speaking') {
    const mh = r * (0.08 + 0.2 * talk);
    g.beginPath(); g.ellipse(mx, my, r * 0.17, mh / 2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.coral; g.beginPath(); g.ellipse(mx, my + mh * 0.22, r * 0.1, mh * 0.22, 0, 0, Math.PI * 2); g.fill();
  } else if (mood === 'Listening') {
    g.beginPath(); g.arc(mx, my, r * 0.075, 0, Math.PI * 2); g.fill();
  } else if (mood === 'Thinking') {
    g.lineWidth = r * 0.07; g.lineCap = 'round';
    g.beginPath(); g.moveTo(mx - r * 0.12, my); g.lineTo(mx + r * 0.14, my - r * 0.04); g.stroke();
  } else {
    g.lineWidth = r * 0.075; g.lineCap = 'round';
    g.beginPath(); g.ellipse(mx, my - r * 0.06, r * 0.26, r * 0.18, 0, 15 * Math.PI / 180, 165 * Math.PI / 180); g.stroke();
  }
  if (mood === 'Thinking') {
    for (let k = 0; k < 3; k++) {
      const a = Math.min(1, Math.max(0, pulse * 3 - k));
      g.fillStyle = rgba(C.lav, 0.3 + 0.7 * a);
      g.beginPath(); g.arc(cx + r * (0.95 + k * 0.28), cy - r * (0.9 + k * 0.32), s * (0.025 + k * 0.012), 0, Math.PI * 2); g.fill();
    }
  }
}

/** صديق متحرك داخل عنصر canvas */
export class Buddy {
  constructor(size = 120, mood = 'Happy') {
    this.size = size; this.mood = mood;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.el = document.createElement('canvas');
    this.el.width = size * dpr; this.el.height = size * dpr;
    this.el.style.width = this.el.style.height = `${size}px`;
    this.el.setAttribute('aria-hidden', 'true');
    this.g = this.el.getContext('2d'); this.g.scale(dpr, dpr);
    this.t0 = performance.now();
    const loop = () => {
      if (!this.el.isConnected && this.started) return; // أُزيل من الصفحة
      this.started = true;
      this.g.clearRect(0, 0, size, size);
      drawBuddy(this.g, size, this.mood, (performance.now() - this.t0) / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  setMood(m) { this.mood = m; }
}

let miniUrl = null;
/** صورة صغيرة ثابتة للصديق بجانب رسائله */
export function miniBuddyUrl() {
  if (miniUrl) return miniUrl;
  const c = document.createElement('canvas'); c.width = c.height = 102;
  drawBuddy(c.getContext('2d'), 102, 'Happy', 0.95);
  return (miniUrl = c.toDataURL('image/png'));
}
