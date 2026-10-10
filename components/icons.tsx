// One icon set for the whole app: Lucide (ISC license, bundled — works offline in the APK). Emoji drew differently on every
// phone; these are drawn the same everywhere, take the text color, and stay sharp at any size (CLAUDE.md rule 89).
// A category the user made keeps the emoji they picked; the built-in ones get an icon.
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  BellRing,
  Bitcoin,
  BookOpen,
  Bot,
  Boxes,
  Briefcase,
  BriefcaseBusiness,
  Building,
  Building2,
  Calculator,
  CalendarClock,
  Car,
  ChartCandlestick,
  ChartColumn,
  Clapperboard,
  CreditCard,
  Ellipsis,
  Flag,
  FlaskConical,
  Gamepad2,
  Gift,
  Globe,
  GraduationCap,
  HandCoins,
  Handshake,
  House,
  Import,
  Landmark,
  Laptop,
  MessagesSquare,
  Package,
  Percent,
  Pill,
  Receipt,
  ReceiptText,
  Scale,
  Settings,
  SlidersHorizontal,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tags,
  Target,
  Telescope,
  TrendingUp,
  Users,
  UsersRound,
  UtensilsCrossed,
  Wallet,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Category } from '@/lib/finance/model';

/** each page's icon, by its address (components/nav.ts) */
export const PAGE_ICON: Record<string, LucideIcon> = {
  '/': House,
  '/transactions': ReceiptText,
  '/accounts': CreditCard,
  '/import': Import,
  '/budget': Target,
  '/debts': Landmark,
  '/fund': HandCoins,
  '/split': Users,
  '/biz': Store,
  '/biz/pos': Zap,
  '/biz/orders': ShoppingCart,
  '/biz/booking': CalendarClock,
  '/biz/products': Tags,
  '/biz/stock': Boxes,
  '/biz/customers': UsersRound,
  '/biz/money': Wallet,
  '/biz/reports': ChartColumn,
  '/biz/tax': Percent,
  '/biz/online': Globe,
  '/biz/settings': Settings,
  '/goals': Flag,
  '/tools': Calculator,
  '/advisor': MessagesSquare,
  '/market': TrendingUp,
  '/charts': ChartCandlestick,
  '/scenarios': Telescope,
  '/risk': Scale,
  '/stocks': Building2,
  '/crypto': Bitcoin,
  '/portfolio': Briefcase,
  '/live': Activity,
  '/swing': Waves,
  '/simulator': FlaskConical,
  '/learn': GraduationCap,
  '/game': Gamepad2,
  '/alerts': BellRing,
  '/bot': Bot,
  '/settings': SlidersHorizontal,
};

/** the built-in categories (model.ts DEFAULT_CATEGORIES, BIZ_CATEGORIES) */
export const CATEGORY_ICON: Record<string, LucideIcon> = {
  'c-food': UtensilsCrossed,
  'c-home': House,
  'c-bills': Receipt,
  'c-transport': Car,
  'c-health': Pill,
  'c-edu': BookOpen,
  'c-shop': ShoppingBag,
  'c-fun': Clapperboard,
  'c-loan': Landmark,
  'c-gift': Gift,
  'c-other': Ellipsis,
  'i-salary': BriefcaseBusiness,
  'i-freelance': Laptop,
  'i-invest': TrendingUp,
  'i-rent': Building,
  'i-loanback': Handshake,
  'i-other': Banknote,
  'i-biz': Store,
  'c-biz': Store,
  'c-bizbuy': Package,
  'i-bizdraw': ArrowDownToLine,
  'c-bizcap': ArrowUpFromLine,
};

export function PageIcon({ href, size = 22 }: { href: string; size?: number }) {
  const I = PAGE_ICON[href] ?? Ellipsis;
  return <I size={size} strokeWidth={1.9} aria-hidden="true" />;
}

/** a category's mark: the icon of a built-in category, the emoji the user picked for their own */
export function CatIcon({ c, size = 16 }: { c: Pick<Category, 'id' | 'emoji'> | null | undefined; size?: number }) {
  if (!c) return null;
  const I = CATEGORY_ICON[c.id];
  return I ? <I className="cat-ic" size={size} strokeWidth={2} aria-hidden="true" /> : <span className="cat-ic" aria-hidden="true">{c.emoji}</span>;
}

/** an unDraw illustration (unDraw license: free, commercial, no attribution) — sanitized and recolored, in public/art */
export type ArtKey = 'wallet' | 'transactions' | 'inbox' | 'goals' | 'lend' | 'split' | 'fund' | 'alerts' | 'income' | 'start' | 'shop' | LessonArt;
/** one per lesson (lib/learn/lessons.ts) — the same pipeline as the rest */
export type LessonArt = 'l_budget' | 'l_saving' | 'l_habits' | 'l_inflation' | 'l_real' | 'l_compound' | 'l_currency' | 'l_risk' | 'l_costs' | 'l_size' | 'l_chart' | 'l_forecast' | 'l_mind' | 'l_hold' | 'l_scam' | 'l_diversify' | 'l_backtest';
export function Art({ k, className }: { k: ArtKey; className?: string }) {
  // a plain <img>: an SVG shown this way runs nothing; relative to the site root, which is the APK's root too
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`art${className ? ` ${className}` : ''}`} src={`/art/${k}.svg`} alt="" aria-hidden="true" loading="lazy" decoding="async" />;
}
