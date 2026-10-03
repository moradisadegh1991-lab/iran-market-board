// Every page of the app, in one list: the phone's «بیشتر» sheet, the wide-screen sidebar and the
// header title all read from here, so a page added once shows up everywhere.
export interface NavItem {
  href: string;
  label: string;
  /** shown on the tile; the colored square behind it is the group's tone */
  icon: string;
  hint?: string;
}
export interface NavGroup {
  title: string;
  tone: 'teal' | 'saffron' | 'lapis' | 'plum';
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'مالی من',
    tone: 'teal',
    items: [
      { href: '/', label: 'خانه', icon: '🏠', hint: 'داشبورد مالی' },
      { href: '/transactions', label: 'تراکنش‌ها', icon: '🧾' },
      { href: '/import', label: 'ورود از بانک', icon: '📥', hint: 'گردش حساب و پیامک' },
      { href: '/budget', label: 'بودجه', icon: '🎯' },
      { href: '/debts', label: 'وام، چک و قبض', icon: '🏦' },
      { href: '/goals', label: 'اهداف', icon: '🏁' },
      { href: '/accounts', label: 'حساب و دارایی', icon: '💼' },
      { href: '/tools', label: 'ماشین‌حساب', icon: '🧮' },
      { href: '/advisor', label: 'مشاور', icon: '💬' },
      { href: '/learn', label: 'آموزش', icon: '🎓', hint: 'اقتصاد، معامله و نظم مالی' },
    ],
  },
  {
    title: 'بازار',
    tone: 'saffron',
    items: [
      { href: '/market', label: 'نمای بازار', icon: '🏷' },
      { href: '/charts', label: 'نمودار', icon: '📉' },
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
    title: 'ابزار',
    tone: 'plum',
    items: [
      { href: '/alerts', label: 'هشدار و اعلان', icon: '🔔' },
      { href: '/game', label: 'بازی اقتصاد', icon: '🎮' },
      { href: '/bot', label: 'ربات و منابع', icon: '🤖' },
    ],
  },
];

export const ALL_PAGES: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** The four pages a thumb reaches without opening anything; the fifth slot opens «بیشتر». */
export const BOTTOM_TABS = ['/', '/transactions', '/market', '/advisor'] as const;

export const pageOf = (path: string) => ALL_PAGES.find((p) => p.href === path) ?? null;
