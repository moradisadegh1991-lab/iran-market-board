'use client';
import { api } from '@/lib/api';
import { useEffect, useRef, useState } from 'react';
import { advisorSummary } from '@/lib/finance/calc';
import type { FinanceData } from '@/lib/finance/model';
import { PageHead } from '../../ui';
import { useFinance, WithBook } from '../FinanceProvider';
import { Card } from '../kit';
import Markdown from '../Markdown';
import { QUICK_QUESTIONS } from './HomeView';

const SECRET_KEY = 'imf.advisor.secret';
const CHAT_KEY = 'imf.advisor.chat';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // private mode: the chat simply won't survive a reload
  }
};

const MORE_QUESTIONS = [
  'اگر درآمدم ۳ ماه قطع شود، چه کنم؟ اولویت پرداخت‌هایم چیست؟',
  'کدام بدهی را زودتر تسویه کنم؟',
  'با تورم فعلی، اجاره بهتر است یا رهن بیشتر؟',
  'یک برنامه پس‌انداز ماهانه واقع‌بینانه برایم بنویس.',
];

function Advisor({ d }: { d: FinanceData }) {
  const { today, items } = useFinance();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState('');
  const [secret, setSecret] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSecret(lsGet(SECRET_KEY) ?? '');
    try {
      const saved = JSON.parse(lsGet(CHAT_KEY) ?? '[]');
      if (Array.isArray(saved)) setTurns(saved.filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string'));
    } catch {
      // ignore a corrupt chat
    }
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) setInput(q);
    fetch(api('/api/advisor'), { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        setConfigured(!!j.configured);
        setModel(j.model ?? '');
      })
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    if (!busy) lsSet(CHAT_KEY, JSON.stringify(turns.slice(-20)));
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [turns, busy]);

  const summary = advisorSummary(d, items, today);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (!secret.trim()) return setErr('رمز مشاور را وارد کنید (همان ADVISOR_SECRET یا ADMIN_SECRET در Vercel).');
    lsSet(SECRET_KEY, secret.trim());
    // a failed or cut-off previous answer must not leave two user turns in a row
    const history = turns.length && turns[turns.length - 1].role === 'user' ? turns.slice(0, -1) : turns;
    const next: Turn[] = [...history, { role: 'user' as const, content: q }].slice(-19);
    while (next.length && next[0].role !== 'user') next.shift();
    setTurns([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setErr(null);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    let acc = '';
    try {
      const res = await fetch(api('/api/advisor'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-advisor-secret': secret.trim() },
        body: JSON.stringify({ summary, messages: next }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `خطای ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setTurns([...next, { role: 'assistant' as const, content: acc }]);
      }
      if (!acc.trim()) throw new Error('پاسخی برنگشت.');
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      setErr(aborted ? null : e instanceof Error ? e.message : String(e));
      // keep a partial answer; drop the empty bubble
      setTurns(acc.trim() ? [...next, { role: 'assistant' as const, content: acc + (aborted ? '\n\n(متوقف شد)' : '') }] : next);
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <>
      <PageHead title="مشاور مالی">
        از Claude درباره بودجه، وام، پس‌انداز، خرید طلا/ارز یا هر تصمیم مالی بپرسید. مشاور خلاصه اعداد دفتر شما و قیمت‌های امروز بازار را می‌بیند. پاسخ‌ها کمک به تصمیم‌اند، نه توصیه
        قطعی؛ آینده را هیچ‌کس نمی‌داند.
      </PageHead>

      {configured === false ? (
        <p className="banner warn">
          مشاور روی سرور فعال نیست: <code>ANTHROPIC_API_KEY</code> و یکی از <code>ADVISOR_SECRET</code> یا <code>ADMIN_SECRET</code> باید در تنظیمات Vercel باشند.
        </p>
      ) : null}

      <Card className="fin-chat">
        {turns.length ? (
          <div className="fin-thread" aria-live="polite">
            {turns.map((t, i) => (
              <div key={i} className={`fin-bubble ${t.role}`}>
                {t.role === 'assistant' ? t.content ? <Markdown text={t.content} /> : <span className="muted">در حال فکر کردن…</span> : <p>{t.content}</p>}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        ) : (
          <div className="fin-quick">
            {[...QUICK_QUESTIONS, ...MORE_QUESTIONS].map((q) => (
              <button key={q} className="fin-chip" onClick={() => ask(q)} disabled={busy}>
                {q}
              </button>
            ))}
          </div>
        )}

        {err ? (
          <p className="fin-err" role="alert">
            {err}
          </p>
        ) : null}

        <form
          className="fin-compose"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <textarea
            className="fin-input"
            rows={2}
            value={input}
            maxLength={4000}
            placeholder="سؤالتان را بنویسید؛ مثلاً «۵۰ میلیون پس‌انداز دارم، وام ۲۰۰ میلیونی ۲۳٪ بگیرم یا نه؟»"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
          />
          <div className="fin-actions">
            {busy ? (
              <button type="button" className="btn" onClick={() => abort.current?.abort()}>
                توقف
              </button>
            ) : (
              <button type="submit" className="btn" disabled={!input.trim()}>
                بپرس
              </button>
            )}
            {turns.length && !busy ? (
              <button type="button" className="fin-mini" onClick={() => setTurns([])}>
                گفت‌وگوی تازه
              </button>
            ) : null}
          </div>
        </form>
      </Card>

      <Card title="تنظیم و حریم خصوصی">
        <div className="fin-grid">
          <div className="fin-field">
            <label>
              <span className="fin-label">رمز مشاور</span>
              <input className="fin-input" type="password" dir="ltr" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="ADVISOR_SECRET" />
            </label>
            <span className="fin-hint">کلید Claude روی سرور می‌ماند؛ این رمز فقط جلوی استفاده غریبه‌ها از آن را می‌گیرد و روی همین دستگاه ذخیره می‌شود.</span>
          </div>
        </div>
        <p className="muted small">
          هر پرسش، فقط خلاصه عددی زیر را همراه متن سؤال به سرور شما و از آنجا به Anthropic می‌فرستد. یادداشت تراکنش‌ها، نام حساب‌ها و نام طرف چک‌ها فرستاده نمی‌شود و سرور چیزی ذخیره نمی‌کند.
          {model ? ` مدل: ${model}.` : ''}
        </p>
        <button className="fin-mini" onClick={() => setShowData((x) => !x)} aria-expanded={showData}>
          {showData ? 'پنهان کردن' : 'دیدن دقیق داده‌ای که فرستاده می‌شود'}
        </button>
        {showData ? <pre className="fin-json">{JSON.stringify(summary, null, 2)}</pre> : null}
      </Card>
    </>
  );
}

export default function AdvisorView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Advisor d={d} />}</WithBook>
    </div>
  );
}
