'use client';
// تنظیمات (rule 91): every setting of the app on one page, each part of the app in its own section — reminders, notifications,
// bank SMS, the voice assistant, the figures calculations rest on, the business, and the backup. The sections reuse the
// very components the pages had (AlertsView, Assistant, SettingsParts), so a setting changed here is the same setting there.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Bell, CalendarClock, Database, Mic, Percent, Smartphone, Store, type LucideIcon } from 'lucide-react';
import { reminderPlan, whenText } from '@/lib/finance/reminders';
import { askOn, autoReadOn, setAskOn, setAutoRead, useSmsPlugin } from '@/lib/finance/phone-sms';
import { MAX_REMINDER_DAYS, type FinanceData } from '@/lib/finance/model';
import { addDays } from '@/lib/finance/calc';
import { VOICE_SPEAK_KEY, voiceIO, type VoiceIO } from '@/lib/voice-io';
import { useNotify } from '../NotifyProvider';
import { PageHead, Toggle } from '../ui';
import { useFinance, WithBook } from '../finance/FinanceProvider';
import { Card, fmtDateFa, Money } from '../finance/kit';
import { Backup, SettingsCard } from '../finance/SettingsParts';
import { NotifySettings } from './AlertsView';
import { VoicePicker, WakeSettings } from '../assistant/Assistant';

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'set-remind', label: 'یادآوری سررسید', icon: CalendarClock },
  { id: 'set-notify', label: 'اعلان‌ها', icon: Bell },
  { id: 'set-sms', label: 'پیامک بانکی', icon: Smartphone },
  { id: 'set-voice', label: 'دستیار صوتی', icon: Mic },
  { id: 'set-money', label: 'محاسبات مالی', icon: Percent },
  { id: 'set-biz', label: 'کسب‌وکار', icon: Store },
  { id: 'set-backup', label: 'پشتیبان', icon: Database },
];

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  const s = SECTIONS.find((x) => x.id === id)!;
  const I = s.icon;
  return (
    <section id={id} className="set-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="set-h">
        <I size={18} strokeWidth={2} aria-hidden="true" /> {s.label}
      </h2>
      {children}
    </section>
  );
}

const LEADS = [0, 1, 2, 3, 5, 7, 10, 14, 30];

