'use client';
import { useEffect, useState } from 'react';
import { useSnapshot } from '../SnapshotProvider';
import { PageHead } from '../ui';
import { Card } from '../finance/kit';

/**
 * «واحد کنترل اقتصاد»: a 24-month personal-finance simulation in an inflationary economy. The
 * engine is android-app/www/game-engine.js, ported unchanged from the original project (verified
 * byte-identical results); only this interface is new. Progress is kept on the device under the
 * same key the earlier Android app used, so a game in progress there continues here.
 * An educational tool, not investment advice.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Engine = any;
type Game = any;
interface Alloc {
  side: number;
  intl: number;
  venture: number;
  rest: number;
}
const GAME_KEY = 'imb.game.v1';
const faN = (n: number, d = 0) => (Number.isFinite(n) ? n.toLocaleString('fa-IR', { maximumFractionDigits: d }) : '—');
const faDigits = (s: string) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
const defaultAlloc = (free: number): Alloc => {
  const rest = Math.max(1, Math.round(free / 3));
  return { side: Math.max(0, free - rest), intl: 0, venture: 0, rest };
};
function load(): { state: Game; alloc: Alloc } | null {
  try {
    const o = JSON.parse(localStorage.getItem(GAME_KEY) ?? 'null');
    return o && o.state ? o : null;
  } catch {
    return null;
  }
}
function save(state: Game, alloc: Alloc | null) {
  try {
    localStorage.setItem(GAME_KEY, JSON.stringify({ state, alloc, at: Date.now() }));
  } catch {
    // progress just is not kept
  }
}

const SETUP = [
  { k: 'income', label: 'درآمد ماهانه (میلیون تومان)', d: '90' },
  { k: 'living', label: 'هزینه زندگی ماهانه (میلیون)', d: '30' },
  { k: 'inst', label: 'قسط ماهانه (میلیون)', d: '0' },
  { k: 'free', label: 'روزهای آزاد در ماه', d: '8' },
  { k: 'cash', label: 'نقد فعلی (میلیون)', d: '50' },
  { k: 'infl', label: 'تورم سالانه (٪)', d: '60' },
] as const;

export default function GameView() {
  const { snap } = useSnapshot();
  const [E, setE] = useState<Engine>(null);
  const [game, setGame] = useState<Game>(null);
  const [alloc, setAlloc] = useState<Alloc | null>(null);
  const [job, setJob] = useState('engineer');
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(SETUP.map((f) => [f.k, f.d])));

  useEffect(() => {
    let alive = true;
    import('@/android-app/www/game-engine.js').then(() => {
      if (!alive) return;
      setE((window as { ECU?: Engine }).ECU ?? null);
      const saved = load();
      if (saved) {
        setGame(saved.state);
        setAlloc(saved.alloc ?? defaultAlloc(saved.state.freeDays));
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!E) return <div className="wrap"><p className="state muted">در حال بارگذاری بازی…</p></div>;

  const board = (k: string) => snap?.live.items.find((i) => i.key === k && i.unit === 'toman' && Number.isFinite(i.price))?.price ?? null;

  function start() {
    const num = (k: string) => {
      const v = Number(String(form[k]).replace(/[^\d.]/g, ''));
      return Number.isFinite(v) ? v : Number(SETUP.find((f) => f.k === k)!.d);
    };
    const d = E.DEFAULT_PROFILE.prices;
    // start from today's market when the board has it (the engine's reference is the half coin)
    const prices = { goldGram: board('g18') ?? d.goldGram, usd: board('usd') ?? d.usd, coinHalf: board('coin') ? board('coin')! / 2 : d.coinHalf };
    const g = E.newGame({
      jobKey: job,
      income: num('income') * 1e6,
      living: num('living') * 1e6,
      installment: num('inst') * 1e6,
      freeDays: Math.max(1, Math.round(num('free'))),
      inflation: num('infl'),
      assets: { cash: num('cash') * 1e6, gold: 0, usd: 0, coin: 0, fixed: 0, equity: 0 },
      prices,
    });
    const a = defaultAlloc(g.freeDays);
    setGame(g);
    setAlloc(a);
    save(g, a);
  }
  function reset() {
    if (!confirm('بازی از اول شروع شود؟ پیشرفت فعلی پاک می‌شود.')) return;
    try {
      localStorage.removeItem(GAME_KEY);
    } catch {
      // nothing to clear
    }
    setGame(null);
    setAlloc(null);
  }

  // ── setup ──
  if (!game) {
    return (
      <div className="wrap">
        <PageHead title="بازی: واحد کنترل اقتصاد">
          شبیه‌سازی ۲۴ ماه مدیریت مالی شخصی در اقتصاد تورمی. با شغل، درآمد و دارایی واقعی خودتان شروع کنید و ببینید تصمیم‌ها در دو سال چه نتیجه‌ای می‌دهند. ابزار آموزشی است، نه
          مشاوره سرمایه‌گذاری.
        </PageHead>
        <Card title="شروع بازی">
          <div className="fin-grid">
            <label className="fin-field">
              <span className="fin-label">شغل</span>
              <select className="fin-input" value={job} onChange={(e) => setJob(e.target.value)}>
                {Object.keys(E.JOBS).map((k) => (
                  <option key={k} value={k}>
                    {E.JOBS[k].label ?? k}
                  </option>
                ))}
              </select>
            </label>
            {SETUP.map((f) => (
              <label key={f.k} className="fin-field">
                <span className="fin-label">{f.label}</span>
                <input className="fin-input" inputMode="numeric" dir="ltr" value={form[f.k]} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })} />
              </label>
            ))}
          </div>
          <p className="muted small">{E.JOBS[job]?.note}</p>
          <p className="muted small">قیمت طلا، دلار و سکه از آخرین داده بازار گرفته می‌شود تا شبیه‌سازی از وضعیت امروز شروع شود.</p>
          <button className="btn run" onClick={start}>
            شروع بازی
          </button>
        </Card>
      </div>
    );
  }

  const wealth = E.wealthOf(game);
  const real = E.realWealthOf(game);
  const buf = E.bufferMonthsOf(game);
  const progress = Math.min(100, (game.month / E.MONTHS) * 100);

  // ── finished ──
  if (game.month >= E.MONTHS) {
    return (
      <div className="wrap">
        <PageHead title="پایان ۲۴ ماه" />
        <div className="game-hero">
          <span className="game-hero-k">دارایی نهایی</span>
          <span className="game-hero-v">{E.M(wealth)} میلیون تومان</span>
          <div className="game-hero-grid">
            <div>
              <span>قدرت خرید واقعی</span>
              <b>{E.M(real)} میلیون</b>
            </div>
            <div>
              <span>شاخص قیمت</span>
              <b>{faN(game.cpi)}</b>
            </div>
          </div>
        </div>
        <p className="banner info">قدرت خرید واقعی مهم‌تر از عدد اسمی است: اگر دارایی‌تان دو برابر شده ولی قیمت‌ها سه برابر شده‌اند، عقب رفته‌اید.</p>
        <button className="btn run" onClick={reset} style={{ marginTop: 14 }}>
          بازی دوباره
        </button>
      </div>
    );
  }

  // ── a month ──
  const a = alloc ?? defaultAlloc(game.freeDays);
  const keys = ([
    { k: 'side', label: 'پروژه جانبی', ic: '🛠' },
    { k: 'intl', label: 'مسیر بین‌المللی', ic: '🌍' },
    { k: 'venture', label: 'کسب‌وکار خودت', ic: '🚀' },
    { k: 'rest', label: 'استراحت', ic: '🛋' },
  ] as const).filter((x) => x.k !== 'intl' || game.job?.intl);
  const used = a.side + a.intl + a.venture + a.rest;
  const left = game.freeDays - used;
  const setA = (k: keyof Alloc, v: number) => {
    const next = { ...a, [k]: v };
    setAlloc(next);
    save(game, next);
  };

  return (
    <div className="wrap">
      <PageHead title="بازی: واحد کنترل اقتصاد" />
      <div className="game-hero">
        <div className="game-hero-top">
          <span>{faDigits(E.monthLabel(game.month))}</span>
          <span>
            ماه {faN(game.month + 1)} از {faN(E.MONTHS)}
          </span>
        </div>
        <div className="game-progress" aria-hidden="true">
          <b style={{ width: `${progress}%` }} />
        </div>
        <span className="game-hero-k">دارایی کل</span>
        <span className="game-hero-v">{E.M(wealth)} میلیون تومان</span>
        <div className="game-hero-grid">
          <div>
            <span>قدرت خرید واقعی</span>
            <b>{E.M(real)} میلیون</b>
          </div>
          <div>
            <span>نقد</span>
            <b>{E.M(game.cash)} میلیون</b>
          </div>
          <div>
            <span>سپر نقدی</span>
            <b className={buf < 3 ? 'down' : 'up'}>{faN(buf, 1)} ماه</b>
          </div>
          <div>
            <span>تورم سالانه</span>
            <b>{faN(E.annualInflationOf(game))}٪</b>
          </div>
        </div>
      </div>

      {(game.note ?? []).length ? (
        <Card title="رویدادهای ماه گذشته">
          <ul className="fin-list">
            {(game.note as string[]).slice(-4).map((n, i) => (
              <li key={i}>
                <span className="fin-list-main">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={`${faN(game.freeDays)} روز آزاد این ماه را چطور خرج می‌کنی؟`}>
        <div className="game-alloc">
          {keys.map((x) => (
            <label key={x.k} className="game-slider">
              <span className="game-slider-top">
                <span>
                  {x.ic} {x.label}
                </span>
                <b>{faN(a[x.k])} روز</b>
              </span>
              <input type="range" min={0} max={game.freeDays} value={a[x.k]} onChange={(e) => setA(x.k, Number(e.target.value))} aria-label={x.label} />
            </label>
          ))}
        </div>
        <p className={left < 0 ? 'fin-err' : 'muted small'}>
          {left < 0 ? `بیش از روزهای آزادت تخصیص داده‌ای (${faN(-left)} روز اضافه)` : `${faN(left)} روز تخصیص‌نیافته`}
        </p>
        <div className="fin-actions">
          <button
            className="btn run"
            disabled={left < 0}
            onClick={() => {
              const g = E.stepMonth(game, a);
              setGame(g);
              save(g, a);
              window.scrollTo(0, 0);
            }}
          >
            ثبت ماه و رفتن به ماه بعد
          </button>
          <button className="fin-mini ghost" onClick={reset}>
            شروع دوباره
          </button>
        </div>
      </Card>
    </div>
  );
}
