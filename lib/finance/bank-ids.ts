// شماره کارت، شبا و شماره حساب (rule 92) — checked and read on the device, never sent anywhere.
//
// What can be done offline, and what cannot:
//  - card (16 digits): the Luhn check digit says a mistyped number is wrong; its first six digits (BIN) name the bank.
//  - شبا (IR + 24 digits, ISO 13616): the two check digits (mod 97) catch a mistyped number; digits 5–7 name the bank.
//    For three banks (Parsian, Pasargad, Shahr) the account number sits inside the شبا in a known way and is read out.
//  - card → شبا or account, account → شبا, and the holder's name: not computable — the bank (through Shaparak and the
//    Central Bank's inquiry services) is the only source, offered to businesses as paid APIs (Finnotech, Jibit, …).
//    Using one would send the number off the device (rule 7); not built.
//
// Bank tables: from @persian-tools/persian-tools 4.0.4 (MIT license) — the BIN list and the شبا bank codes, with its
// account-from-شبا rules for the three banks above. Ansar, Ghavamin, Hekmat Iranian, Kosar and Mehr Eqtesad merged into
// Sepah (1399–1400); their old cards and شبا numbers still name the old bank.

/** Persian/Arabic digits to ASCII; spaces, dashes, dots and half-spaces dropped */
export function cleanDigits(raw: string): string {
  return raw
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\s‌‏‎\-_.*/]/g, '')
    .toUpperCase();
}

const BINS: Record<string, string> = {
  '170019': 'بانک ملی ایران', '207177': 'بانک توسعه صادرات', '502229': 'بانک پاسارگاد', '502806': 'بانک شهر', '502908': 'بانک توسعه تعاون',
  '502910': 'بانک کارآفرین', '502938': 'بانک دی', '504172': 'بانک رسالت', '504706': 'بانک شهر', '505416': 'بانک گردشگری', '505426': 'بانک گردشگری',
  '505785': 'بانک ایران زمین', '505801': 'موسسه کوثر', '507677': 'موسسه نور', '585947': 'بانک خاورمیانه', '585983': 'بانک تجارت', '589210': 'بانک سپه',
  '589463': 'بانک رفاه کارگران', '603769': 'بانک صادرات ایران', '603770': 'بانک کشاورزی', '603799': 'بانک ملی ایران', '606256': 'موسسه اعتباری ملل',
  '606373': 'بانک مهر ایران', '610433': 'بانک ملت', '621986': 'بانک سامان', '622106': 'بانک پارسیان', '627353': 'بانک تجارت', '627381': 'بانک انصار',
  '627412': 'بانک اقتصاد نوین', '627488': 'بانک کارآفرین', '627648': 'بانک توسعه صادرات', '627760': 'پست بانک ایران', '627884': 'بانک پارسیان',
  '627961': 'بانک صنعت و معدن', '628023': 'بانک مسکن', '628157': 'موسسه اعتباری توسعه', '636214': 'بانک آینده', '636795': 'بانک مرکزی',
  '636797': 'بانک مرکزی', '636949': 'بانک حکمت ایرانیان', '639194': 'بانک پارسیان', '639217': 'بانک کشاورزی', '639346': 'بانک سینا',
  '639347': 'بانک پاسارگاد', '639370': 'بانک قرض الحسنه مهر', '639599': 'بانک قوامین', '639607': 'بانک سرمایه', '903769': 'بانک صادرات ایران',
  '991975': 'بانک ملت',
};

const SHEBA_BANKS: Record<string, string> = {
  '010': 'بانک مرکزی', '011': 'بانک صنعت و معدن', '012': 'بانک ملت', '013': 'بانک رفاه کارگران', '014': 'بانک مسکن', '015': 'بانک سپه',
  '016': 'بانک کشاورزی', '017': 'بانک ملی ایران', '018': 'بانک تجارت', '019': 'بانک صادرات ایران', '020': 'بانک توسعه صادرات', '021': 'پست بانک ایران',
  '022': 'بانک توسعه تعاون', '051': 'موسسه اعتباری توسعه', '052': 'بانک قوامین', '053': 'بانک کارآفرین', '054': 'بانک پارسیان',
  '055': 'بانک اقتصاد نوین', '056': 'بانک سامان', '057': 'بانک پاسارگاد', '058': 'بانک سرمایه', '059': 'بانک سینا', '060': 'بانک مهر ایران',
  '061': 'بانک شهر', '062': 'بانک آینده', '063': 'بانک انصار', '064': 'بانک گردشگری', '065': 'بانک حکمت ایرانیان', '066': 'بانک دی',
  '069': 'بانک ایران زمین', '070': 'بانک قرض الحسنه رسالت', '073': 'موسسه اعتباری کوثر', '075': 'موسسه اعتباری ملل', '078': 'بانک خاورمیانه',
  '079': 'بانک مهر اقتصاد', '080': 'موسسه اعتباری نور', '090': 'بانک مهر ایران', '095': 'بانک ایران و ونزوئلا',
};

const MERGED_INTO_SEPAH = new Set(['بانک انصار', 'بانک قوامین', 'بانک حکمت ایرانیان', 'موسسه اعتباری کوثر', 'موسسه کوثر', 'بانک مهر اقتصاد']);
/** «بانک انصار (ادغام‌شده در سپه)» */
const withMerger = (b: string | null) => (b && MERGED_INTO_SEPAH.has(b) ? `${b} (ادغام‌شده در بانک سپه)` : b);

