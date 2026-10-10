'use client';
import Link from 'next/link';
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Square, Volume2 } from 'lucide-react';
import { LESSONS, lessonById, questionById, stepSpeech, TRACKS, type Lesson, type QuizQ } from '@/lib/learn/lessons';
import { voiceIO, type VoiceIO } from '@/lib/voice-io';
import { Art, type ArtKey } from '../icons';
import { dueDeck, emptyLearn, finishLesson, LEARN_KEY, MASTERED, nextLesson, normalizeLearn, progress, review, type LearnState } from '@/lib/learn/review';
import { tehranDate } from '@/lib/num';
import { PageHead } from '../ui';
import LessonWidget from './Widgets';

/** «**x**» → bold */
function Rich({ text }: { text: string }) {
  const parts = text.split('**');
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}</>;
}

const fa = (n: number) => n.toLocaleString('fa-IR');

/** the options in a fixed per-day order, so a review is answered from memory, not from position */
function shuffled(q: QuizQ, seed: string): number[] {
  const idx = q.options.map((_, i) => i);
  let h = 7;
  for (const ch of seed + q.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = idx.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function useLearn() {
  const [s, setS] = useState<LearnState>(emptyLearn);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setS(normalizeLearn(JSON.parse(localStorage.getItem(LEARN_KEY) ?? 'null')));
    } catch {
      // unreadable storage: start fresh, still usable
    }
    setReady(true);
  }, []);
  const save = (next: LearnState) => {
    setS(next);
    try {
      localStorage.setItem(LEARN_KEY, JSON.stringify(next));
    } catch {
      // private mode / full: progress lives for this visit only
    }
  };
  return { s, save, ready };
}

