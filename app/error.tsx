'use client';
import Link from 'next/link';

// Any page that throws while rendering lands here, inside the app's own frame (navigation still
// works), with the error text shown — a screenshot of it is what it takes to fix the cause.
// Without this file Next shows its own English full-page «This page couldn't load».
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="wrap">
      <section className="panel learn-lesson" role="alert" data-testid="page-error">
        <h2>این صفحه با خطا روبه‌رو شد</h2>
        <p>داده‌های شما سالم و ذخیره است. دوباره امتحان کنید؛ اگر تکرار شد، از همین پیام عکس بفرستید:</p>
        <pre className="learn-err" dir="ltr">
          {String(error?.message || error).slice(0, 400)}
          {error?.digest ? `\ndigest: ${error.digest}` : ''}
        </pre>
        <div className="learn-nav">
          <Link className="fin-mini ghost" href="/">
            خانه
          </Link>
          <button className="btn run" onClick={() => reset()}>
            تلاش دوباره
          </button>
        </div>
      </section>
    </div>
  );
}
