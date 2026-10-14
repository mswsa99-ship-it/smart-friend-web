// حماية الرقم السري: بعد 5 محاولات خاطئة يُقفل دقيقة كاملة، والحالة محفوظة (لا تُصفَّر بإعادة فتح الصفحة)
export const MAX_TRIES = 5;
export const LOCK_MS = 60_000;

export function afterWrongPin(st, now) {
  const fails = (st?.fails || 0) + 1;
  return fails >= MAX_TRIES ? { fails: 0, until: now + LOCK_MS } : { fails, until: st?.until || 0 };
}
export const isLocked = (st, now) => !!st && now < (st.until || 0);
export const secondsLeft = (st, now) => Math.max(0, Math.ceil(((st?.until || 0) - now) / 1000));
