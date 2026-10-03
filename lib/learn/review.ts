// The learning section's memory — the pure half (components/learn/LearnView.tsx draws it).
//
// Three methods with good evidence behind them, kept small:
//  • retrieval practice: every lesson ends with questions answered from memory, not re-reading;
//  • spaced repetition: each question comes back on a Leitner schedule — 1, 3, 7, 16, 35 days —
//    a step further after a right answer, back to the first box after a wrong one;
//  • interleaving: the daily review mixes questions from different lessons instead of one block.
// Stored on the device only (localStorage, like the rest of «مالی من»; CLAUDE.md rule 7).
import type { Lesson } from './lessons';

export const LEARN_KEY = 'imf.learn.v1';

/** days until the next review, per box (box 1 … 5); a right answer in box 5 retires the card */
export const BOX_DAYS = [1, 3, 7, 16, 35] as const;
export const MASTERED = BOX_DAYS.length + 1;

export interface CardState {
  /** 1 … 5, or MASTERED */
  box: number;
  /** ISO day the card is due */
  due: string;
  right: number;
  wrong: number;
}

export interface LearnState {
  v: 1;
  cards: Record<string, CardState>;
  /** lesson id → the day it was finished and the share of its questions answered right the first time */
  lessons: Record<string, { done: string; score: number }>;
  /** the user's own «if … then …» plans, written after a lesson */
  plans: Record<string, string>;
  /** distinct days with any learning, newest last (kept to 60) */
  days: string[];
}

export const emptyLearn = (): LearnState => ({ v: 1, cards: {}, lessons: {}, plans: {}, days: [] });

const DAY = 86_400_000;
export const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Reads whatever was stored; anything malformed becomes an empty state rather than an error. */
export function normalizeLearn(raw: unknown): LearnState {
  const s = emptyLearn();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Partial<LearnState>;
  const iso = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
  if (r.cards && typeof r.cards === 'object')
    for (const [k, c] of Object.entries(r.cards)) {
      if (!c || typeof c !== 'object') continue;
      const box = Math.round(Number(c.box));
      if (box >= 1 && box <= MASTERED && iso(c.due)) s.cards[k] = { box, due: c.due, right: Math.max(0, Number(c.right) || 0), wrong: Math.max(0, Number(c.wrong) || 0) };
    }
  if (r.lessons && typeof r.lessons === 'object')
    for (const [k, l] of Object.entries(r.lessons)) if (l && iso(l.done)) s.lessons[k] = { done: l.done, score: Math.min(1, Math.max(0, Number(l.score) || 0)) };
  if (r.plans && typeof r.plans === 'object') for (const [k, p] of Object.entries(r.plans)) if (typeof p === 'string' && p.trim()) s.plans[k] = p.slice(0, 500);
  if (Array.isArray(r.days)) s.days = [...new Set(r.days.filter(iso))].sort().slice(-60);
  return s;
}

function touch(s: LearnState, today: string) {
  if (!s.days.includes(today)) s.days = [...s.days, today].sort().slice(-60);
}

/**
 * A lesson's quiz, answered for the first time. Each question becomes a card: right → box 2
 * (back in 3 days), wrong → box 1 (back tomorrow). Finishing a lesson again keeps the cards' boxes.
 */
export function finishLesson(s: LearnState, lesson: Lesson, answers: Record<string, boolean>, today: string): LearnState {
  const next: LearnState = { ...s, cards: { ...s.cards }, lessons: { ...s.lessons } };
  const qs = lesson.quiz;
  const right = qs.filter((q) => answers[q.id]).length;
  for (const q of qs) {
    if (next.cards[q.id]) continue;
    const ok = !!answers[q.id];
    next.cards[q.id] = { box: ok ? 2 : 1, due: addDaysIso(today, ok ? BOX_DAYS[1] : BOX_DAYS[0]), right: ok ? 1 : 0, wrong: ok ? 0 : 1 };
  }
  if (!next.lessons[lesson.id]) next.lessons[lesson.id] = { done: today, score: qs.length ? right / qs.length : 1 };
  touch(next, today);
  return next;
}

/** A review answer: one box up (or retired) when right, back to box 1 when wrong. */
export function review(s: LearnState, cardId: string, ok: boolean, today: string): LearnState {
  const c = s.cards[cardId];
  if (!c) return s;
  const box = ok ? Math.min(MASTERED, c.box + 1) : 1;
  const card: CardState = {
    box,
    due: box >= MASTERED ? '9999-12-31' : addDaysIso(today, BOX_DAYS[box - 1]),
    right: c.right + (ok ? 1 : 0),
    wrong: c.wrong + (ok ? 0 : 1),
  };
  const next = { ...s, cards: { ...s.cards, [cardId]: card } };
  touch(next, today);
  return next;
}

/** deterministic shuffle (the same deck all day, a different order the next day) */
function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 2 ** 32;
}

/**
 * Today's review deck: every card due today or earlier, the most overdue first, then interleaved —
 * no two cards of the same lesson next to each other when it can be avoided. At most `max`.
 */
export function dueDeck(s: LearnState, lessons: Lesson[], today: string, max = 12): { cardId: string; lessonId: string }[] {
  const owner = new Map<string, string>();
  for (const l of lessons) for (const q of l.quiz) owner.set(q.id, l.id);
  const rnd = seeded(today);
  const due = Object.entries(s.cards)
    .filter(([id, c]) => owner.has(id) && c.box < MASTERED && c.due <= today)
    .map(([id, c]) => ({ cardId: id, lessonId: owner.get(id)!, due: c.due, r: rnd() }))
    .sort((a, b) => (a.due === b.due ? a.r - b.r : a.due < b.due ? -1 : 1))
    .slice(0, max);
  // interleave: take the next card whose lesson differs from the previous one
  const out: { cardId: string; lessonId: string }[] = [];
  const rest = [...due];
  while (rest.length) {
    const prev = out[out.length - 1]?.lessonId;
    const k = rest.findIndex((x) => x.lessonId !== prev);
    const [x] = rest.splice(k < 0 ? 0 : k, 1);
    out.push({ cardId: x.cardId, lessonId: x.lessonId });
  }
  return out;
}

/** The next lesson to read: the first unfinished one in course order. */
export function nextLesson(s: LearnState, lessons: Lesson[]): Lesson | null {
  return lessons.find((l) => !s.lessons[l.id]) ?? null;
}

export interface LearnProgress {
  lessonsDone: number;
  lessonsTotal: number;
  /** cards in box ≥ 4 or retired — remembered over weeks */
  strong: number;
  cards: number;
  dueToday: number;
  /** days with learning in the last 7 */
  activeDays7: number;
}

export function progress(s: LearnState, lessons: Lesson[], today: string): LearnProgress {
  const ids = new Set(lessons.flatMap((l) => l.quiz.map((q) => q.id)));
  const cards = Object.entries(s.cards).filter(([id]) => ids.has(id));
  const weekAgo = addDaysIso(today, -6);
  return {
    lessonsDone: lessons.filter((l) => s.lessons[l.id]).length,
    lessonsTotal: lessons.length,
    strong: cards.filter(([, c]) => c.box >= 4).length,
    cards: cards.length,
    dueToday: cards.filter(([, c]) => c.box < MASTERED && c.due <= today).length,
    activeDays7: s.days.filter((d) => d >= weekAgo && d <= today).length,
  };
}
