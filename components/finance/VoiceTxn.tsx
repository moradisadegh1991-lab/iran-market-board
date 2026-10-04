'use client';
import { useEffect, useRef, useState } from 'react';
import { deleteTxn } from '@/lib/finance/actions';
import type { Txn } from '@/lib/finance/model';
import { answer, choose, commitVoice, draftRows, edit, startVoice, type Ask, type VoiceState } from '@/lib/finance/voice';
import { VOICE_SPEAK_KEY, VoiceError, voiceIO, type VoiceErr, type VoiceIO } from '@/lib/voice-io';
import { useFinance } from './FinanceProvider';

const PROBLEM: Record<VoiceErr, string> = {
  permission: 'اجازه میکروفون داده نشد. از تنظیمات گوشی › برنامه‌ها › مالی من › مجوزها، میکروفون را روشن کنید؛ تا آن موقع می‌توانید جواب را بنویسید.',
  'no-match': 'چیزی نشنیدم. دکمه میکروفون را دوباره بزنید و بعد از بوق صحبت کنید.',
  network: 'تشخیص گفتار به اینترنت نیاز دارد. اتصال را بررسی کنید یا جواب را بنویسید.',
  language: 'سرویس گفتار این گوشی فارسی ندارد. برنامه Google را نصب یا به‌روز کنید، یا در تنظیمات گوشی «ورودی صوتی» را روی Google بگذارید.',
  busy: 'میکروفون مشغول است؛ چند ثانیه بعد دوباره بزنید.',
  unavailable: 'این دستگاه سرویس تشخیص گفتار ندارد؛ جواب را بنویسید یا گزینه‌ها را بزنید.',
  audio: 'ضبط صدا ممکن نشد؛ دوباره امتحان کنید.',
  cancelled: '',
  client: 'تشخیص گفتار کار نکرد؛ دوباره امتحان کنید یا جواب را بنویسید.',
};

/**
 * «ثبت با صدا»: the assistant asks, the user answers in Persian (or types, or taps an option), and the
 * transaction is recorded only after the read-back is confirmed. The conversation is lib/finance/voice.ts;
 * hearing and speaking are lib/voice-io.ts.
 */