/** One question: pick, see right/wrong and why, go on. */
function Question({ q, seed, onDone, label }: { q: QuizQ; seed: string; onDone: (ok: boolean) => void; label: string }) {
  const [pick, setPick] = useState<number | null>(null);
  const order = useMemo(() => shuffled(q, seed), [q, seed]);
  useEffect(() => setPick(null), [q.id]);
  const ok = pick === q.answer;
  return (
    <div className="learn-q" data-testid="learn-q">
      <p className="learn-q-label muted small">{label}</p>
      <h3>{q.q}</h3>
      <div className="learn-opts" role="group" aria-label="گزینه‌ها">
        {order.map((i) => (
          <button key={i} className={pick === null ? '' : i === q.answer ? 'right' : i === pick ? 'wrong' : 'dim'} disabled={pick !== null} onClick={() => setPick(i)} aria-pressed={pick === i}>
            {q.options[i]}
          </button>
        ))}
      </div>
      {pick !== null ? (
        <div className={`learn-why ${ok ? 'ok' : 'no'}`} role="status">
          <b>{ok ? 'درست است.' : `پاسخ درست: ${q.options[q.answer]}`}</b> {q.why}
          <div>
            <button className="btn run" onClick={() => onDone(ok)}>
              ادامه
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * «گوش بده»: the step read aloud — the app's own Persian voice in the APK, the phone's or the browser's otherwise. The
 * voice is loaded on the first tap only (rule 72); while it is on, the next step is read as soon as it is opened.
 */
function Listen({ lesson, step }: { lesson: Lesson; step: number }) {
  const io = useRef<VoiceIO | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [mute, setMute] = useState<string | null>(null);
  const turn = useRef(0);
  const say = async (i: number) => {
    const t = ++turn.current;
    const v = io.current;
    if (!v) return;
    v.hush();
    setPlaying(true);
    try {
      await v.speak(stepSpeech(lesson, i));
    } catch {
      // a voice that failed mid-way: the text is still on the screen
    }
    if (turn.current === t) setPlaying(false);
  };
  useEffect(() => {
    if (on) void say(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, on]);
  useEffect(() => {
    return () => {
      turn.current++;
      io.current?.hush();
    };
  }, []);
  if (mute) return <p className="muted small" data-testid="learn-no-voice">{mute}</p>;
  return (
    <button
      type="button"
      className="fin-mini learn-listen"
      data-testid="learn-listen"
      aria-pressed={on && playing}
      disabled={busy}
      onClick={async () => {
        if (on && playing) {
          turn.current++;
          io.current?.hush();
          setPlaying(false);
          setOn(false);
          return;
        }
        if (!io.current) {
          setBusy(true);
          try {
            io.current = await voiceIO();
          } finally {
            setBusy(false);
          }
          if (!io.current.canSpeak) return setMute('این دستگاه صدای فارسی برای خواندن ندارد؛ درس را بخوانید. (در اپ اندروید، صدای فارسی خود اپ هست.)');
        }
        if (on) void say(step);
        else setOn(true);
      }}
    >
      {on && playing ? <Square size={14} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
      {busy ? ' آماده کردن صدا…' : on && playing ? ' توقف' : on ? ' دوباره بخوان' : ' گوش بده'}
    </button>
  );
}

function LessonPlayer({ lesson, s, save, today, onExit }: { lesson: Lesson; s: LearnState; save: (x: LearnState) => void; today: string; onExit: () => void }) {
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<'read' | 'quiz' | 'done'>('read');
  const [qi, setQi] = useState(0);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [plan, setPlan] = useState(s.plans[lesson.id] ?? '');
  const [planSaved, setPlanSaved] = useState(false);
  const track = TRACKS.find((t) => t.key === lesson.track)!;
  const total = lesson.steps.length;
  // a block body on purpose: newer WebViews return a Promise from scrollTo, and an arrow that returns
  // it hands React a non-function «cleanup» that throws on the next step ("i is not a function")
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step, phase]);

  if (phase === 'read') {
    const st = lesson.steps[step];
    return (
      <section className="panel learn-lesson" aria-labelledby="ls-h" data-testid="learn-lesson">
        <p className="muted small">
          {track.icon} {track.title} · حدود {fa(lesson.minutes)} دقیقه
        </p>
        <h2 id="ls-h">{lesson.title}</h2>
        <ol className="learn-dots" aria-label={`گام ${fa(step + 1)} از ${fa(total)}`}>
          {lesson.steps.map((_, i) => (
            <li key={i} className={i <= step ? 'on' : ''} />
          ))}
        </ol>
        {step === 0 && lesson.art ? <Art k={lesson.art as ArtKey} className="learn-art" /> : null}
        <div className="learn-step-head">
          <h3>{st.title}</h3>
          <Listen lesson={lesson} step={step} />
        </div>
        {st.body.map((b, i) => (
          <p key={i} className="learn-p">
            <Rich text={b} />
          </p>
        ))}
        {st.widget ? <LessonWidget k={st.widget} /> : null}
        {step === total - 1 ? (
          <p className="learn-key">
            <b>نکته کلیدی:</b> {lesson.takeaway}
          </p>
        ) : null}
        <div className="learn-nav">
          {step > 0 ? (
            <button className="fin-mini ghost" onClick={() => setStep(step - 1)}>
              قبلی
            </button>
          ) : (
            <button className="fin-mini ghost" onClick={onExit}>
              بازگشت
            </button>
          )}
          {step < total - 1 ? (
            <button className="btn run" onClick={() => setStep(step + 1)}>
              بعدی
            </button>
          ) : (
            <button className="btn run" onClick={() => setPhase('quiz')}>
              آزمون کوتاه ({fa(lesson.quiz.length)} سؤال)
            </button>
          )}
        </div>
      </section>
    );
  }

  if (phase === 'quiz') {
    const q = lesson.quiz[qi];
    return (
      <section className="panel learn-lesson" aria-label={`آزمون ${lesson.title}`}>
        <p className="muted small">یادآوری از حافظه — بدون نگاه به متن. اشتباه اشکالی ندارد؛ همان سؤال زودتر برای مرور برمی‌گردد.</p>
        <Question
          q={q}
          seed={today}
          label={`سؤال ${fa(qi + 1)} از ${fa(lesson.quiz.length)}`}
          onDone={(ok) => {
            const a = { ...answers, [q.id]: ok };
            setAnswers(a);
            if (qi < lesson.quiz.length - 1) setQi(qi + 1);
            else {
              save(finishLesson(s, lesson, a, today));
              setPhase('done');
            }
          }}
        />
      </section>
    );
  }

  const right = lesson.quiz.filter((q) => answers[q.id]).length;
  return (
    <section className="panel learn-lesson" data-testid="learn-done">
      <h2>درس «{lesson.title}» تمام شد</h2>
      <p className="learn-big">
        {fa(right)} از {fa(lesson.quiz.length)} پاسخ درست. {right === lesson.quiz.length ? 'سؤال‌ها سه روز دیگر برای مرور برمی‌گردند.' : 'سؤال‌های اشتباه فردا برمی‌گردند، درست‌ها سه روز دیگر.'}
      </p>
      <p className="learn-key">
        <b>نکته کلیدی:</b> {lesson.takeaway}
      </p>
      {lesson.plan ? (
        <div className="learn-plan">
          <h3>برنامه «اگر … آنگاه …» شما</h3>
          <p className="muted small">{lesson.plan.prompt} یک جمله کوتاه و مشخص؛ فقط روی همین دستگاه می‌ماند.</p>
          <textarea className="fin-input" rows={2} value={plan} placeholder={lesson.plan.example} onChange={(e) => (setPlan(e.target.value), setPlanSaved(false))} aria-label="برنامه اگر آنگاه" />
          <button
            className="fin-mini"
            disabled={!plan.trim()}
            onClick={() => {
              save({ ...s, plans: { ...s.plans, [lesson.id]: plan.trim().slice(0, 500) } });
              setPlanSaved(true);
            }}
          >
            {planSaved ? 'ذخیره شد ✓' : 'ذخیره برنامه'}
          </button>
        </div>
      ) : null}
      <div className="learn-nav">
        <button className="fin-mini ghost" onClick={onExit}>
          همه درس‌ها
        </button>
        {lesson.action ? (
          <Link className="btn run" href={lesson.action.href}>
            {lesson.action.label}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function Review({ s, save, today, onExit }: { s: LearnState; save: (x: LearnState) => void; today: string; onExit: () => void }) {
  // the deck is fixed when the review starts; answers move cards forward but do not reshuffle it
  const [deck] = useState(() => dueDeck(s, LESSONS, today));
  const [i, setI] = useState(0);
  const [right, setRight] = useState(0);
  const [cur, setCur] = useState(s);
  if (!deck.length || i >= deck.length)
    return (
      <section className="panel learn-lesson" data-testid="learn-review-done">
        <h2>مرور امروز تمام شد</h2>
        {deck.length ? (
          <p className="learn-big">
            {fa(right)} از {fa(deck.length)} درست. هر کارتِ درست یک قدم دورتر برمی‌گردد (۳، ۷، ۱۶، ۳۵ روز)؛ اشتباه‌ها فردا.
          </p>
        ) : (
          <p className="learn-big">امروز کارتی برای مرور نیست.</p>
        )}
        <button className="btn run" onClick={onExit}>
          همه درس‌ها
        </button>
      </section>
    );
  const card = deck[i];
  const found = questionById(card.cardId)!;
  return (
    <section className="panel learn-lesson" aria-label="مرور امروز" data-testid="learn-review">
      <p className="muted small">
        مرور امروز — کارت {fa(i + 1)} از {fa(deck.length)} · از درس «{found.lesson.title}»
      </p>
      <Question
        q={found.q}
        seed={today}
        label="از حافظه جواب دهید"
        onDone={(ok) => {
          const next = review(cur, card.cardId, ok, today);
          setCur(next);
          save(next);
          if (ok) setRight(right + 1);
          setI(i + 1);
        }}
      />
    </section>
  );
}

/**
 * Whatever goes wrong inside a lesson stays inside the section: the message (to report) and a way
 * back, instead of the app-wide error page.
 */
class LearnBoundary extends Component<{ children: ReactNode; onReset: () => void }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <section className="panel learn-lesson" role="alert" data-testid="learn-error">
        <h2>این بخش با خطا روبه‌رو شد</h2>
        <p>پیشرفت شما ذخیره است. اگر تکرار شد، از همین پیام عکس بفرستید تا رفع شود:</p>
        <pre className="learn-err" dir="ltr">
          {String(this.state.err?.message || this.state.err).slice(0, 400)}
        </pre>
        <button
          className="btn run"
          onClick={() => {
            this.setState({ err: null });
            this.props.onReset();
          }}
        >
          بازگشت به درس‌ها
        </button>
      </section>
    );
  }
}

type View = { kind: 'home' } | { kind: 'lesson'; id: string } | { kind: 'review' };

/** «آموزش»: short lessons, quizzes from memory, and a spaced daily review. */
export default function LearnView() {
  const { s, save, ready } = useLearn();
  const [today, setToday] = useState('2000-01-01');
  // which screen is shown is plain state, not a route change: moving between lessons never asks the
  // router (or, in the app, the local file server) for anything
  const [view, setView] = useState<View>({ kind: 'home' });
  useEffect(() => {
    setToday(tehranDate());
    // a link into a lesson (/learn?l=…) still opens it
    const q = new URLSearchParams(window.location.search);
    const l = q.get('l');
    if (l && lessonById(l)) setView({ kind: 'lesson', id: l });
    else if (q.get('review') === '1') setView({ kind: 'review' });
  }, []);
  const show = (v: View) => {
    setView(v);
    window.scrollTo({ top: 0 });
  };
  const home = () => show({ kind: 'home' });
  const lesson = view.kind === 'lesson' ? lessonById(view.id) : null;

  if (!ready)
    return (
      <div className="wrap">
        <p className="muted state">در حال بارگذاری…</p>
      </div>
    );
  if (lesson)
    return (
      <div className="wrap learn">
        <LearnBoundary onReset={home}>
          <LessonPlayer key={lesson.id} lesson={lesson} s={s} save={save} today={today} onExit={home} />
        </LearnBoundary>
      </div>
    );
  if (view.kind === 'review')
    return (
      <div className="wrap learn">
        <LearnBoundary onReset={home}>
          <Review s={s} save={save} today={today} onExit={home} />
        </LearnBoundary>
      </div>
    );

  const p = progress(s, LESSONS, today);
  const nxt = nextLesson(s, LESSONS);
  return (
    <div className="wrap learn">
      <LearnBoundary onReset={home}>
        <PageHead title="آموزش مالی">
          اقتصاد، بازار و نظم مالی به زبان ساده، در درس‌های چنددقیقه‌ای. هر درس با چند سؤال از حافظه تمام می‌شود و همان سؤال‌ها با فاصله‌ای که کم‌کم بیشتر می‌شود (۱، ۳، ۷، ۱۶ و ۳۵ روز) برای مرور
          برمی‌گردند — دو روشی که پژوهش‌های یادگیری بیشترین پشتوانه را برایشان دارند. هر جا عددی «سنجیده‌شده» آمده، روی داده واقعی همین اپ سنجیده شده است.
        </PageHead>

        <section className="panel learn-top" aria-label="پیشرفت">
          <dl className="fin-kpis tight">
            <div className="fin-stat">
              <dt>درس‌های تمام‌شده</dt>
              <dd>
                {fa(p.lessonsDone)} از {fa(p.lessonsTotal)}
              </dd>
            </div>
            <div className="fin-stat">
              <dt>کارت‌های جاافتاده</dt>
              <dd>
                {fa(p.strong)} از {fa(p.cards)}
              </dd>
              <dd className="fin-stat-sub">مرور فاصله‌دار ۱۶ روزه به بعد</dd>
            </div>
            <div className="fin-stat">
              <dt>روزهای یادگیری این هفته</dt>
              <dd>{fa(p.activeDays7)} روز</dd>
            </div>
          </dl>
          <div className="learn-cta">
            {p.dueToday ? (
              <button className="btn run" onClick={() => show({ kind: 'review' })} data-testid="learn-review-btn">
                مرور امروز ({fa(p.dueToday)} کارت)
              </button>
            ) : null}
            {nxt ? (
              <button className={p.dueToday ? 'fin-mini' : 'btn run'} onClick={() => show({ kind: 'lesson', id: nxt.id })}>
                درس بعدی: {nxt.title}
              </button>
            ) : (
              <p className="muted">همه درس‌ها را تمام کرده‌اید؛ مرور روزانه را ادامه دهید.</p>
            )}
          </div>
        </section>

        {TRACKS.map((t) => {
          const ls = LESSONS.filter((l) => l.track === t.key);
          return (
            <section key={t.key} className="panel learn-track" aria-labelledby={`tr-${t.key}`}>
              <h2 id={`tr-${t.key}`}>
                <span aria-hidden="true">{t.icon}</span> {t.title}
              </h2>
              <p className="muted small">{t.blurb}</p>
              <ul className="learn-list">
                {ls.map((l) => {
                  const done = s.lessons[l.id];
                  const cards = l.quiz.map((q) => s.cards[q.id]).filter(Boolean);
                  const mastered = cards.length && cards.every((c) => c!.box >= MASTERED);
                  return (
                    <li key={l.id}>
                      <button onClick={() => show({ kind: 'lesson', id: l.id })} className={done ? 'done' : ''}>
                        {l.art ? <Art k={l.art as ArtKey} className="learn-thumb" /> : null}
                        <span className="learn-li-t">
                          {done ? <span aria-label="تمام‌شده">✓ </span> : null}
                          {l.title}
                        </span>
                        <span className="learn-li-s muted small">
                          {l.summary} · {fa(l.minutes)} دقیقه
                          {done ? ` · ${mastered ? 'کاملاً جاافتاده' : `آزمون اول ${fa(Math.round(done.score * 100))}٪`}` : ''}
                        </span>
                      </button>
                      {s.plans[l.id] ? <p className="learn-myplan small">برنامه شما: {s.plans[l.id]}</p> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        <p className="note">پیشرفت و برنامه‌های شما فقط روی همین دستگاه می‌ماند و به هیچ سروری فرستاده نمی‌شود.</p>
      </LearnBoundary>
    </div>
  );
}
