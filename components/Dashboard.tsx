'use client';
import { useCallback, useEffect, useState } from 'react';
import RatesBoard from './RatesBoard';
import RiskMatrix from './RiskMatrix';
import CryptoScreener from './CryptoScreener';
import StockScreener from './StockScreener';
import PortfolioPanel from './PortfolioPanel';
import TelegramPanel from './TelegramPanel';
import type { Snapshot } from '@/lib/types';

const POLL_MS = 60_000;

export default function Dashboard({ initial, botUsername }: { initial: Snapshot | null; botUsername: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/snapshot', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSnap(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!initial) load();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [initial, load]);

  return (
    <>
      <nav className="nav" aria-label="بخش‌ها">
        <div className="wrap nav-inner">
          <a href="#board">تابلو</a>
          <a href="#risk">ریسک</a>
          <a href="#crypto">کریپتو</a>
          <a href="#stocks">بورس</a>
          <a href="#portfolio">سبد</a>
          <a href="#telegram">تلگرام</a>
          <span className="spacer" />
          <button className="refresh" onClick={load} disabled={busy}>
            {busy ? 'در حال دریافت…' : 'به‌روزرسانی'}
          </button>
        </div>
      </nav>

      {!snap ? (
        <div className="wrap">
          <p className="banner" role="alert">
            {error ? `داده‌ها دریافت نشد: ${error}. اتصال منابع را با /api/diag بررسی کنید.` : 'در حال دریافت داده‌ها…'}
          </p>
        </div>
      ) : (
        <main>
          <RatesBoard snap={snap} />
          {error ? (
            <div className="wrap">
              <p className="banner" role="alert">آخرین تلاش به‌روزرسانی ناموفق بود ({error}). داده‌های نمایش‌داده‌شده مربوط به آخرین دریافت موفق است.</p>
            </div>
          ) : null}
          <RiskMatrix risk={snap.risk} />
          <CryptoScreener crypto={snap.crypto} />
          <StockScreener stocks={snap.stocks} />
          <PortfolioPanel snap={snap} />
          <TelegramPanel botUsername={botUsername} />

          <section className="block" id="method">
            <div className="wrap">
              <details className="surface method">
                <summary>روش محاسبه و محدودیت‌ها</summary>
                <p>
                  <b>ریسک:</b> بازده لگاریتمی هر افق با توزیع نرمال مدل می‌شود؛ روند تاریخی به‌صورت محافظه‌کارانه نصف می‌شود و نوسان کوتاه‌مدت با EWMA (λ=۰٫۹۴) وزن می‌گیرد. ریسک خرید ترکیب احتمال افت بیش از آستانه افق (۲٪ روزانه تا ۲۵٪ سالانه)، گرانی نسبت به میانگین (RSI و z-score) و بیشینه افت اخیر است. حباب سکه و طلا به ریسک خرید آن‌ها اضافه می‌شود.
                </p>
                <p>
                  <b>تاریخچه:</b> تا وقتی تاریخچه واقعی TGJU در پایگاه داده جمع شود، بازده روزانه از داده‌های جایگزین می‌آید: تتر/ریال نوبیتکس برای دلار و PAXG×تتر برای طلا و سکه. شاخص بورس جایگزین ندارد و از روز استقرار جمع می‌شود.
                </p>
                <p>
                  <b>غربال‌ها:</b> رتبه‌بندی نسبی مومنتوم، روند، گردش معاملات و نزدیکی به سقف است؛ پیش‌بینی قیمت نیست و در بازارهای نزولی یا خبری کارایی آن کم می‌شود.
                </p>
                <p>
                  <b>سبد:</b> وزن‌های پایه و همبستگی‌ها فرض قابل‌ویرایش در <code>lib/engine/portfolio.ts</code> هستند. این صفحه مشاوره سرمایه‌گذاری نیست و جایگزین تصمیم آگاهانه شما نمی‌شود.
                </p>
              </details>
            </div>
          </section>
          <footer className="foot">
            <div className="wrap">منابع: TGJU، Gold API، نوبیتکس، BrsApi، CoinGecko. تحلیل‌ها الگوریتمی‌اند و توصیه خرید یا فروش نیستند.</div>
          </footer>
        </main>
      )}
    </>
  );
}
