// Every page of the app, in one list: the phone's «بیشتر» sheet, the wide-screen sidebar and the
// header title all read from here, so a page added once shows up everywhere.
export interface NavItem {
  href: string;
  label: string;
  /** an emoji for text-only places; the tiles, sidebar and bottom bar draw the Lucide icon of the page (components/icons.tsx) */
  icon: string;
  hint?: string;
}
export interface NavGroup {
  title: string;
  tone: 'teal' | 'rose' | 'copper' | 'plum' | 'saffron' | 'lapis' | 'slate';
  items: NavItem[];
}

// Related pages sit together (CLAUDE.md rule 79): day-to-day money → what is owed and shared → my business → planning →
// the market → trading → learning and settings.
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'پول من',
    tone: 'teal',
    items: [
      { href: '/', label: 'خانه', icon: '🏠', hint: 'داشبورد مالی' },
      { href: '/transactions', label: 'تراکنش‌ها', icon: '🧾' },
      { href: '/accounts', label: 'حساب‌ها و کارت‌ها', icon: '💳', hint: 'موجودی از پیامک بانک، دارایی‌ها' },
      { href: '/import', label: 'ورود از بانک و پیامک', icon: '📥', hint: 'گردش حساب و پیامک' },
      { href: '/budget', label: 'بودجه', icon: '🎯' },
    ],
  },
  {
    title: 'بدهی، طلب و گروه',
    tone: 'rose',
    items: [
      { href: '/debts', label: 'وام، چک و قبض', icon: '🏦' },
      { href: '/fund', label: 'صندوق خانگی', icon: '🏺', hint: 'سهم ماهانه، وام به نوبت و قرعه‌کشی' },
      { href: '/split', label: 'دنگ و خرج گروهی', icon: '🧮', hint: 'چه کسی به چه کسی بدهکار است' },
    ],
  },
  {
    // the shop the user runs (lib/biz, from Kasbai — rule 80): its money sits in the book's accounts
    title: 'کسب‌وکار من',
    tone: 'copper',
    items: [
      { href: '/biz', label: 'داشبورد کسب‌وکار', icon: '🏪', hint: 'فروش، سود و کارهای امروز' },
      { href: '/biz/pos', label: 'صندوق فروش', icon: '⚡' },
      { href: '/biz/orders', label: 'سفارش‌ها و فاکتور', icon: '🛒' },
      { href: '/biz/booking', label: 'نوبت‌دهی', icon: '📅' },
      { href: '/biz/products', label: 'محصولات و منو', icon: '🍔', hint: 'فرمول ساخت، بهای تمام‌شده، تخفیف' },
      { href: '/biz/stock', label: 'انبار', icon: '📦' },
      { href: '/biz/customers', label: 'مشتری‌ها و نسیه', icon: '🤝' },
      { href: '/biz/money', label: 'هزینه و سود', icon: '💰' },
      { href: '/biz/reports', label: 'تحلیل فروش', icon: '📊' },
      { href: '/biz/tax', label: 'دستیار مالیات', icon: '🧮' },
      { href: '/biz/online', label: 'فروشگاه آنلاین و ربات', icon: '🌐' },
      { href: '/biz/settings', label: 'تنظیمات کسب‌وکار', icon: '⚙' },
    ],
  },
  {
    title: 'پس‌انداز و برنامه',
    tone: 'plum',
    items: [
      { href: '/goals', label: 'اهداف', icon: '🏁' },
      { href: '/tools', label: 'ماشین‌حساب', icon: '📐' },
      { href: '/advisor', label: 'مشاور', icon: '💬' },
    ],
  },
  {
    title: 'بازار',
    tone: 'saffron',
    items: [
      { href: '/market', label: 'نمای بازار', icon: '🏷' },
      { href: '/charts', label: 'نمودار و پیش‌بینی', icon: '📉' },
      { href: '/scenarios', label: 'سناریوها', icon: '🔭' },
      { href: '/risk', label: 'ریسک', icon: '⚖' },
      { href: '/stocks', label: 'بورس', icon: '📈' },
      { href: '/crypto', label: 'کریپتو', icon: '₿' },
      { href: '/portfolio', label: 'سبد پیشنهادی', icon: '🧺' },
    ],
  },
  {
    title: 'معامله',
    tone: 'lapis',
    items: [
      { href: '/live', label: 'معامله برخط', icon: '⚡' },
      { href: '/swing', label: 'نوسان‌گیری', icon: '🌊' },
      { href: '/simulator', label: 'معامله‌گر شبیه‌ساز', icon: '🧪' },
    ],
  },
  {
    title: 'یادگیری و تنظیمات',
    tone: 'slate',
    items: [
      { href: '/learn', label: 'آموزش', icon: '🎓', hint: 'اقتصاد، معامله و نظم مالی' },
      { href: '/game', label: 'بازی اقتصاد', icon: '🎮' },
      { href: '/alerts', label: 'هشدار و اعلان', icon: '🔔' },
      { href: '/bot', label: 'ربات و منابع', icon: '🤖' },
    ],
  },
];

export const ALL_PAGES: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** The four pages a thumb reaches without opening anything; the fifth slot opens «بیشتر». */
export const BOTTOM_TABS = ['/', '/transactions', '/accounts', '/market'] as const;

export const pageOf = (path: string) => ALL_PAGES.find((p) => p.href === path) ?? null;
