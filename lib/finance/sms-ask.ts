// What the user picked in the «نوعش چیست؟» notification, applied to the book — the pure half.
//
// The phone asks the moment a bank SMS arrives, app open or closed (android-app/native-plugin:
// SmsAskReceiver → SmsAsk). The tap is stored on the phone; the book lives in this WebView's
// storage, so it is applied here when the app runs (AppStartup), then the phone forgets it.
//
//  • The row is built by the same JS path as every SMS (rowsFromMessages), so it is identical to
//    what the inbox read would queue; sameSms() keeps the two from becoming two rows.
//  • The choice is the user's own answer, so it may set a direction the SMS left out (CLAUDE.md
//    rule 3 forbids guessing, not asking). A choice that contradicts the bank is not applied.
//  • «هزینه»/«درآمد» on a card linked to an account is booked straight away (category: the user's
//    earlier choice for the same text, else keywords). Everything else stays in the queue with the
//    choice pre-selected: a transfer needs the other account, an unknown card needs its account,
//    a half-read amount needs checking, a look-alike of a booked transaction needs a look.
import { choicesFor, commitStaged, isDuplicate, rowsFromMessages, suggestCategory, type StagedChoice } from './importers';
import type { FinanceData, Iso } from './model';
import { queueSms, seenSms } from './sources';
import { smsParser } from './sms';

/** One record from the phone (SmsReaderPlugin.asked). */
export interface AskedSms {
  key: string;
  address?: string;
  body: string;
  at: number;
  amountRial?: number;
  direction?: 'out' | 'in' | null;
  choice?: StagedChoice | null;
  chosenAt?: number;
}

export interface AskApplied {
  /** booked into the ledger */
  booked: number;
  /** answered, waiting in the queue for the rest (account, other account, amount check) */
  queued: number;
  /** records the phone can forget: applied, or already booked another way */
  done: string[];
  /** smsKeys of every record — inbox rows with these were already announced by the phone */
  announced: Set<string>;
}

const VALID: StagedChoice[] = ['expense', 'income', 'transfer-out', 'transfer-in'];

export function applyAsked(d: FinanceData, items: AskedSms[], today: Iso, now: number): AskApplied {
  const out: AskApplied = { booked: 0, queued: 0, done: [], announced: new Set() };
  for (const it of items) {
    if (!it || typeof it.key !== 'string' || typeof it.body !== 'string') continue;
    const row = rowsFromMessages([{ body: it.body, at: Number(it.at) || undefined, address: it.address || undefined }], smsParser, today, { now }).rows[0];
    if (!row) {
      // the phone and the app disagree on whether this is a transaction (scripts/native-sms-test.ts
      // keeps them identical); nothing to apply
      out.done.push(it.key);
      continue;
    }
    if (row.smsKey) out.announced.add(row.smsKey);
    const seen = seenSms(d, row);
    if (seen?.booked) {
      out.done.push(it.key); // booked in the app before the button was tapped
      continue;
    }
    if (!seen) {
      queueSms(d, [row], now); // learns the card; a linked card brings its account
      // a loan told by voice before this SMS came took it (rule 88): nothing left to ask
      if (seenSms(d, row)?.booked) {
        out.done.push(it.key);
        continue;
      }
    }
    const s = seen?.queued ?? d.inbox.find((x) => x.id === row.id);
    const choice = it.choice && VALID.includes(it.choice) ? it.choice : null;
    if (!s || !choice) continue; // not answered yet: the question stays on the phone

    out.done.push(it.key);
    const dir = choice === 'expense' || choice === 'transfer-out' ? 'out' : 'in';
    if (s.direction && s.direction !== dir) continue; // contradicts the bank — the queue shows the row as the bank said
    s.direction = dir;
    s.transfer = choice.startsWith('transfer');
    s.why = `نوع را در اعلان گوشی گفتید: ${choice === 'expense' ? 'هزینه' : choice === 'income' ? 'درآمد' : 'انتقال بین حساب‌های خودتان'}`;
    if (!choicesFor(s).includes(choice)) continue;

    const canBook = (choice === 'expense' || choice === 'income') && !!s.accountId && !!s.date && !s.uncertainAmount && !isDuplicate(d, s);
    if (canBook && commitStaged(d, s.id, { choice, accountId: s.accountId!, categoryId: suggestCategory(d, s) }) === null) out.booked++;
    else out.queued++;
  }
  return out;
}
