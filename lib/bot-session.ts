/** Serialize device bot mutations and refuse to overwrite a newer local session.
 * Web Locks cover tabs where supported; the version check also catches edits while
 * a request is in flight. No automatic retry: a trade must not be submitted twice. */
const running = new Set<string>();
export function subscribeBotSessions(sync: () => void): () => void {
  window.addEventListener('storage', sync);
  window.addEventListener('imf:bot-session', sync);
  return () => { window.removeEventListener('storage', sync); window.removeEventListener('imf:bot-session', sync); };
}
export async function botSessionAction<T>(key: string, expected: unknown | undefined, work: (save: (value: unknown) => void) => Promise<T>): Promise<T> {
  if (running.has(key)) throw new Error('این ربات هنوز در حال پردازش است؛ پس از پایان دوباره تلاش کنید.');
  running.add(key);
  const run = async () => {
    const before = localStorage.getItem(key);
    if (expected !== undefined && JSON.stringify(before ? JSON.parse(before) : null) !== JSON.stringify(expected)) {
      throw new Error('وضعیت ربات تغییر کرده است؛ صفحه را تازه کنید و دوباره تلاش کنید.');
    }
    return work((value) => {
      if (!value || typeof value !== 'object') throw new Error('پاسخ ربات معتبر نیست؛ وضعیت قبلی حفظ شد.');
      if (localStorage.getItem(key) !== before) throw new Error('جلسه در صفحه دیگری تغییر کرد؛ پاسخ قدیمی ذخیره نشد. صفحه را تازه کنید.');
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        throw new Error('نتیجه ربات ذخیره نشد؛ فضای مرورگر را بررسی کنید و از اطلاعات پشتیبان بگیرید.');
      }
      window.dispatchEvent(new CustomEvent('imf:bot-session'));
    });
  };
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(`imf:bot:${key}`, { ifAvailable: true }, (lock) => {
        if (!lock) throw new Error('این ربات در صفحه دیگری مشغول است؛ کمی بعد دوباره تلاش کنید.');
        return run();
      });
    }
    return await run();
  } finally {
    running.delete(key);
  }
}
