// کسب‌وکار من — the shop, café or salon the user runs, inside the same personal-finance book.
//
// Ported from Kasbai (moradisadegh1991-lab/final-project): the same modules — quick sale (POS),
// orders from every channel, products with a recipe (BOM) and its cost, stock with moving-average
// cost, the customer club, the credit book (نسیه), expenses and daily profit, discounts, bookings
// with services/hours/seats/shifts, sales analytics and the tax estimate. Kasbai kept these in
// Postgres (or SQLite on the phone); here they are part of `FinanceData` in the browser's
// localStorage, like everything else personal (CLAUDE.md rule 7). Only what the owner publishes
// for customers — the menu, services, opening hours and busy times — goes to the server (rule 80).
//
// Amounts are RIAL (rule 1/17), as in the rest of the book. Kasbai stored toman; its BOM templates
// still are (templates.ts) and are converted where they are used.

import type { Iso } from '@/lib/finance/model';

export type BusinessType =
  | 'fastfood' | 'restaurant' | 'cafe' | 'bakery' | 'juice'
  | 'retail' | 'grocery' | 'clothing' | 'flower'
  | 'barber' | 'salon' | 'gym'
  | 'repair' | 'carwash'
  | 'other';

export interface BusinessTypeInfo {
  code: BusinessType;
  label: string;
  icon: string;
  /** service businesses lead with bookings; product businesses with the menu and orders */
  kind: 'product' | 'service';
}

export const BUSINESS_TYPES: BusinessTypeInfo[] = [
  { code: 'fastfood', label: 'فست‌فود', icon: '🍔', kind: 'product' },
  { code: 'restaurant', label: 'رستوران', icon: '🍽', kind: 'product' },
  { code: 'cafe', label: 'کافه', icon: '☕', kind: 'product' },
  { code: 'bakery', label: 'قنادی و شیرینی', icon: '🧁', kind: 'product' },
  { code: 'juice', label: 'آبمیوه و بستنی', icon: '🧃', kind: 'product' },
  { code: 'retail', label: 'خرده‌فروشی', icon: '🛒', kind: 'product' },
  { code: 'grocery', label: 'سوپرمارکت', icon: '🏪', kind: 'product' },
  { code: 'clothing', label: 'پوشاک', icon: '👕', kind: 'product' },
  { code: 'flower', label: 'گل‌فروشی', icon: '💐', kind: 'product' },
  { code: 'barber', label: 'آرایشگاه مردانه', icon: '💈', kind: 'service' },
  { code: 'salon', label: 'آرایشگاه زنانه', icon: '💅', kind: 'service' },
  { code: 'gym', label: 'باشگاه ورزشی', icon: '🏋️', kind: 'service' },
  { code: 'repair', label: 'تعمیرگاه', icon: '🔧', kind: 'service' },
  { code: 'carwash', label: 'کارواش', icon: '🚗', kind: 'service' },
  { code: 'other', label: 'سایر', icon: '✨', kind: 'product' },
];
export const typeInfo = (code: string): BusinessTypeInfo => BUSINESS_TYPES.find((t) => t.code === code) ?? BUSINESS_TYPES[BUSINESS_TYPES.length - 1];

/** where an order came from */
export type Channel = 'walkin' | 'phone' | 'instagram' | 'sms' | 'web' | 'telegram' | 'booking';
export const CHANNEL_LABEL: Record<Channel, string> = {
  walkin: '🚶 حضوری',
  phone: '📞 تلفنی',
  instagram: '📷 اینستاگرام',
  sms: '📱 پیامک',
  web: '🌐 صفحه آنلاین',
  telegram: '🤖 تلگرام',
  booking: '📅 نوبت',
};

export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'delivered' | 'canceled';
export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'در انتظار تأیید',
  confirmed: 'تأیید شده',
  preparing: 'در حال آماده‌سازی',
  delivered: 'تحویل شده',
  canceled: 'لغو',
};
/** a sale: counted in revenue, stock and the book */
export const SOLD: OrderStatus[] = ['confirmed', 'preparing', 'delivered'];