/** the Luhn check every Shetab card carries in its last digit */
export function luhnOk(digits: string): boolean {
  if (!/^\d{16}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i++) {
    let x = +digits[i] * (i % 2 === 0 ? 2 : 1);
    if (x > 9) x -= 9;
    sum += x;
  }
  return sum % 10 === 0;
}

export interface CardInfo {
  digits: string;
  ok: boolean;
  bank: string | null;
  /** 6037-9912-3456-7890, always left-to-right */
  formatted: string;
  problem: string | null;
}
export function cardInfo(raw: string): CardInfo {
  const digits = cleanDigits(raw);
  const bank = withMerger(BINS[digits.slice(0, 6)] ?? null);
  const formatted = digits.replace(/(\d{4})(?=\d)/g, '$1-');
  const problem = !/^\d+$/.test(digits)
    ? 'شماره کارت فقط رقم دارد.'
    : digits.length !== 16
      ? `شماره کارت ۱۶ رقم است؛ این ${digits.length.toLocaleString('fa-IR')} رقم دارد.`
      : !luhnOk(digits)
        ? 'رقم کنترل کارت نمی‌خواند — احتمالاً یک رقم اشتباه نوشته شده.'
        : null;
  return { digits, ok: !problem, bank, formatted, problem };
}

/** ISO 7064 mod 97-10 over IR + 24 digits */
export function shebaChecksumOk(iban: string): boolean {
  if (!/^IR\d{24}$/.test(iban)) return false;
  // move IR + check digits to the end, letters to numbers (I=18, R=27)
  const s = iban.slice(4) + '1827' + iban.slice(2, 4);
  let r = 0;
  for (const c of s) r = (r * 10 + +c) % 97;
  return r === 1;
}

export interface ShebaInfo {
  /** IR + 24 digits */
  iban: string;
  ok: boolean;
  bank: string | null;
  /** IR82 0540 1026 8002 0817 9090 02 */
  formatted: string;
  /** the account number inside it, for the banks whose شبا carries it in a known way (Parsian, Pasargad, Shahr) */
  account: string | null;
  problem: string | null;
}
export function shebaInfo(raw: string): ShebaInfo {
  let iban = cleanDigits(raw);
  if (/^\d{24}$/.test(iban)) iban = `IR${iban}`;
  const code = iban.slice(4, 7);
  const bank = /^IR\d{24}$/.test(iban) ? withMerger(SHEBA_BANKS[code] ?? null) : null;
  const problem = !/^IR\d+$/.test(iban)
    ? 'شبا با IR شروع می‌شود و بعدش فقط رقم دارد.'
    : iban.length !== 26
      ? `شبا IR و ۲۴ رقم است؛ این ${(iban.length - 2).toLocaleString('fa-IR')} رقم دارد.`
      : !shebaChecksumOk(iban)
        ? 'رقم‌های کنترل شبا نمی‌خواند — احتمالاً یک رقم اشتباه نوشته شده.'
        : null;
  return { iban, ok: !problem, bank, formatted: iban.replace(/(.{4})(?=.)/g, '$1 '), account: problem ? null : accountInSheba(iban), problem };
}

/** @persian-tools rules (MIT): where the account number sits in a شبا of these banks */
function accountInSheba(iban: string): string | null {
  const code = iban.slice(4, 7);
  if (code === '054') {
    // Parsian: the last 12 digits, written 0XX-0XXXXXXX-XXX
    const u = iban.substring(14);
    return `0${u.substr(0, 2)}-0${u.substr(2, 7)}-${u.substr(9, 3)}`;
  }
  if (code === '057') {
    // Pasargad: after the bank code, without leading zeros and the last two digits, written XXX-XXX-XXXXXXXX-X
    const u = iban.substring(7).replace(/^0+/, '').slice(0, -2);
    return `${u.substr(0, 3)}-${u.substr(3, 3)}-${u.substr(6, 8)}-${u.substr(14, 1)}`.replace(/-+$/, '');
  }
  if (code === '061') return iban.substring(7).replace(/^0+/, '') || null; // Shahr: after the bank code, without leading zeros
  return null;
}

export interface AccountNoInfo {
  digits: string;
  ok: boolean;
  problem: string | null;
}
/** a bank account number: digits (and dashes, dropped), no check digit the app can verify — each bank has its own format */
export function accountNoInfo(raw: string): AccountNoInfo {
  const digits = cleanDigits(raw);
  const problem = !/^\d+$/.test(digits) ? 'شماره حساب فقط رقم (و خط تیره) دارد.' : digits.length < 5 || digits.length > 20 ? 'شماره حساب معمولاً ۵ تا ۲۰ رقم است.' : null;
  return { digits, ok: !problem, problem };
}

export type BankIdKind = 'card' | 'sheba' | 'account';
/** what a pasted number most likely is: IR… or 24 digits = شبا, 16 digits = card, otherwise an account number */
export function guessKind(raw: string): BankIdKind {
  const c = cleanDigits(raw);
  if (/^IR/.test(c) || /^\d{24}$/.test(c)) return 'sheba';
  if (/^\d{16}$/.test(c)) return 'card';
  return 'account';
}