function Reminders({ d }: { d: FinanceData }) {
  const { update, today } = useFinance();
  const { prefs, setPrefs, native } = useNotify();
  const lead = d.settings.reminderDays;
  const on = prefs.on && prefs.due;
  const next = reminderPlan(d, today, lead, 45).slice(0, 4);
  return (
    <Card>
      <p className="muted small">قسط وام، چک، قبض و قرضی که موعد بازپرداخت دارد، چند روز قبل از موعدش یادآوری می‌شود:</p>
      <div className="chips" role="radiogroup" aria-label="چند روز قبل یادآوری شود">
        {LEADS.filter((x) => x <= MAX_REMINDER_DAYS).map((x) => (
          <button key={x} type="button" role="radio" aria-checked={lead === x} onClick={() => update((dr) => void (dr.settings.reminderDays = x))}>
            {x === 0 ? 'همان روز' : `${x.toLocaleString('fa-IR')} روز قبل`}
          </button>
        ))}
      </div>
      <Toggle checked={on} onChange={(v) => setPrefs({ ...prefs, on: v ? true : prefs.on, due: v })}>
        اعلان یادآوری بده
      </Toggle>
      <p className="muted small">
        {native
          ? 'روی گوشی، یادآوری ساعت ۹ صبح همان روز می‌آید، حتی وقتی اپ بسته است (اگر «بهینه‌سازی باتری» اندروید جلویش را نگیرد). روی صفحه قفل فقط «محتوا پنهان» نشان داده می‌شود.'
          : 'در مرورگر، یادآوری وقتی سایت را باز کنید می‌آید؛ اپ اندروید آن را ساعت ۹ صبح همان روز حتی با اپ بسته می‌دهد.'}{' '}
        هر سررسید یک بار یادآوری می‌شود و روی خانه هم تا موعدش دیده می‌شود. موعد قرض را در «قرض» فرم تراکنش یا کارت «قرض با اشخاص» بگذارید.
      </p>
      {next.length ? (
        <ul className="fin-list" data-testid="remind-next">
          {next.map((r) => {
            const day = addDays(r.date, -lead);
            const passed = r.at <= Date.now();
            return (
              <li key={r.key}>
                <span className="fin-list-main">
                  <b>{r.label}</b>
                  <small>
                    موعد {fmtDateFa(r.date)} ({whenText(today, r.date)})؛ {passed ? 'زمان یادآوری‌اش رسیده' : `یادآوری ${fmtDateFa(day)}`}
                  </small>
                </span>
                <Money rial={r.rial} signed />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="note">فعلاً قسط، چک، قبض یا قرض با موعدی ثبت نشده. <Link href="/debts">وام، چک و قبض</Link></p>
      )}
    </Card>
  );
}

function SmsSettings() {
  const plugin = useSmsPlugin();
  const [auto, setAuto] = useState(false);
  const [ask, setAsk] = useState(false);
  useEffect(() => {
    setAuto(autoReadOn());
    setAsk(askOn());
  }, []);
  if (!plugin)
    return (
      <Card>
        <p className="muted small">
          خواندن پیامک بانکی فقط در اپ اندروید است؛ در مرورگر متن پیامک را در <Link href="/import">ورود از بانک و پیامک</Link> بچسبانید.
        </p>
      </Card>
    );
  return (
    <Card>
      <Toggle
        checked={auto}
        onChange={(v) => {
          setAuto(v);
          setAutoRead(v);
        }}
      >
        پیامک‌های بانکی تازه را خودکار بخوان (هنگام باز کردن اپ و هر ۳۰ ثانیه وقتی اپ باز است)
      </Toggle>
      {plugin.asked ? (
        <Toggle
          checked={ask}
          onChange={(v) => {
            setAsk(v);
            setAskOn(v, plugin);
          }}
        >
          همان لحظه رسیدن پیامک بانکی بپرس هزینه بود، درآمد یا انتقال — حتی وقتی اپ بسته است
        </Toggle>
      ) : null}
      <p className="muted small">
        پیامک‌ها از گوشی بیرون نمی‌روند. صف پیامک‌ها و کارت‌های شناخته‌شده در <Link href="/import">ورود از بانک و پیامک</Link> است.
      </p>
    </Card>
  );
}

function VoiceSettings() {
  const [speak, setSpeak] = useState(true);
  const [io, setIo] = useState<VoiceIO | null>(null);
  const [loading, setLoading] = useState(false);
  const ioRef = useRef<VoiceIO | null>(null);
  useEffect(() => {
    try {
      setSpeak(localStorage.getItem(VOICE_SPEAK_KEY) !== '0');
    } catch {
      // default on
    }
    return () => ioRef.current?.cancel();
  }, []);
  return (
    <Card>
      <Toggle
        checked={speak}
        onChange={(v) => {
          setSpeak(v);
          try {
            localStorage.setItem(VOICE_SPEAK_KEY, v ? '1' : '0');
          } catch {
            // this session only
          }
          if (!v) ioRef.current?.hush();
        }}
      >
        دستیار جواب‌ها را با صدا بخواند
      </Toggle>
      {speak ? (
        io ? (
          io.canSpeak ? (
            <VoicePicker io={io} onSample={(t) => void io.speak(t).catch(() => undefined)} />
          ) : (
            <p className="muted small" data-testid="no-voice">
              این دستگاه صدای فارسی برای خواندن ندارد؛ دستیار جواب‌ها را می‌نویسد.
            </p>
          )
        ) : (
          <button
            type="button"
            className="fin-mini"
            disabled={loading}
            onClick={() => {
              // the voice engine is loaded only when asked for (rule 72)
              setLoading(true);
              void voiceIO()
                .then((x) => {
                  ioRef.current = x;
                  setIo(x);
                })
                .finally(() => setLoading(false));
            }}
          >
            {loading ? 'در حال آماده کردن صدا…' : 'انتخاب صدا و سرعت گفتن'}
          </button>
        )
      ) : null}
      <WakeSettings />
      <p className="muted small">دستیار با دکمه میکروفون بالای هر صفحه باز می‌شود. هیچ تراکنش، فروش یا نوبتی بدون «بله» ثبت نمی‌شود.</p>
    </Card>
  );
}

function Biz({ d }: { d: FinanceData }) {
  return (
    <Card>
      {d.biz ? (
        <p className="muted small">
          نام، نوع، ساعت کاری، صندوق و کارت، مالیات و فروشگاه آنلاین «{d.biz.name}» در <Link href="/biz/settings">تنظیمات کسب‌وکار</Link> است.
        </p>
      ) : (
        <p className="muted small">
          کسب‌وکاری راه نینداخته‌اید. اگر مغازه، کافه یا کار خدماتی دارید، از <Link href="/biz">داشبورد کسب‌وکار</Link> شروع کنید.
        </p>
      )}
    </Card>
  );
}

function Page({ d }: { d: FinanceData }) {
  return (
    <>
      <PageHead title="تنظیمات">همه تنظیمات اپ، هر بخش جدا. همه روی همین دستگاه ذخیره می‌شوند.</PageHead>
      <nav className="chips set-index" aria-label="بخش‌های تنظیمات">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            {s.label}
          </button>
        ))}
      </nav>
      <Section id="set-remind">
        <Reminders d={d} />
      </Section>
      <Section id="set-notify">
        <NotifySettings />
        <p className="muted small">
          هشدارهای قیمت (مثلاً «دلار به … رسید») و فهرست اعلان‌های اخیر در <Link href="/alerts">هشدار و اعلان</Link> است.
        </p>
      </Section>
      <Section id="set-sms">
        <SmsSettings />
      </Section>
      <Section id="set-voice">
        <VoiceSettings />
      </Section>
      <Section id="set-money">
        <SettingsCard d={d} />
      </Section>
      <Section id="set-biz">
        <Biz d={d} />
      </Section>
      <Section id="set-backup">
        <Backup d={d} />
      </Section>
    </>
  );
}

export default function SettingsView() {
  return (
    <div className="wrap">
      <WithBook>{(d) => <Page d={d} />}</WithBook>
    </div>
  );
}