/** how the customer paid — decides which account in the book the money lands in */
export type PayMethod = 'cash' | 'card' | 'credit';
export const PAY_LABEL: Record<PayMethod, string> = { cash: 'نقد', card: 'کارت', credit: 'نسیه' };

export interface BomLine {
  ingredientId: string;
  /** per one product, in the ingredient's unit */
  qty: number;
}

export interface Product {
  id: string;
  name: string;
  category?: string | null;
  priceRial: number;
  /** minutes of work for one; with the hourly rate it gives the labour part of the cost */
  prepMin: number;
  description?: string | null;
  imageUrl?: string | null;
  /** archived products stay for old invoices but leave the till and the public menu */
  active: boolean;
  bom: BomLine[];
  createdAt: number;
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  /** moving-average purchase price of one unit */
  unitCostRial: number;
  stock: number;
  /** warn at or below this */
  reorder: number;
  createdAt: number;
}

export type InvTxType = 'purchase' | 'consumption' | 'adjustment' | 'waste' | 'return';
export interface InvTx {
  id: string;
  ingredientId: string;
  type: InvTxType;
  /** signed: + into stock, − out of it */
  qty: number;
  unitCostRial?: number | null;
  orderId?: string | null;
  note?: string | null;
  at: number;
  date: Iso;
  /** purchase paid from an account: the expense it made in the book */
  txnId?: string | null;
}

export interface OrderLine {
  /** a product or (bookings) a service */
  itemId: string;
  kind: 'product' | 'service';
  /** as it was when sold, so a renamed or deleted product leaves old invoices intact */
  name: string;
  qty: number;
  unitRial: number;
  /** cost of one at confirmation (materials + labour); 0 until then */
  costRial: number;
}

export interface Order {
  id: string;
  /** invoice number, 1, 2, 3 … per business */
  no: number;
  at: number;
  date: Iso;
  time: string;
  channel: Channel;
  status: OrderStatus;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  lines: OrderLine[];
  discountTitle?: string | null;
  discountPct: number;
  subtotalRial: number;
  discountRial: number;
  vatPct: number;
  vatRial: number;
  /** what the customer pays: subtotal − discount + VAT */
  totalRial: number;
  /** materials + labour of what was sold, set at confirmation */
  costRial: number;
  /** set at confirmation */
  pay: PayMethod | null;
  /** the day the sale counts on (confirmation day), and its time */
  saleDate?: Iso | null;
  saleTime?: string | null;
  /** credit sales: the person in the credit book */
  creditId?: string | null;
  /** what confirmation took out of stock, so a cancel puts back exactly that */
  consumed?: BomLine[] | null;
  /** came from the online inbox (its id), or from a booking */
  ref?: string | null;
  bookingId?: string | null;
  /** online orders: the status last told to the customer (lib/biz/server.ts) */
  refSent?: string | null;
}

/** the customer club: built from orders that carry a phone number */
export interface Customer {
  id: string;
  phone: string;
  name?: string | null;
  firstAt: number;
  lastAt: number;
  orders: number;
  spentRial: number;
  points: number;
}

export interface CreditEntry {
  id: string;
  kind: 'sale' | 'payment';
  /** always positive; the direction is the kind */
  amountRial: number;
  note?: string | null;
  at: number;
  date: Iso;
  orderId?: string | null;
  /** payment received into an account: the income it made in the book */
  txnId?: string | null;
}
export interface CreditCustomer {
  id: string;
  name: string;
  phone?: string | null;
  note?: string | null;
  createdAt: number;
  entries: CreditEntry[];
}