export default function VoiceTxn({ onClose }: { onClose: () => void }) {
  const { data, today, update } = useFinance();
  const dataRef = useRef(data);
  dataRef.current = data;
  const [io, setIo] = useState<VoiceIO | null>(null);
  const ioRef = useRef<VoiceIO | null>(null);
  const [st, setSt] = useState<VoiceState | null>(null);
  const stRef = useRef<VoiceState | null>(null);
  const [phase, setPhase] = useState<'idle' | 'speaking' | 'listening'>('idle');
  const [partial, setPartial] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [speakOn, setSpeakOn] = useState(true);
  const speakRef = useRef(true);
  const [saved, setSaved] = useState<Txn | null>(null);
  const [undone, setUndone] = useState(false);
  const alive = useRef(true);
  // after the first tap on the mic, the assistant listens again by itself after each question
  const handsFree = useRef(false);
  const logRef = useRef<HTMLOListElement | null>(null);

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
      const first = stRef.current;
      if (first && x.canSpeak && speakRef.current) void x.speak(first.say);
    });
    document.body.classList.add('sheet-open');
    return () => {
      alive.current = false;
      ioRef.current?.cancel();
      ioRef.current?.hush();
      document.body.classList.remove('sheet-open');
    };
  }, []);

  useEffect(() => {
    if (data && !stRef.current) {
      const s = startVoice(data, today);
      stRef.current = s;
      setSt(s);
    }
  }, [data, today]);

  useEffect(() => {
    const el = logRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [st, partial]);

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

  async function listenOnce() {
    const x = ioRef.current;
    const cur = stRef.current;
    if (!x?.canListen || !cur || cur.done) return;
    x.hush();
    setProblem(null);
    setPartial('');
    setPhase('listening');
    try {
      const alts = await x.listen((t) => alive.current && setPartial(t), cur.say);
      if (!alive.current) return;
      setPhase('idle');
      setPartial('');
      advance(answer(dataRef.current!, today, stRef.current!, alts));
    } catch (e) {
      if (!alive.current) return;
      setPhase('idle');
      setPartial('');
      handsFree.current = false;
      const code = e instanceof VoiceError ? e.code : 'client';
      if (code === 'permission' && x.kind === 'web') setProblem('مرورگر اجازه میکروفون نداد. از نماد قفل کنار نشانی سایت، میکروفون را مجاز کنید؛ تا آن موقع می‌توانید جواب را بنویسید.');
      else if (PROBLEM[code]) setProblem(PROBLEM[code]);
    }
  }

  function advance(next: VoiceState) {
    if (next.done === 'save' && stRef.current?.done !== 'save') {
      let t: Txn | null = null;
      update((d) => {
        t = commitVoice(d, next);
      });
      setSaved(t);
      setUndone(false);
    }
    stRef.current = next;
    setSt(next);
    void (async () => {
      await say(next.say);
      if (alive.current && handsFree.current && !next.done) void listenOnce();
    })();
  }

  function mic() {
    const x = ioRef.current;
    if (!x) return;
    if (phase === 'listening') return x.stop();
    handsFree.current = true;
    void listenOnce();
  }

  function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = typed.trim();
    if (!text || !stRef.current || !dataRef.current) return;
    setTyped('');
    quiet();
    advance(answer(dataRef.current, today, stRef.current, text));
  }

  function tap(key: string) {
    if (!stRef.current || !dataRef.current) return;
    quiet();
    advance(choose(dataRef.current, today, stRef.current, key));
  }

  function fix(what: Ask) {
    if (!stRef.current || !dataRef.current || stRef.current.done) return;
    quiet();
    advance(edit(dataRef.current, today, stRef.current, what));
  }

  /** Typing or tapping: the user left the mic, so stop listening by itself until it is tapped again. */
  function quiet() {
    handsFree.current = false;
    ioRef.current?.cancel();
    setProblem(null);
  }

  function undo() {
    if (!saved) return;
    update((d) => deleteTxn(d, saved.id));
    setUndone(true);
  }

  function again() {
    if (!dataRef.current) return;
    setSaved(null);
    setUndone(false);
    quiet();
    const s = startVoice(dataRef.current, today);
    stRef.current = s;
    setSt(s);
    void say(s.say);
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

  if (!data || !st) return null;
  const rows = draftRows(data, today, st.draft);
  const canListen = !!io?.canListen;

  return (
    <div className="voice-wrap" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="voice-sheet" role="dialog" aria-modal="true" aria-label="ثبت تراکنش با صدا" data-testid="voice">
        <div className="sheet-head">
          <b>🎙 ثبت تراکنش با صدا</b>
          <button className="sheet-close" aria-label="بستن" onClick={onClose}>
            ✕
          </button>
        </div>

        <ol className="voice-log" ref={logRef} aria-live="polite">
          {st.turns.map((t, i) => (
            <li key={i} className={t.who}>
              {t.text}
            </li>
          ))}
          {partial ? <li className="me partial">{partial}…</li> : null}
        </ol>

        {rows.some((r) => r.value) && !st.done ? (
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

        {st.done === 'save' ? (
          <div className="voice-done" data-testid="voice-saved">
            <p role="status">{undone ? 'برگردانده شد؛ چیزی ثبت نماند.' : saved ? 'ثبت شد ✓' : 'ثبت نشد.'}</p>
            <div className="fin-actions">
              {saved && !undone ? (
                <button className="btn ghost" onClick={undo}>
                  برگرداندن
                </button>
              ) : null}
              <button className="btn" onClick={again}>
                تراکنش بعدی
              </button>
              <button className="btn ghost" onClick={onClose}>
                بستن
              </button>
            </div>
          </div>
        ) : st.done === 'cancel' ? (
          <div className="voice-done">
            <div className="fin-actions">
              <button className="btn" onClick={again}>
                از اول
              </button>
              <button className="btn ghost" onClick={onClose}>
                بستن
              </button>
            </div>
          </div>
        ) : (
          <>
            {st.options.length ? (
              <div className="voice-opts" role="group" aria-label="گزینه‌ها">
                {st.options.map((o) => (
                  <button key={o.key} type="button" className={st.asking === 'confirm' && o.key === 'yes' ? 'btn' : 'voice-opt'} onClick={() => tap(o.key)}>
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
                <input className="fin-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={canListen ? 'یا بنویسید…' : 'جواب را بنویسید…'} aria-label="جواب را بنویسید" />
                <button className="btn" type="submit">
                  بفرست
                </button>
              </form>
            </div>
            <p className="muted small voice-state" aria-live="polite">
              {phase === 'listening'
                ? 'گوش می‌دهم… حرفتان که تمام شد، صبر کنید یا دوباره دکمه را بزنید.'
                : phase === 'speaking'
                  ? 'در حال خواندن سؤال…'
                  : canListen
                    ? 'دکمه میکروفون را بزنید و جواب را بگویید.'
                    : io
                      ? 'این دستگاه تشخیص گفتار ندارد؛ جواب را بنویسید یا گزینه‌ها را بزنید.'
                      : ' '}
            </p>
          </>
        )}

        <div className="voice-foot muted small">
          {io?.canSpeak ? (
            <label className="voice-speak">
              <input type="checkbox" checked={speakOn} onChange={toggleSpeak} /> خواندن سؤال‌ها با صدا
            </label>
          ) : io ? (
            <span>این دستگاه صدای فارسی برای خواندن ندارد؛ سؤال‌ها همین‌جا نوشته می‌شوند.</span>
          ) : null}
          <span>
            {io?.kind === 'app'
              ? 'صدا را سرویس گفتار گوشی (معمولاً گوگل) به متن تبدیل می‌کند؛ فهمیدن و ثبت فقط روی همین گوشی است و چیزی به سرور «مالی من» نمی‌رود.'
              : io?.kind === 'web'
                ? 'در مرورگر، صدا را خود مرورگر (کروم: گوگل) به متن تبدیل می‌کند؛ فهمیدن و ثبت فقط روی همین دستگاه است.'
                : 'فهمیدن و ثبت فقط روی همین دستگاه است.'}{' '}
            هیچ چیزی بدون «بله» ثبت نمی‌شود.
          </span>
        </div>
      </div>
    </div>
  );
}
