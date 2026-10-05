'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { answerQuestion, HELP_TEXT, parseQuestion, type Reply } from '@/lib/assistant/ask';
import { deleteTxn } from '@/lib/finance/actions';
import type { Txn } from '@/lib/finance/model';
import { answer, choose, commitVoice, draftRows, edit, startVoice, type Ask, type VoiceState } from '@/lib/finance/voice';
import { VOICE_SPEAK_KEY, VoiceError, voiceIO, type AppCrash, type VoiceErr, type VoiceIO } from '@/lib/voice-io';
import { useFinance } from '../finance/FinanceProvider';
import AskChart from './AskChart';

const PROBLEM: Record<VoiceErr, string> = {
  permission: 'اجازه میکروفون داده نشد. از تنظیمات گوشی › برنامه‌ها › مالی من › مجوزها، میکروفون را روشن کنید؛ تا آن موقع می‌توانید بنویسید.',
  'no-match': 'چیزی نشنیدم. دکمه میکروفون را دوباره بزنید و بعد از بوق صحبت کنید.',
  network: 'تشخیص گفتار به اینترنت نیاز دارد. اتصال را بررسی کنید یا بنویسید.',
  language: 'سرویس گفتار این گوشی فارسی ندارد. برنامه Google را نصب یا به‌روز کنید، یا در تنظیمات گوشی «ورودی صوتی» را روی Google بگذارید.',
  busy: 'میکروفون مشغول است؛ چند ثانیه بعد دوباره بزنید.',
  unavailable: 'این دستگاه سرویس تشخیص گفتار ندارد؛ بنویسید یا گزینه‌ها را بزنید.',
  audio: 'ضبط صدا ممکن نشد؛ دوباره امتحان کنید.',
  cancelled: '',
  client: 'تشخیص گفتار کار نکرد؛ دوباره امتحان کنید یا بنویسید.',
};
// a listen the assistant started by itself (after a question) gets one quiet retry on these
const RETRY: VoiceErr[] = ['network', 'client', 'busy', 'audio'];

interface Item {
  id: number;
  who: 'bot' | 'me';
  text: string;
  chart?: Reply['chart'];
  link?: Reply['link'];
  /** the chart's sentence, once it arrived */
  summary?: string;
}

// opened by the phone's assist gesture, the tile or the shortcut (rule 74): short, and it listens right away
const ASSIST_HI = 'بفرمایید؛ گوش می‌دهم. بپرسید یا تراکنش بگویید.';
const GREETING = 'سلام! تراکنش بگویید تا ثبت کنم، یا بپرسید: «قیمت دلار چنده؟»، «نمودار سه ماه گذشته طلای ۱۸ عیار»، «این ماه چقدر خرج کردم؟».';

/**
 * The assistant: say (or type) a transaction and it asks for what is missing, reads it back and records it
 * on «بله» (lib/finance/voice.ts); ask a question and it answers in text and speech, with a chart when asked
 * (lib/assistant/ask.ts). Hearing and speaking: lib/voice-io.ts. `mode="txn"` starts by asking for a transaction.
 */