export type ExpenseCat = 'rent' | 'salary' | 'utilities' | 'supplies' | 'marketing' | 'other';
export const EXPENSE_CAT_LABEL: Record<ExpenseCat, string> = {
  rent: 'اجاره',
  salary: 'حقوق',
  utilities: 'آب و برق و گاز',
  supplies: 'ملزومات',
  marketing: 'تبلیغات',
  other: 'سایر',
};
export interface BizExpense {
  id: string;
  category: ExpenseCat;
  amountRial: number;
  date: Iso;
  note?: string | null;
  accountId?: string | null;
  txnId?: string | null;
}

export interface Discount {
  id: string;
  title: string;
  pct: number;
  from: Iso;
  to: Iso;
  active: boolean;
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  priceRial: number;
  category?: string | null;
  active: boolean;
}

export type BookingStatus = 'pending' | 'confirmed' | 'done' | 'canceled';
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = { pending: 'در انتظار', confirmed: 'قطعی', done: 'انجام شد', canceled: 'لغو' };
export interface Booking {
  id: string;
  serviceIds: string[];
  /** names at booking time */
  serviceNames: string[];
  customerName?: string | null;
  customerPhone: string;
  startsAt: number;
  durationMin: number;
  priceRial: number;
  seatId?: string | null;
  party: number;
  status: BookingStatus;
  source: 'manual' | 'web' | 'telegram';
  note?: string | null;
  createdAt: number;
  /** «انجام شد» turns it into a sale (an order on the booking channel) */
  orderId?: string | null;
  canceledBy?: 'business' | 'customer' | null;
  /** first time it was set, when moved */
  originalStartsAt?: number | null;
  ref?: string | null;
  refSent?: string | null;
}

/** weekday as JavaScript counts it: 0 = Sunday … 6 = Saturday */
export interface Hours {
  weekday: number;
  open: boolean;
  from: string;
  to: string;
}
export interface Seat {
  id: string;
  name: string;
  capacity: number;
  note?: string | null;
  active: boolean;
}
/** working shifts: for one seat/chair/table, or the whole business (seatId null); they override `hours` */
export interface Shift {
  id: string;
  seatId: string | null;
  weekday: number;
  from: string;
  to: string;
  active: boolean;
}

export type Segment = 'all' | 'vip' | 'returning' | 'inactive' | 'new';
export interface Campaign {
  id: string;
  at: number;
  segment: Segment;
  title?: string | null;
  text: string;
  count: number;
}

/** orders older than ARCHIVE_DAYS folded into one row per day, so the book stays small (localStorage) */
export interface DaySum {
  revenueRial: number;
  costRial: number;
  discountRial: number;
  vatRial: number;
  orders: number;
}

/** what the owner published for customers (the menu page, bookings, the Telegram bot) */
export interface Online {
  slug: string;
  /** proves this phone owns the slug on the server; never shown */
  token: string;
  publishedAt?: number | null;
  pulledAt?: number | null;
  error?: string | null;
  /** inbox items already applied, so a pull that repeats one never books it twice */
  seen: string[];
  /** what was last published (catalog without its time), so a change republishes by itself */
  hash?: string | null;
}

export interface Business {
  id: string;
  name: string;
  type: BusinessType;
  phone?: string | null;
  address?: string | null;
  province?: string | null;
  city?: string | null;
  createdAt: number;
  /** workshop hourly rate: labour cost of a product = rate × prepMin / 60 */
  hourlyRial: number;
  /** value-added tax added to every sale, percent; 0 = off */
  vatPct: number;
  /** yearly basic exemption the owner types in (ماده ۱۰۱) */
  taxExemptionRial: number;
  /** accounts in the book the shop's money is in: the till and the shop's card/bank account */
  cashAccountId: string | null;
  cardAccountId: string | null;
  nextNo: number;
  products: Product[];
  ingredients: Ingredient[];
  invTx: InvTx[];
  orders: Order[];
  customers: Customer[];
  credit: CreditCustomer[];
  expenses: BizExpense[];
  discounts: Discount[];
  services: Service[];
  bookings: Booking[];
  hours: Hours[];
  seats: Seat[];
  shifts: Shift[];
  campaigns: Campaign[];
  archive: Record<Iso, DaySum>;
  online: Online | null;
  /** day sales the user removed from the book by hand: `${date}|${accountId}`; not booked again */
  skipBook: string[];
}

