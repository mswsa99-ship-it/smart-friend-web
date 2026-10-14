// حاسبة دقيقة يستدعيها Gemini أثناء المحادثة الصوتية — مطابقة لـ Calculator.kt
// كسور دقيقة (BigInt)، قوى كبيرة، أرقام عربية، × ÷ √. أي خطأ يعود نصًا يبدأ بـ «خطأ».

class CalcError extends Error {}

const abs = (n) => (n < 0n ? -n : n);
const gcd = (a, b) => { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; };

function rat(n, d = 1n) {
  if (d === 0n) throw new CalcError('القسمة على صفر غير ممكنة');
  let g = gcd(n, d); if (g === 0n) g = 1n;
  const s = d < 0n ? -1n : 1n;
  return { n: (n / g) * s, d: abs(d / g) };
}
const real = (v) => ({ real: v });
const isRat = (x) => x.real === undefined;
const toNum = (x) => (isRat(x) ? Number(x.n) / Number(x.d) : x.real);

function op(a, b, c) {
  if (isRat(a) && isRat(b)) {
    switch (c) {
      case '+': return rat(a.n * b.d + b.n * a.d, a.d * b.d);
      case '-': return rat(a.n * b.d - b.n * a.d, a.d * b.d);
      case '*': return rat(a.n * b.n, a.d * b.d);
      default: return rat(a.n * b.d, a.d * b.n);
    }
  }
  const x = toNum(a), y = toNum(b);
  if (c === '/' && y === 0) throw new CalcError('القسمة على صفر غير ممكنة');
  return real(c === '+' ? x + y : c === '-' ? x - y : c === '*' ? x * y : x / y);
}

function pow(a, b) {
  if (isRat(a) && isRat(b) && b.d === 1n && abs(b.n) <= 10000n) {
    const e = b.n;
    if (e >= 0n) return rat(a.n ** e, a.d ** e);
    if (a.n === 0n) throw new CalcError('القسمة على صفر غير ممكنة');
    return rat(a.d ** -e, a.n ** -e);
  }
  return real(Math.pow(toNum(a), toNum(b)));
}

function isqrt(n) {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.floor(n.toString(2).length / 2) + 1);
  for (;;) { const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; }
}

function sqrt(a) {
  if (isRat(a)) {
    if (a.n < 0n) throw new CalcError('لا يوجد جذر تربيعي لعدد سالب');
    const rn = isqrt(a.n), rd = isqrt(a.d);
    if (rn * rn === a.n && rd * rd === a.d) return rat(rn, rd);
  }
  const v = toNum(a);
  if (v < 0) throw new CalcError('لا يوجد جذر تربيعي لعدد سالب');
  return real(Math.sqrt(v));
}

/** قسمة عشرية بعدد منازل محدد (تقريب لأقرب) */
function decimal(n, d, places) {
  const neg = (n < 0n) !== (d < 0n);
  n = abs(n); d = abs(d);
  const scale = 10n ** BigInt(places);
  let q = (n * scale * 2n + d) / (2n * d);
  let s = q.toString().padStart(places + 1, '0');
  let out = places ? `${s.slice(0, -places)}.${s.slice(-places)}` : s;
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '');
  return (neg && out !== '0' ? '-' : '') + out;
}

/** هل الكسر ينتهي بعدد محدود من المنازل؟ (المقام من 2 و5 فقط) */
function terminates(d) {
  d = abs(d); while (d % 2n === 0n) d /= 2n; while (d % 5n === 0n) d /= 5n; return d === 1n;
}

function format(v) {
  if (isRat(v)) {
    if (v.d === 1n) return v.n.toString();
    const frac = `${v.n}/${v.d}`;
    return terminates(v.d) ? `${frac} = ${decimal(v.n, v.d, 40)}` : `${frac} ≈ ${decimal(v.n, v.d, 10)}`;
  }
  if (!Number.isFinite(v.real)) throw new CalcError('النتيجة غير معرّفة');
  return String(Number(v.real.toFixed(10)));
}

function normalize(s) {
  let out = '';
  for (const c of String(s)) {
    const code = c.codePointAt(0);
    if (code >= 0x660 && code <= 0x669) out += String(code - 0x660);
    else if (code >= 0x6f0 && code <= 0x6f9) out += String(code - 0x6f0);
    else if (c === '٫') out += '.';
    else if (c === '٬' || c === ',') continue;
    else if ('×xX·'.includes(c)) out += '*';
    else if (c === '÷' || c === ':') out += '/';
    else if (c === '−' || c === '–') out += '-';
    else if (c === '√') out += 'sqrt';
    else out += c;
  }
  return out.replaceAll('جذر', 'sqrt').replaceAll('**', '^').replace(/\s+/g, '');
}

class Parser {
  constructor(s) { this.s = s; this.i = 0; }
  atEnd() { return this.i >= this.s.length; }
  peek() { return this.s[this.i] ?? ''; }
  expr() {
    let v = this.term();
    while (this.peek() === '+' || this.peek() === '-') { const c = this.s[this.i++]; v = op(v, this.term(), c); }
    return v;
  }
  term() {
    let v = this.unary();
    while (this.peek() === '*' || this.peek() === '/') { const c = this.s[this.i++]; v = op(v, this.unary(), c); }
    return v;
  }
  unary() {
    if (this.peek() === '-') { this.i++; return op(rat(0n), this.unary(), '-'); }
    if (this.peek() === '+') { this.i++; return this.unary(); }
    return this.power();
  }
  power() {
    const base = this.postfix();
    if (this.peek() === '^') { this.i++; return pow(base, this.unary()); }
    return base;
  }
  postfix() {
    let v = this.primary();
    while (this.peek() === '%') { this.i++; v = op(v, rat(100n), '/'); }
    return v;
  }
  primary() {
    if (this.s.startsWith('sqrt', this.i)) {
      this.i += 4;
      return sqrt(this.peek() === '(' ? this.primary() : this.unary());
    }
    if (this.peek() === '(') {
      this.i++;
      const v = this.expr();
      if (this.peek() !== ')') throw new CalcError('قوس ناقص');
      this.i++;
      return v;
    }
    const start = this.i;
    while (/[0-9.]/.test(this.peek())) this.i++;
    if (start === this.i) throw new CalcError('لم أفهم العملية');
    const text = this.s.slice(start, this.i);
    if (!/^\d*\.?\d*$/.test(text) || text === '.') throw new CalcError('رقم غير صحيح');
    const [ip, fp = ''] = text.split('.');
    return rat(BigInt((ip || '0') + fp), 10n ** BigInt(fp.length));
  }
}

export function evaluate(expression) {
  try {
    const p = new Parser(normalize(expression));
    const v = p.expr();
    if (!p.atEnd()) throw new CalcError('لم أفهم العملية');
    return format(v);
  } catch (e) {
    return `خطأ: ${e instanceof CalcError ? e.message : 'لم أفهم العملية'}`;
  }
}
