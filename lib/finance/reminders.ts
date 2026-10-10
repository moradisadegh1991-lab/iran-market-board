// یادآوری سررسید — an installment, a cheque, a bill or a loan with a person, reminded `settings.reminderDays` before its
// date (rule 90). Pure: the plan of what to remind and when, and one step of keeping the phone's scheduled notifications
// in line with the book. Each due is reminded once: by a notification the phone itself posts at 09:00 Tehran on the day
// (scheduled through Android's AlarmManager, so it comes with the app closed), or — on the website, or when the day has
// already come — the moment the app opens.
import { addDays, daysBetween, upcoming, type Due } from './calc';
import type { FinanceData, Iso } from './model';
import { isoToJalali, JALALI_MONTHS } from '@/lib/jalali';

/** how far ahead notifications are scheduled on the phone (a due further away is scheduled on a later opening) */
export const SCHEDULE_AHEAD_DAYS = 60;
/** Android keeps a limited number of alarms per app; this is far below it */
export const MAX_SCHEDULED = 40;
/** notification ids of reminders: a range the random ids of other notifications never reach (they stay below 2e9) */
export const REMINDER_ID_BASE = 2_000_000_001;

export interface Reminder {
  key: string;
  date: Iso;
  label: string;
  /** + money coming in, − going out */
  rial: number;
  type: Due['type'];
  /** ms: 09:00 Tehran, `days` before the date */
  at: number;
  id: number;
}

/** 09:00 in Tehran (no daylight saving since 1401: +03:30) */
export const tehranMorning = (iso: Iso) => Date.parse(`${iso}T09:00:00+03:30`);

function idOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return REMINDER_ID_BASE + (h % 100_000_000);
}

/** what is reminded: everything owed or to collect by a date — not expected income (that is not a duty) */
export function reminderPlan(d: FinanceData, today: Iso, days = d.settings.reminderDays, ahead = SCHEDULE_AHEAD_DAYS): Reminder[] {
  const lead = Math.max(0, Math.round(days));
  return upcoming(d, today, ahead + lead)
    .filter((x) => x.type !== 'income')
    .map((x) => ({ key: x.key, date: x.date, label: x.label, rial: x.rial, type: x.type, at: tehranMorning(addDays(x.date, -lead)), id: idOf(x.key) }));
}

const fa = (n: number) => Math.round(n).toLocaleString('fa-IR');
function faDate(iso: Iso): string {
  const j = isoToJalali(iso);
  return `${fa(j.jd)} ${JALALI_MONTHS[j.jm - 1]}`;
}
function faToman(rial: number): string {
  const t = Math.abs(rial) / 10;
  if (t >= 1e6) return `${(t / 1e6).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} میلیون تومان`;
  return `${fa(t)} تومان`;
}
export function whenText(today: Iso, date: Iso): string {
  const n = daysBetween(today, date);
  if (n < 0) return `${fa(-n)} روز گذشته`;
  if (n === 0) return 'امروز';
  if (n === 1) return 'فردا';
  return `${fa(n)} روز دیگر`;
}

/** the notification of one reminder; `today` is the day it is shown (a scheduled one: its own morning) */
export function reminderText(r: Reminder, today: Iso): { title: string; body: string } {
  const verb = r.rial < 0 ? 'پرداخت' : 'دریافت';
  return { title: `یادآوری: ${r.label}`, body: `${whenText(today, r.date)} (${faDate(r.date)})، ${verb} ${faToman(r.rial)}.` };
}

export interface ReminderState {
  /** keys already reminded (newest last) */
  done: string[];
  /** reminders the phone holds as scheduled notifications */
  sched: Record<string, { id: number; at: number }>;
}
export const emptyReminderState = (): ReminderState => ({ done: [], sched: {} });
export function normalizeReminderState(raw: unknown): ReminderState {
  const o = raw && typeof raw === 'object' ? (raw as Partial<ReminderState>) : {};
  const sched: ReminderState['sched'] = {};
  if (o.sched && typeof o.sched === 'object')
    for (const [k, v] of Object.entries(o.sched)) if (v && typeof v.id === 'number' && typeof v.at === 'number') sched[k] = { id: v.id, at: v.at };
  return { done: Array.isArray(o.done) ? o.done.filter((x): x is string => typeof x === 'string') : [], sched };
}

export interface ReminderStep {
  /** to show now (in the app, and as a notification) — already summarized when many */
  now: { title: string; body: string }[];
  /** to hand to the phone's alarm, posted at `at` */
  schedule: { id: number; at: number; title: string; body: string }[];
  /** scheduled notifications that no longer apply (paid, deleted, date or lead changed) */
  cancel: number[];
  state: ReminderState;
}

/**
 * One pass: what to show now, what to schedule, what to cancel. `canSchedule` is false on the website (and on a phone
 * that refused notifications): then a reminder is shown when its morning has come and the app is opened. `enabled`
 * false (the user turned reminders off) cancels everything scheduled and shows nothing.
 */
export function reminderStep(plan: Reminder[], prev: ReminderState, now: number, today: Iso, canSchedule: boolean, enabled = true): ReminderStep {
  const done = new Set(prev.done);
  const sched: ReminderState['sched'] = {};
  const cancel: number[] = [];
  const schedule: ReminderStep['schedule'] = [];
  const due: Reminder[] = [];
  const live = new Map(plan.map((r) => [r.key, r]));
  for (const [key, s] of Object.entries(prev.sched)) {
    const r = live.get(key);
    if (!enabled || !r || done.has(key)) {
      if (s.at > now) cancel.push(s.id);
      continue;
    }
    // its morning passed while the phone held it: the phone has shown it
    if (s.at <= now) {
      done.add(key);
      continue;
    }
    if (r.at !== s.at) {
      cancel.push(s.id);
      continue;
    }
    sched[key] = s;
  }
  if (enabled)
    for (const r of plan) {
      if (done.has(r.key) || sched[r.key]) continue;
      if (r.at <= now) {
        due.push(r);
        done.add(r.key);
      } else if (canSchedule && Object.keys(sched).length < MAX_SCHEDULED) {
        sched[r.key] = { id: r.id, at: r.at };
        schedule.push({ id: r.id, at: r.at, ...reminderText(r, new Date(r.at + 3.5 * 3600e3).toISOString().slice(0, 10)) });
      }
    }
  let shown: ReminderStep['now'] = due.map((r) => reminderText(r, today));
  if (due.length > 3) {
    const out = due.filter((r) => r.rial < 0).reduce((s, r) => s - r.rial, 0);
    shown = [
      {
        title: `یادآوری: ${fa(due.length)} سررسید نزدیک یا گذشته`,
        body: `${due.slice(0, 3).map((r) => r.label).join('، ')} و ${fa(due.length - 3)} مورد دیگر${out ? `؛ روی هم ${faToman(out)} پرداختی` : ''}.`,
      },
    ];
  }
  return { now: shown, schedule, cancel, state: { done: [...done].slice(-300), sched } };
}