export default function Assistant({ onClose, mode = 'any', listen = 0 }: { onClose: () => void; mode?: 'any' | 'txn'; listen?: number }) {
  const { data, today, update, items } = useFinance();
  const dataRef = useRef(data);
  dataRef.current = data;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [io, setIo] = useState<VoiceIO | null>(null);
  const ioRef = useRef<VoiceIO | null>(null);
  const [log, setLog] = useState<Item[]>([]);
  const nextId = useRef(1);
  const [txn, setTxn] = useState<VoiceState | null>(null);
  const txnRef = useRef<VoiceState | null>(null);
  const [phase, setPhase] = useState<'idle' | 'speaking' | 'listening'>('idle');
  const [partial, setPartial] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [speakOn, setSpeakOn] = useState(true);
  const speakRef = useRef(true);
  const [saved, setSaved] = useState<Txn | null>(null);
  const [undone, setUndone] = useState(false);
  const alive = useRef(true);
  // after the first tap on the mic, it listens again by itself while a transaction still needs answers
  const handsFree = useRef(false);
  const listening = useRef(false);
  // `listen` counts the phone's requests for the assistant; the first one opened this sheet
  const assisted = useRef(listen > 0);
  const lastListen = useRef(listen);
  const logRef = useRef<HTMLOListElement | null>(null);
  const started = useRef(false);
  const chartsSaid = useRef(new Set<number>());

  const push = useCallback((...xs: Omit<Item, 'id'>[]) => {
    setLog((l) => [...l, ...xs.map((x) => ({ ...x, id: nextId.current++ }))]);
  }, []);

  useEffect(() => {
    alive.current = true;
    try {
      const on = localStorage.getItem(VOICE_SPEAK_KEY) !== '0';
      setSpeakOn(on);
      speakRef.current = on;
    } catch {
      // default on
    }
    void voiceIO().then((x) => {
      if (!alive.current) return;
      ioRef.current = x;
      setIo(x);
    });
    document.body.classList.add('sheet-open');
    return () => {
      alive.current = false;
      ioRef.current?.cancel();
      ioRef.current?.hush();
      document.body.classList.remove('sheet-open');
    };
  }, []);

  // the opening line, once the book is loaded
  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    if (mode === 'txn') {
      const s = startVoice(data, today);
      txnRef.current = s.done ? null : s;
      setTxn(txnRef.current);
      push({ who: 'bot', text: s.say });
    } else push({ who: 'bot', text: assisted.current ? ASSIST_HI : GREETING });
  }, [data, today, mode, push]);

  // say the opening line when the voice is ready
  useEffect(() => {
    if (!io) return;
    if (assisted.current) void assist('بفرمایید');
    else if (log.length === 1 && log[0].who === 'bot') void say(log[0].text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [io]);

  // asked again while open: listen (once the voice is ready, the effect above does it)
  useEffect(() => {
    if (listen === lastListen.current) return;
    lastListen.current = listen;
    if (ioRef.current) void assist();
    else assisted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listen]);

  useEffect(() => {
    const el = logRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [log, partial, txn]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function say(text: string) {
    const x = ioRef.current;
    if (!x || !x.canSpeak || !speakRef.current || !text) return;
    setPhase('speaking');
    await x.speak(text);
    if (alive.current) setPhase('idle');
  }

  function setTxnState(s: VoiceState | null) {
    txnRef.current = s;
    setTxn(s);
  }

  /** After the bot spoke: keep listening while a transaction still needs an answer. */
  async function speakThenMaybeListen(text: string) {
    await say(text);
    const t = txnRef.current;
    if (alive.current && handsFree.current && t && !t.done) {
      await new Promise((r) => setTimeout(r, 350));
      if (alive.current) void listenOnce(true);
    }
  }

  /** The phone asked for the assistant: (a word, then) listen straight away, hands-free. */
  async function assist(hi?: string) {
    if (listening.current) return;
    handsFree.current = true;
    if (hi) await say(hi);
    if (alive.current && !listening.current) void listenOnce(true);
  }

  async function listenOnce(auto = false, retried = false) {
    const x = ioRef.current;
    if (!x?.canListen) return;
    listening.current = true;
    x.hush();
    setProblem(null);
    setPartial('');
    setPhase('listening');
    try {
      const alts = await x.listen((t) => alive.current && setPartial(t), txnRef.current?.say);
      listening.current = false;
      if (!alive.current) return;
      setPhase('idle');
      setPartial('');
      heard(alts);
    } catch (e) {
      listening.current = false;
      if (!alive.current) return;
      setPhase('idle');
      setPartial('');
      const code = e instanceof VoiceError ? e.code : 'client';
      if (auto && !retried && RETRY.includes(code)) {
        await new Promise((r) => setTimeout(r, 700));
        if (alive.current) return listenOnce(true, true);
        return;
      }
      handsFree.current = false;
      if (auto && code === 'no-match') return; // a pause is not an error: the user taps the mic when ready
      if (code === 'permission' && x.kind === 'web') setProblem('مرورگر اجازه میکروفون نداد. از نماد قفل کنار نشانی سایت، میکروفون را مجاز کنید؛ تا آن موقع می‌توانید بنویسید.');
      else if (PROBLEM[code]) setProblem(PROBLEM[code]);
    }
  }

  function reply(r: Reply, said: string) {
    push({ who: 'me', text: said }, { who: 'bot', text: r.text, chart: r.chart, link: r.link });
    if (r.speech) void say(r.speech);
  }

  /** One thing the user said or typed (the recogniser's guesses, best first). */
  function heard(alts: string[]) {
    const d = dataRef.current;
    if (!d || !alts.length) return;
    const cur = txnRef.current && !txnRef.current.done ? txnRef.current : null;

    // a question — unless a transaction is waiting for an answer these words could be
    if (!cur || cur.asking === 'open') {
      for (const a of alts) {
        const q = parseQuestion(d, a, today);
        if (q) {
          if (cur) setTxnState(null);
          return reply(answerQuestion(d, itemsRef.current, today, q), a);
        }
      }
    }

    const base = cur ?? startVoice(d, today);
    const next = answer(d, today, base, alts);
    const said = next.turns[next.turns.length - 2]?.who === 'me' ? next.turns[next.turns.length - 2].text : alts[0];
    if (next.misses > base.misses) {
      // not an answer to the transaction's question: maybe a question asked in the middle of it
      for (const a of alts) {
        const q = cur ? parseQuestion(d, a, today) : null;
        if (q && q.type !== 'help') {
          const r = answerQuestion(d, itemsRef.current, today, q);
          push({ who: 'me', text: a }, { who: 'bot', text: r.text, chart: r.chart, link: r.link }, { who: 'bot', text: `برگردیم به تراکنش: ${cur!.say}` });
          void say(`${r.speech} برگردیم به تراکنش. ${cur!.say}`);
          return;
        }
      }
      if (!cur) {
        push({ who: 'me', text: said }, { who: 'bot', text: `متوجه نشدم. ${HELP_TEXT}` });
        void say('متوجه نشدم. می‌توانید تراکنش بگویید یا قیمت و نمودار بپرسید.');
        return;
      }
    }
    if (next.done === 'save' && cur?.done !== 'save') {
      let t: Txn | null = null;
      update((dd) => {
        t = commitVoice(dd, next);
      });
      setSaved(t);
      setUndone(false);
    }
    setTxnState(next.done ? null : next);
    push({ who: 'me', text: said }, { who: 'bot', text: next.say });
    void speakThenMaybeListen(next.say);
  }

  function mic() {
    const x = ioRef.current;
    if (!x) return;
    if (phase === 'listening') return x.stop();
    handsFree.current = true;
    void listenOnce();
  }

  /** Typing or tapping: the user left the mic, so stop listening by itself until it is tapped again. */
  function quiet() {
    handsFree.current = false;
    ioRef.current?.cancel();
    setProblem(null);
  }

  function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    quiet();
    heard([text]);
  }

  function step(next: VoiceState, said: string | null) {
    const d = dataRef.current;
    if (!d) return;
    if (next.done === 'save' && txnRef.current?.done !== 'save') {
      let t: Txn | null = null;
      update((dd) => {
        t = commitVoice(dd, next);
      });
      setSaved(t);
      setUndone(false);
    }
    setTxnState(next.done ? null : next);
    push(...(said ? [{ who: 'me' as const, text: said }] : []), { who: 'bot', text: next.say });
    void say(next.say);
  }

  function tap(key: string) {
    const d = dataRef.current;
    const cur = txnRef.current;
    if (!d || !cur) return;
    quiet();
    step(choose(d, today, cur, key), cur.options.find((o) => o.key === key)?.label ?? null);
  }

  function fix(what: Ask) {
    const d = dataRef.current;
    const cur = txnRef.current;
    if (!d || !cur || cur.done) return;
    quiet();
    step(edit(d, today, cur, what), null);
  }

  function undo() {
    if (!saved) return;
    update((d) => deleteTxn(d, saved.id));
    setUndone(true);
    push({ who: 'bot', text: 'برگردانده شد؛ آن تراکنش از دفتر حذف شد.' });
  }

  function toggleSpeak() {
    const on = !speakOn;
    setSpeakOn(on);
    speakRef.current = on;
    if (!on) ioRef.current?.hush();
    try {
      localStorage.setItem(VOICE_SPEAK_KEY, on ? '1' : '0');
    } catch {
      // this session only
    }
  }

  if (!data) return null;
  const rows = txn ? draftRows(data, today, txn.draft) : [];
  const canListen = !!io?.canListen;

  return (
    <div className="voice-wrap" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="voice-sheet" role="dialog" aria-modal="true" aria-label="دستیار صوتی" data-testid="voice">
        <div className="sheet-head">
          <b>🎙 دستیار</b>
          <button className="sheet-close" aria-label="بستن" onClick={onClose}>
            ✕
          </button>
        </div>

        <ol className="voice-log" ref={logRef} aria-live="polite">
          {log.map((t) => (
            <li key={t.id} className={`${t.who}${t.chart ? ' has-chart' : ''}`}>
              {t.text}
              {t.chart ? <AskChart spec={t.chart} onSummary={(s) => onChart(t.id, s)} /> : null}
              {t.summary ? <p className="ask-summary">{t.summary}</p> : null}
              {t.link ? (
                <Link className="ask-link" href={t.link.href} onClick={onClose}>
                  {t.link.label} ‹
                </Link>
              ) : null}
            </li>
          ))}
          {partial ? <li className="me partial">{partial}…</li> : null}
        </ol>

        {txn && rows.some((r) => r.value) ? (
          <dl className="voice-draft" data-testid="voice-draft">
            {rows.map((r) => (
              <button key={r.label} type="button" onClick={() => fix(r.key)} disabled={r.key === 'open'} aria-label={`${r.label}: ${r.value ?? 'هنوز معلوم نیست'} — تغییر`}>
                <dt>{r.label}</dt>
                <dd className={r.value ? '' : 'muted'}>{r.value ?? '؟'}</dd>
              </button>
            ))}
          </dl>
        ) : null}

        {problem ? (
          <p className="fin-err voice-problem" role="alert">
            {problem}
          </p>
        ) : null}

        {saved && !undone && !txn ? (
          <div className="voice-done" data-testid="voice-saved">
            <p role="status">ثبت شد ✓</p>
            <button className="btn ghost" onClick={undo}>
              برگرداندن
            </button>
          </div>
        ) : null}

        {txn?.options.length ? (
          <div className="voice-opts" role="group" aria-label="گزینه‌ها">
            {txn.options.map((o) => (
              <button key={o.key} type="button" className={txn.asking === 'confirm' && o.key === 'yes' ? 'btn' : 'voice-opt'} onClick={() => tap(o.key)}>
                {o.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="voice-input">
          {canListen ? (
            <button type="button" className={`voice-mic ${phase}`} onClick={mic} aria-pressed={phase === 'listening'} aria-label={phase === 'listening' ? 'تمام شد، بفهم' : 'صحبت کنید'}>
              <span aria-hidden>🎙</span>
            </button>
          ) : null}
          <form className="voice-type" onSubmit={send}>
            <input className="fin-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={canListen ? 'یا بنویسید…' : 'بنویسید…'} aria-label="پیام را بنویسید" />
            <button className="btn" type="submit">
              بفرست
            </button>
          </form>
        </div>
        <p className="muted small voice-state" aria-live="polite">
          {phase === 'listening'
            ? 'گوش می‌دهم… حرفتان که تمام شد، صبر کنید یا دوباره دکمه را بزنید.'
            : phase === 'speaking'
              ? 'در حال خواندن…'
              : canListen
                ? 'دکمه میکروفون را بزنید و بگویید.'
                : io
                  ? 'این دستگاه تشخیص گفتار ندارد؛ بنویسید یا گزینه‌ها را بزنید.'
                  : ' '}
        </p>

        <div className="voice-foot muted small">
          {io?.canSpeak ? (
            <label className="voice-speak">
              <input type="checkbox" checked={speakOn} onChange={toggleSpeak} /> جواب‌ها را با صدا بخوان
              {io.voice === 'built-in' ? <span data-testid="built-in-voice"> (صدای فارسی خود اپ، بدون اینترنت)</span> : null}
            </label>
          ) : io ? (
            <span data-testid="no-voice">
              این گوشی صدای فارسی برای خواندن ندارد؛ جواب‌ها همین‌جا نوشته می‌شوند. برای جواب صوتی، یک موتور «متن به گفتار» فارسی نصب کنید (مثلاً eSpeak NG یا یک صدای فارسی sherpa-onnx)؛ اپ خودش
              پیدایش می‌کند، لازم نیست پیش‌فرض باشد.{' '}
              {io.openVoiceSettings ? (
                <button type="button" className="fin-mini" onClick={() => io.openVoiceSettings!()}>
                  تنظیمات متن به گفتار گوشی
                </button>
              ) : null}
            </span>
          ) : null}
          {io?.lastCrash ? <CrashNote crash={io.lastCrash} /> : null}
          {io?.voiceError ? (
            <span className="fin-err" data-testid="voice-error">
              صدای فارسی خود اپ خاموش است: {io.voiceError}. دستیار بدون صدا کار می‌کند.{' '}
              {io.retryVoice ? (
                <button type="button" className="fin-mini" onClick={() => void io.retryVoice!().then(() => setIo({ ...io } as VoiceIO))}>
                  امتحان دوباره صدای داخلی
                </button>
              ) : null}
            </span>
          ) : null}
          <span>
            {io?.kind === 'app'
              ? 'صدا را سرویس گفتار گوشی (معمولاً گوگل) به متن تبدیل می‌کند؛ فهمیدن، جواب و ثبت روی همین گوشی است و برای نمودار فقط نام دارایی و بازه به سرور می‌رود.'
              : io?.kind === 'web'
                ? 'در مرورگر، صدا را خود مرورگر (کروم: گوگل) به متن تبدیل می‌کند؛ فهمیدن، جواب و ثبت روی همین دستگاه است.'
                : 'فهمیدن، جواب و ثبت روی همین دستگاه است.'}{' '}
            هیچ تراکنشی بدون «بله» ثبت نمی‌شود.
          </span>
        </div>
      </div>
    </div>
  );

  function onChart(id: number, s: { text: string; speech: string }) {
    if (chartsSaid.current.has(id)) return;
    chartsSaid.current.add(id);
    setLog((l) => l.map((x) => (x.id === id ? { ...x, summary: s.text } : x)));
    void say(s.speech);
  }
}

/** The app closed unexpectedly last time: what Android recorded, to copy and send (shown once). */
function CrashNote({ crash }: { crash: AppCrash }) {
  const [copied, setCopied] = useState(false);
  const text = [
    crash.reason ? `reason: ${crash.reason}` : '',
    crash.description ? `description: ${crash.description}` : '',
    crash.at ? `at: ${new Date(crash.at).toISOString()}` : '',
    crash.thread ? `thread: ${crash.thread}` : '',
    crash.stack ?? '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <details className="crash-note" data-testid="crash-note">
      <summary>اپ دفعه قبل ناگهان بسته شد — جزئیات برای گزارش</summary>
      <pre dir="ltr">{text}</pre>
      <button
        type="button"
        className="fin-mini"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? 'کپی شد' : 'کپی متن'}
      </button>
    </details>
  );
}