export const LOYALTY_RIAL_PER_POINT = 100_000; // one point per 10,000 toman, as in Kasbai
export const ARCHIVE_DAYS = 400;

export function defaultHours(): Hours[] {
  // Iran: Friday (5) closed, the rest 09:00–21:00 — the owner edits it
  return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: weekday !== 5, from: '09:00', to: '21:00' }));
}

export function newBusiness(p: { id: string; name: string; type: BusinessType; phone?: string | null; now: number }): Business {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    phone: p.phone ?? null,
    address: null,
    province: null,
    city: null,
    createdAt: p.now,
    hourlyRial: 0,
    vatPct: 0,
    taxExemptionRial: 0,
    cashAccountId: null,
    cardAccountId: null,
    nextNo: 1,
    products: [],
    ingredients: [],
    invTx: [],
    orders: [],
    customers: [],
    credit: [],
    expenses: [],
    discounts: [],
    services: [],
    bookings: [],
    hours: defaultHours(),
    seats: [],
    shifts: [],
    campaigns: [],
    archive: {},
    online: null,
    skipBook: [],
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/** Accepts what came out of localStorage or a backup; returns null for anything that is not a business. */
export function normalizeBusiness(raw: unknown): Business | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  const base = newBusiness({ id: raw.id, name: raw.name, type: (BUSINESS_TYPES.some((t) => t.code === raw.type) ? raw.type : 'other') as BusinessType, now: num(raw.createdAt, Date.now()) });
  const hours = arr<Hours>(raw.hours).filter((h) => h && typeof h.weekday === 'number');
  return {
    ...base,
    ...(raw as Partial<Business>),
    type: base.type,
    hourlyRial: num(raw.hourlyRial, 0),
    vatPct: num(raw.vatPct, 0),
    taxExemptionRial: num(raw.taxExemptionRial, 0),
    nextNo: num(raw.nextNo, 1),
    products: arr<Product>(raw.products).filter((p) => p && typeof p.id === 'string').map((p) => ({ ...p, bom: arr<BomLine>(p.bom), active: p.active !== false })),
    ingredients: arr<Ingredient>(raw.ingredients).filter((i) => i && typeof i.id === 'string'),
    invTx: arr<InvTx>(raw.invTx),
    orders: arr<Order>(raw.orders).filter((o) => o && typeof o.id === 'string' && Array.isArray(o.lines)),
    customers: arr<Customer>(raw.customers),
    credit: arr<CreditCustomer>(raw.credit).filter((c) => c && typeof c.id === 'string').map((c) => ({ ...c, entries: arr<CreditEntry>(c.entries) })),
    expenses: arr<BizExpense>(raw.expenses),
    discounts: arr<Discount>(raw.discounts),
    services: arr<Service>(raw.services),
    bookings: arr<Booking>(raw.bookings).map((b) => ({ ...b, serviceIds: arr<string>(b.serviceIds), serviceNames: arr<string>(b.serviceNames) })),
    hours: hours.length === 7 ? hours : defaultHours(),
    seats: arr<Seat>(raw.seats),
    shifts: arr<Shift>(raw.shifts),
    campaigns: arr<Campaign>(raw.campaigns),
    archive: isObj(raw.archive) ? (raw.archive as Record<Iso, DaySum>) : {},
    online: isObj(raw.online) && typeof raw.online.slug === 'string' && typeof raw.online.token === 'string' ? { ...(raw.online as unknown as Online), seen: arr<string>(raw.online.seen) } : null,
    skipBook: arr<string>(raw.skipBook),
  };
}
