// From Kasbai (moradisadegh1991-lab/final-project, lib/bomTemplates.ts), unchanged except this import.
// suggestedPrice is in TOMAN, as Kasbai stored it; lib/biz converts with tomanToRial when a template is used.
// Ready-made BOM templates: one tap creates the product, any missing
// ingredients, and the full recipe. Quantities are typical starting
// points — the owner tunes them afterwards.
//
// Each template is tagged with the business type(s) it applies to, so
// the products page only shows templates relevant to the shop's own
// category (a barbershop never sees "ساندویچ ویژه").
//
// نکته‌ی مهم درباره‌ی آرایشگاه/تعمیرگاه: این سیستم هزینه را فقط از
// «مواد مصرفی» (BOM) حساب می‌کند، نه زمان کار. برای آرایشگاه، بیشتر
// هزینه‌ی واقعی «دستمزد/زمان» است، نه مواد — پس رقم «بهای تمام‌شده»
// برای این خدمات را واقع‌بینانه کمتر از هزینه‌ی واقعی در نظر بگیر.
// برای تعمیرگاه چون هزینه‌ی اصلی «قطعه» است، این مدل خیلی دقیق‌تر کار می‌کند.

import type { BusinessType } from "./model";

export interface TemplateIngredient {
  name: string;
  unit: string;
  quantity: number;      // per one product
  reorder_point: number; // سطح هشدار موجودی
}

export interface BomTemplate {
  key: string;
  productName: string;
  suggestedPrice: number; // Toman
  icon: string;
  /** دسته‌بندی — برای گروه‌بندی در منو و صفحه‌ی محصولات */
  category: string;
  /** زمان تقریبی آماده‌سازی (دقیقه) — برای محاسبه‌ی هزینه‌ی دستمزد */
  prepMin?: number;
  businessTypes: BusinessType[];
  ingredients: TemplateIngredient[];
}

export const BOM_TEMPLATES: BomTemplate[] = [
  // ══════════════════════ فست‌فود (۲۰) ══════════════════════
  {
    key: "sandwich", productName: "ساندویچ ویژه", suggestedPrice: 185_000, icon: "🥪",
    category: "ساندویچ", businessTypes: ["fastfood"],
    ingredients: [
      { name: "نان باگت", unit: "عدد", quantity: 1, reorder_point: 20 },
      { name: "سوسیس", unit: "kg", quantity: 0.12, reorder_point: 3 },
      { name: "کالباس", unit: "kg", quantity: 0.05, reorder_point: 2 },
      { name: "پنیر ورقه‌ای", unit: "عدد", quantity: 2, reorder_point: 30 },
      { name: "سس مخصوص", unit: "kg", quantity: 0.04, reorder_point: 2 },
      { name: "خیارشور", unit: "kg", quantity: 0.03, reorder_point: 2 },
      { name: "گوجه", unit: "kg", quantity: 0.05, reorder_point: 3 },
    ],
  },
  {
    key: "burger", productName: "همبرگر دستی", suggestedPrice: 220_000, icon: "🍔",
    category: "برگر", businessTypes: ["fastfood"],
    ingredients: [
      { name: "نان همبرگر", unit: "عدد", quantity: 1, reorder_point: 20 },
      { name: "گوشت چرخ‌کرده", unit: "kg", quantity: 0.15, reorder_point: 5 },
      { name: "پنیر ورقه‌ای", unit: "عدد", quantity: 1, reorder_point: 30 },
      { name: "کاهو", unit: "kg", quantity: 0.03, reorder_point: 2 },
      { name: "گوجه", unit: "kg", quantity: 0.04, reorder_point: 3 },
      { name: "سس مخصوص", unit: "kg", quantity: 0.03, reorder_point: 2 },
    ],
  },
  {
    key: "cheeseburger_double", productName: "چیزبرگر دوقلو", suggestedPrice: 290_000, icon: "🍔",
    category: "برگر", businessTypes: ["fastfood"],
    ingredients: [
      { name: "نان همبرگر", unit: "عدد", quantity: 1, reorder_point: 20 },
      { name: "گوشت چرخ‌کرده", unit: "kg", quantity: 0.3, reorder_point: 5 },
      { name: "پنیر ورقه‌ای", unit: "عدد", quantity: 2, reorder_point: 30 },
      { name: "کاهو", unit: "kg", quantity: 0.03, reorder_point: 2 },
      { name: "سس مخصوص", unit: "kg", quantity: 0.04, reorder_point: 2 },
    ],
  },
  {
    key: "pizza", productName: "پیتزا مخصوص (متوسط)", suggestedPrice: 320_000, icon: "🍕",
    category: "پیتزا", businessTypes: ["fastfood"],
    ingredients: [
      { name: "خمیر پیتزا", unit: "عدد", quantity: 1, reorder_point: 15 },
      { name: "پنیر پیتزا", unit: "kg", quantity: 0.2, reorder_point: 5 },
      { name: "ژامبون", unit: "kg", quantity: 0.1, reorder_point: 3 },
      { name: "قارچ", unit: "kg", quantity: 0.08, reorder_point: 2 },
      { name: "فلفل دلمه", unit: "kg", quantity: 0.05, reorder_point: 2 },
      { name: "سس گوجه", unit: "kg", quantity: 0.06, reorder_point: 2 },
    ],
  },
  {
    key: "pepperoni_pizza", productName: "پیتزا پپرونی", suggestedPrice: 340_000, icon: "🍕",
    category: "پیتزا", businessTypes: ["fastfood"],
    ingredients: [
      { name: "خمیر پیتزا", unit: "عدد", quantity: 1, reorder_point: 15 },
      { name: "پنیر پیتزا", unit: "kg", quantity: 0.22, reorder_point: 5 },
      { name: "پپرونی", unit: "kg", quantity: 0.12, reorder_point: 3 },
      { name: "سس گوجه", unit: "kg", quantity: 0.06, reorder_point: 2 },
    ],
  },
  {
    key: "calzone", productName: "کالزونه", suggestedPrice: 280_000, icon: "🥟",
    category: "پیتزا", businessTypes: ["fastfood"],
    ingredients: [
      { name: "خمیر پیتزا", unit: "عدد", quantity: 1, reorder_point: 15 },
      { name: "پنیر پیتزا", unit: "kg", quantity: 0.18, reorder_point: 5 },
      { name: "ژامبون", unit: "kg", quantity: 0.08, reorder_point: 3 },
      { name: "قارچ", unit: "kg", quantity: 0.05, reorder_point: 2 },
    ],
  },
  {
    key: "chicken_sandwich", productName: "ساندویچ مرغ سوخاری", suggestedPrice: 210_000, icon: "🍗",
    category: "ساندویچ", businessTypes: ["fastfood"],
    ingredients: [
      { name: "نان باگت", unit: "عدد", quantity: 1, reorder_point: 20 },
      { name: "فیله مرغ سوخاری", unit: "kg", quantity: 0.15, reorder_point: 4 },
      { name: "کاهو", unit: "kg", quantity: 0.02, reorder_point: 2 },
      { name: "سس مخصوص", unit: "kg", quantity: 0.03, reorder_point: 2 },
      { name: "خیارشور", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "falafel", productName: "ساندویچ فلافل", suggestedPrice: 110_000, icon: "🧆",
    category: "ساندویچ", businessTypes: ["fastfood"],
    ingredients: [
      { name: "نان لواش", unit: "عدد", quantity: 1, reorder_point: 30 },
      { name: "فلافل", unit: "عدد", quantity: 4, reorder_point: 50 },
      { name: "خیارشور", unit: "kg", quantity: 0.02, reorder_point: 2 },
      { name: "سس تره", unit: "kg", quantity: 0.03, reorder_point: 2 },
    ],
  },
  {
    key: "hotdog", productName: "هات‌داگ", suggestedPrice: 150_000, icon: "🌭",
    category: "ساندویچ", businessTypes: ["fastfood"],
    ingredients: [
      { name: "نان هات‌داگ", unit: "عدد", quantity: 1, reorder_point: 20 },
      { name: "سوسیس کوکتل", unit: "kg", quantity: 0.1, reorder_point: 3 },
      { name: "پنیر ورقه‌ای", unit: "عدد", quantity: 1, reorder_point: 30 },
      { name: "سس مخصوص", unit: "kg", quantity: 0.03, reorder_point: 2 },
    ],
  },
  {
    key: "nuggets", productName: "ناگت مرغ (۶ تکه)", suggestedPrice: 165_000, icon: "🍗",
    category: "سوخاری و پیش‌غذا", businessTypes: ["fastfood"],
    ingredients: [
      { name: "ناگت مرغ", unit: "عدد", quantity: 6, reorder_point: 60 },
      { name: "سس کچاپ", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "chicken_wrap", productName: "رپ مرغ", suggestedPrice: 195_000, icon: "🌯",
    category: "ساندویچ", businessTypes: ["fastfood"],
    ingredients: [
      { name: "نان لواش", unit: "عدد", quantity: 1, reorder_point: 30 },
      { name: "فیله مرغ گریل", unit: "kg", quantity: 0.12, reorder_point: 4 },
      { name: "کاهو", unit: "kg", quantity: 0.02, reorder_point: 2 },
      { name: "سس مخصوص", unit: "kg", quantity: 0.03, reorder_point: 2 },
    ],
  },
  {
    key: "club_sandwich", productName: "کلاب ساندویچ", suggestedPrice: 240_000, icon: "🥪",
    category: "ساندویچ", businessTypes: ["fastfood"],
    ingredients: [
      { name: "نان تست", unit: "عدد", quantity: 3, reorder_point: 30 },
      { name: "فیله مرغ گریل", unit: "kg", quantity: 0.1, reorder_point: 4 },
      { name: "ژامبون", unit: "kg", quantity: 0.05, reorder_point: 3 },
      { name: "پنیر ورقه‌ای", unit: "عدد", quantity: 2, reorder_point: 30 },
      { name: "گوجه", unit: "kg", quantity: 0.04, reorder_point: 3 },
    ],
  },
  {
    key: "loaded_fries", productName: "سیب‌زمینی با پنیر و بیکن", suggestedPrice: 165_000, icon: "🍟",
    category: "سوخاری و پیش‌غذا", businessTypes: ["fastfood"],
    ingredients: [
      { name: "سیب‌زمینی", unit: "kg", quantity: 0.3, reorder_point: 10 },
      { name: "پنیر پیتزا", unit: "kg", quantity: 0.08, reorder_point: 5 },
      { name: "بیکن گوشتی", unit: "kg", quantity: 0.05, reorder_point: 3 },
      { name: "سس مخصوص", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "fries", productName: "سیب‌زمینی سرخ‌کرده", suggestedPrice: 95_000, icon: "🍟",
    category: "سوخاری و پیش‌غذا", businessTypes: ["fastfood"],
    ingredients: [
      { name: "سیب‌زمینی", unit: "kg", quantity: 0.3, reorder_point: 10 },
      { name: "روغن سرخ‌کردنی", unit: "l", quantity: 0.05, reorder_point: 5 },
      { name: "نمک و ادویه", unit: "kg", quantity: 0.005, reorder_point: 1 },
    ],
  },
  {
    key: "pirashki", productName: "پیراشکی گوشت", suggestedPrice: 85_000, icon: "🥟",
    category: "سوخاری و پیش‌غذا", businessTypes: ["fastfood"],
    ingredients: [
      { name: "خمیر پیراشکی", unit: "عدد", quantity: 1, reorder_point: 30 },
      { name: "گوشت چرخ‌کرده", unit: "kg", quantity: 0.06, reorder_point: 5 },
      { name: "روغن سرخ‌کردنی", unit: "l", quantity: 0.03, reorder_point: 5 },
    ],
  },
  {
    key: "olivie_salad", productName: "سالاد الویه (پرس)", suggestedPrice: 90_000, icon: "🥗",
    category: "سالاد", businessTypes: ["fastfood", "restaurant"],
    ingredients: [
      { name: "مرغ پخته", unit: "kg", quantity: 0.08, reorder_point: 3 },
      { name: "سیب‌زمینی", unit: "kg", quantity: 0.1, reorder_point: 10 },
      { name: "تخم‌مرغ", unit: "عدد", quantity: 1, reorder_point: 30 },
      { name: "مایونز", unit: "kg", quantity: 0.05, reorder_point: 3 },
    ],
  },
  {
    key: "soda", productName: "نوشابه قوطی", suggestedPrice: 35_000, icon: "🥤",
    category: "نوشیدنی", businessTypes: ["fastfood", "restaurant"],
    ingredients: [{ name: "نوشابه قوطی", unit: "عدد", quantity: 1, reorder_point: 48 }],
  },
  {
    key: "doogh", productName: "دوغ (بطری)", suggestedPrice: 30_000, icon: "🥛",
    category: "نوشیدنی", businessTypes: ["fastfood", "restaurant"],
    ingredients: [{ name: "دوغ بطری", unit: "عدد", quantity: 1, reorder_point: 40 }],
  },
  {
    key: "chicken_shawarma", productName: "ساندویچ شاورما مرغ", suggestedPrice: 175_000, icon: "🌯",
    category: "ساندویچ", businessTypes: ["fastfood"],
    ingredients: [
      { name: "نان لواش", unit: "عدد", quantity: 1, reorder_point: 30 },
      { name: "مرغ شاورما", unit: "kg", quantity: 0.13, reorder_point: 4 },
      { name: "سس سیر", unit: "kg", quantity: 0.03, reorder_point: 2 },
      { name: "خیارشور", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "onion_rings", productName: "پیاز حلقه‌ای", suggestedPrice: 100_000, icon: "🧅",
    category: "سوخاری و پیش‌غذا", businessTypes: ["fastfood"],
    ingredients: [
      { name: "پیاز", unit: "kg", quantity: 0.15, reorder_point: 5 },
      { name: "سوخاری", unit: "kg", quantity: 0.05, reorder_point: 3 },
      { name: "روغن سرخ‌کردنی", unit: "l", quantity: 0.04, reorder_point: 5 },
    ],
  },

  // ══════════════════════ رستوران (۲۰) ══════════════════════
  {
    key: "jooje_kabab", productName: "جوجه‌کباب با برنج", suggestedPrice: 380_000, icon: "🍢",
    category: "کباب", businessTypes: ["restaurant"],
    ingredients: [
      { name: "ران مرغ", unit: "kg", quantity: 0.3, reorder_point: 8 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
      { name: "زعفران", unit: "g", quantity: 0.5, reorder_point: 20 },
      { name: "کره", unit: "kg", quantity: 0.02, reorder_point: 3 },
      { name: "گوجه کبابی", unit: "عدد", quantity: 2, reorder_point: 30 },
    ],
  },
  {
    key: "koobideh", productName: "چلوکباب کوبیده", suggestedPrice: 350_000, icon: "🍢",
    category: "کباب", businessTypes: ["restaurant"],
    ingredients: [
      { name: "گوشت چرخ‌کرده مخصوص کباب", unit: "kg", quantity: 0.25, reorder_point: 8 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
      { name: "پیاز رنده‌شده", unit: "kg", quantity: 0.03, reorder_point: 3 },
      { name: "زعفران", unit: "g", quantity: 0.5, reorder_point: 20 },
      { name: "کره", unit: "kg", quantity: 0.02, reorder_point: 3 },
    ],
  },
  {
    key: "bakhtiari", productName: "چلوکباب بختیاری", suggestedPrice: 420_000, icon: "🍢",
    category: "کباب", businessTypes: ["restaurant"],
    ingredients: [
      { name: "فیله مرغ", unit: "kg", quantity: 0.15, reorder_point: 6 },
      { name: "فیله گوسفندی", unit: "kg", quantity: 0.15, reorder_point: 6 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
      { name: "زعفران", unit: "g", quantity: 0.5, reorder_point: 20 },
    ],
  },
  {
    key: "kabab_barg", productName: "چلوکباب برگ", suggestedPrice: 460_000, icon: "🍢",
    category: "کباب", businessTypes: ["restaurant"],
    ingredients: [
      { name: "فیله راسته گوسفندی", unit: "kg", quantity: 0.2, reorder_point: 6 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
      { name: "زعفران", unit: "g", quantity: 0.5, reorder_point: 20 },
      { name: "کره", unit: "kg", quantity: 0.02, reorder_point: 3 },
    ],
  },
  {
    key: "ghormeh_sabzi", productName: "قورمه‌سبزی", suggestedPrice: 290_000, icon: "🍲",
    category: "خورش", businessTypes: ["restaurant"],
    ingredients: [
      { name: "گوشت خورشتی", unit: "kg", quantity: 0.15, reorder_point: 6 },
      { name: "سبزی قورمه", unit: "kg", quantity: 0.1, reorder_point: 5 },
      { name: "لوبیا قرمز", unit: "kg", quantity: 0.04, reorder_point: 3 },
      { name: "لیمو عمانی", unit: "عدد", quantity: 2, reorder_point: 20 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
    ],
  },
  {
    key: "gheimeh", productName: "قیمه", suggestedPrice: 270_000, icon: "🍲",
    category: "خورش", businessTypes: ["restaurant"],
    ingredients: [
      { name: "گوشت خورشتی", unit: "kg", quantity: 0.12, reorder_point: 6 },
      { name: "لپه", unit: "kg", quantity: 0.05, reorder_point: 4 },
      { name: "سیب‌زمینی", unit: "kg", quantity: 0.1, reorder_point: 10 },
      { name: "رب گوجه", unit: "kg", quantity: 0.03, reorder_point: 3 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
    ],
  },
  {
    key: "zereshk_polo", productName: "زرشک‌پلو با مرغ", suggestedPrice: 300_000, icon: "🍚",
    category: "پلو و چلو", businessTypes: ["restaurant"],
    ingredients: [
      { name: "ران مرغ", unit: "kg", quantity: 0.25, reorder_point: 8 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
      { name: "زرشک", unit: "kg", quantity: 0.02, reorder_point: 3 },
      { name: "زعفران", unit: "g", quantity: 0.5, reorder_point: 20 },
    ],
  },
  {
    key: "baghali_polo", productName: "باقالی‌پلو با ماهیچه", suggestedPrice: 480_000, icon: "🍚",
    category: "پلو و چلو", businessTypes: ["restaurant"],
    ingredients: [
      { name: "ماهیچه گوسفندی", unit: "kg", quantity: 0.35, reorder_point: 5 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
      { name: "باقالی", unit: "kg", quantity: 0.06, reorder_point: 4 },
      { name: "شوید", unit: "kg", quantity: 0.01, reorder_point: 2 },
    ],
  },
  {
    key: "abgoosht", productName: "آبگوشت", suggestedPrice: 240_000, icon: "🍲",
    category: "غذای سنتی", businessTypes: ["restaurant"],
    ingredients: [
      { name: "گوشت خورشتی", unit: "kg", quantity: 0.15, reorder_point: 6 },
      { name: "نخود", unit: "kg", quantity: 0.04, reorder_point: 4 },
      { name: "لوبیا سفید", unit: "kg", quantity: 0.03, reorder_point: 3 },
      { name: "سیب‌زمینی", unit: "kg", quantity: 0.1, reorder_point: 10 },
      { name: "گوجه", unit: "kg", quantity: 0.05, reorder_point: 3 },
    ],
  },
  {
    key: "adas_polo", productName: "عدس‌پلو با گوشت", suggestedPrice: 260_000, icon: "🍚",
    category: "پلو و چلو", businessTypes: ["restaurant"],
    ingredients: [
      { name: "گوشت چرخ‌کرده", unit: "kg", quantity: 0.1, reorder_point: 5 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
      { name: "عدس", unit: "kg", quantity: 0.05, reorder_point: 4 },
      { name: "خرما و کشمش", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "kashk_bademjan", productName: "کشک بادمجان (پیش‌غذا)", suggestedPrice: 120_000, icon: "🍆",
    category: "پیش‌غذا", businessTypes: ["restaurant"],
    ingredients: [
      { name: "بادمجان", unit: "kg", quantity: 0.2, reorder_point: 8 },
      { name: "کشک", unit: "kg", quantity: 0.05, reorder_point: 3 },
      { name: "پیاز داغ", unit: "kg", quantity: 0.02, reorder_point: 2 },
      { name: "نعنا داغ", unit: "kg", quantity: 0.005, reorder_point: 1 },
    ],
  },
  {
    key: "mirza_ghasemi", productName: "میرزا قاسمی", suggestedPrice: 130_000, icon: "🍆",
    category: "پیش‌غذا", businessTypes: ["restaurant"],
    ingredients: [
      { name: "بادمجان", unit: "kg", quantity: 0.25, reorder_point: 8 },
      { name: "تخم‌مرغ", unit: "عدد", quantity: 2, reorder_point: 30 },
      { name: "رب گوجه", unit: "kg", quantity: 0.03, reorder_point: 3 },
      { name: "سیر", unit: "kg", quantity: 0.01, reorder_point: 2 },
    ],
  },
  {
    key: "shirazi_salad", productName: "سالاد شیرازی", suggestedPrice: 65_000, icon: "🥗",
    category: "سالاد", businessTypes: ["restaurant", "fastfood"],
    ingredients: [
      { name: "خیار", unit: "kg", quantity: 0.1, reorder_point: 5 },
      { name: "گوجه", unit: "kg", quantity: 0.1, reorder_point: 5 },
      { name: "پیاز", unit: "kg", quantity: 0.03, reorder_point: 3 },
      { name: "آبلیمو", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "mast_khiar", productName: "ماست و خیار", suggestedPrice: 55_000, icon: "🥣",
    category: "پیش‌غذا", businessTypes: ["restaurant"],
    ingredients: [
      { name: "ماست", unit: "kg", quantity: 0.15, reorder_point: 5 },
      { name: "خیار", unit: "kg", quantity: 0.05, reorder_point: 5 },
      { name: "نعنا خشک", unit: "kg", quantity: 0.005, reorder_point: 1 },
    ],
  },
  {
    key: "fesenjan", productName: "خورشت فسنجان", suggestedPrice: 310_000, icon: "🍲",
    category: "خورش", businessTypes: ["restaurant"],
    ingredients: [
      { name: "مرغ", unit: "kg", quantity: 0.25, reorder_point: 6 },
      { name: "گردو", unit: "kg", quantity: 0.1, reorder_point: 4 },
      { name: "رب انار", unit: "kg", quantity: 0.05, reorder_point: 3 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
    ],
  },
  {
    key: "barley_soup", productName: "سوپ جو", suggestedPrice: 85_000, icon: "🥣",
    category: "سوپ و آش", businessTypes: ["restaurant"],
    ingredients: [
      { name: "جو پرک", unit: "kg", quantity: 0.05, reorder_point: 4 },
      { name: "مرغ", unit: "kg", quantity: 0.05, reorder_point: 6 },
      { name: "شیر", unit: "l", quantity: 0.1, reorder_point: 5 },
      { name: "کره", unit: "kg", quantity: 0.01, reorder_point: 3 },
    ],
  },
  {
    key: "ash_reshteh", productName: "آش رشته", suggestedPrice: 90_000, icon: "🍜",
    category: "سوپ و آش", businessTypes: ["restaurant"],
    ingredients: [
      { name: "رشته آش", unit: "kg", quantity: 0.05, reorder_point: 4 },
      { name: "سبزی آش", unit: "kg", quantity: 0.1, reorder_point: 5 },
      { name: "لوبیا و نخود", unit: "kg", quantity: 0.04, reorder_point: 3 },
      { name: "کشک", unit: "kg", quantity: 0.03, reorder_point: 3 },
      { name: "پیاز داغ", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "tahchin", productName: "ته‌چین مرغ (پرس)", suggestedPrice: 260_000, icon: "🍚",
    category: "پلو و چلو", businessTypes: ["restaurant"],
    ingredients: [
      { name: "مرغ", unit: "kg", quantity: 0.15, reorder_point: 6 },
      { name: "برنج", unit: "kg", quantity: 0.2, reorder_point: 15 },
      { name: "ماست", unit: "kg", quantity: 0.08, reorder_point: 5 },
      { name: "زعفران", unit: "g", quantity: 0.5, reorder_point: 20 },
      { name: "تخم‌مرغ", unit: "عدد", quantity: 1, reorder_point: 30 },
    ],
  },
  {
    key: "restaurant_drink", productName: "نوشیدنی (لیوانی)", suggestedPrice: 40_000, icon: "🥤",
    category: "نوشیدنی", businessTypes: ["restaurant"],
    ingredients: [{ name: "نوشابه قوطی", unit: "عدد", quantity: 1, reorder_point: 48 }],
  },

  // ══════════════════════ خرده‌فروشی (۲۰) ══════════════════════
  // مدل هزینه برای خرده‌فروشی متفاوت است: هر محصول یک «ماده» دارد که
  // همان قیمت خرید عمده‌ی خودِ کالاست — این‌طوری حاشیه‌ی سود خودکار
  // (فروش − خرید) محاسبه می‌شود، دقیقاً مثل بقیه‌ی ماژول‌ها.
  {
    key: "phone_case", productName: "قاب گوشی", suggestedPrice: 150_000, icon: "📱",
    category: "لوازم جانبی موبایل", businessTypes: ["retail"],
    ingredients: [{ name: "قاب گوشی (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 20 }],
  },
  {
    key: "screen_protector", productName: "گلس محافظ صفحه", suggestedPrice: 80_000, icon: "📱",
    category: "لوازم جانبی موبایل", businessTypes: ["retail"],
    ingredients: [{ name: "گلس محافظ (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 30 }],
  },
  {
    key: "bt_earphone", productName: "هندزفری بلوتوث", suggestedPrice: 450_000, icon: "🎧",
    category: "لوازم جانبی موبایل", businessTypes: ["retail"],
    ingredients: [{ name: "هندزفری بلوتوث (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 10 }],
  },
  {
    key: "fast_charger", productName: "شارژر فست‌شارژ", suggestedPrice: 280_000, icon: "🔌",
    category: "لوازم جانبی موبایل", businessTypes: ["retail"],
    ingredients: [{ name: "شارژر (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 15 }],
  },
  {
    key: "power_bank", productName: "پاوربانک", suggestedPrice: 650_000, icon: "🔋",
    category: "لوازم جانبی موبایل", businessTypes: ["retail"],
    ingredients: [{ name: "پاوربانک (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 8 }],
  },
  {
    key: "mens_tshirt", productName: "تی‌شرت مردانه", suggestedPrice: 420_000, icon: "👕",
    category: "پوشاک", businessTypes: ["retail"],
    ingredients: [{ name: "تی‌شرت (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 15 }],
  },
  {
    key: "jeans", productName: "شلوار جین", suggestedPrice: 950_000, icon: "👖",
    category: "پوشاک", businessTypes: ["retail"],
    ingredients: [{ name: "شلوار جین (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 10 }],
  },
  {
    key: "handbag", productName: "کیف دستی زنانه", suggestedPrice: 780_000, icon: "👜",
    category: "کیف و کفش", businessTypes: ["retail"],
    ingredients: [{ name: "کیف دستی (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 8 }],
  },
  {
    key: "sport_shoes", productName: "کفش اسپرت", suggestedPrice: 1_450_000, icon: "👟",
    category: "کیف و کفش", businessTypes: ["retail"],
    ingredients: [{ name: "کفش اسپرت (خرید عمده)", unit: "جفت", quantity: 1, reorder_point: 10 }],
  },
  {
    key: "sunglasses", productName: "عینک آفتابی", suggestedPrice: 380_000, icon: "🕶️",
    category: "اکسسوری", businessTypes: ["retail"],
    ingredients: [{ name: "عینک آفتابی (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 12 }],
  },
  {
    key: "wristwatch", productName: "ساعت مچی", suggestedPrice: 890_000, icon: "⌚",
    category: "اکسسوری", businessTypes: ["retail"],
    ingredients: [{ name: "ساعت مچی (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 8 }],
  },
  {
    key: "moisturizer", productName: "کرم مرطوب‌کننده", suggestedPrice: 320_000, icon: "🧴",
    category: "آرایشی و بهداشتی", businessTypes: ["retail"],
    ingredients: [{ name: "کرم مرطوب‌کننده (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 15 }],
  },
  {
    key: "lipstick", productName: "رژ لب", suggestedPrice: 260_000, icon: "💄",
    category: "آرایشی و بهداشتی", businessTypes: ["retail"],
    ingredients: [{ name: "رژ لب (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 20 }],
  },
  {
    key: "shampoo_retail", productName: "شامپو", suggestedPrice: 180_000, icon: "🧴",
    category: "آرایشی و بهداشتی", businessTypes: ["retail"],
    ingredients: [{ name: "شامپو (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 20 }],
  },
  {
    key: "notebook", productName: "دفتر یادداشت", suggestedPrice: 65_000, icon: "📓",
    category: "لوازم‌التحریر", businessTypes: ["retail"],
    ingredients: [{ name: "دفتر (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 40 }],
  },
  {
    key: "pen_pack", productName: "خودکار (بسته)", suggestedPrice: 45_000, icon: "🖊️",
    category: "لوازم‌التحریر", businessTypes: ["retail"],
    ingredients: [{ name: "بسته خودکار (خرید عمده)", unit: "بسته", quantity: 1, reorder_point: 30 }],
  },
  {
    key: "backpack", productName: "کوله پشتی", suggestedPrice: 620_000, icon: "🎒",
    category: "کیف و کفش", businessTypes: ["retail"],
    ingredients: [{ name: "کوله پشتی (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 10 }],
  },
  {
    key: "kids_toy", productName: "اسباب‌بازی کودک", suggestedPrice: 340_000, icon: "🧸",
    category: "اسباب‌بازی", businessTypes: ["retail"],
    ingredients: [{ name: "اسباب‌بازی (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 15 }],
  },
  {
    key: "cookware_set", productName: "سرویس قابلمه کوچک", suggestedPrice: 1_650_000, icon: "🍳",
    category: "لوازم خانه", businessTypes: ["retail"],
    ingredients: [{ name: "سرویس قابلمه (خرید عمده)", unit: "سرویس", quantity: 1, reorder_point: 5 }],
  },
  {
    key: "hand_vacuum", productName: "جاروبرقی دستی", suggestedPrice: 980_000, icon: "🧹",
    category: "لوازم خانه", businessTypes: ["retail"],
    ingredients: [{ name: "جاروبرقی دستی (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 6 }],
  },


  // ══════════════════════ کافه (۲۴) ══════════════════════
  // کافه از رستوران جدا شد: کاسب کافه در فهرست رستوران دنبال
  // «اسپرسو» می‌گشت و «چلوکباب» می‌دید. اقلام زیر بر پایه‌ی منوی
  // معمول کافه‌های ایران است — مقادیر نقطه‌ی شروع‌اند، نه قطعی.
  // ── نوشیدنی گرم ──
  {
    key: "espresso", productName: "اسپرسو", suggestedPrice: 75_000, icon: "☕",
    prepMin: 3, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "دانه قهوه", unit: "kg", quantity: 0.018, reorder_point: 3 },
      { name: "لیوان کاغذی", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "americano", productName: "آمریکانو", suggestedPrice: 85_000, icon: "☕",
    prepMin: 3, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "دانه قهوه", unit: "kg", quantity: 0.018, reorder_point: 3 },
      { name: "لیوان کاغذی", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "cafe_latte", productName: "کافه لاته", suggestedPrice: 110_000, icon: "🥛",
    prepMin: 4, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "دانه قهوه", unit: "kg", quantity: 0.018, reorder_point: 3 },
      { name: "شیر", unit: "l", quantity: 0.2, reorder_point: 15 },
      { name: "لیوان کاغذی", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "cappuccino", productName: "کاپوچینو", suggestedPrice: 105_000, icon: "☕",
    prepMin: 4, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "دانه قهوه", unit: "kg", quantity: 0.018, reorder_point: 3 },
      { name: "شیر", unit: "l", quantity: 0.15, reorder_point: 15 },
      { name: "پودر کاکائو", unit: "kg", quantity: 0.003, reorder_point: 1 },
      { name: "لیوان کاغذی", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "mocha", productName: "موکا", suggestedPrice: 125_000, icon: "🍫",
    prepMin: 5, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "دانه قهوه", unit: "kg", quantity: 0.018, reorder_point: 3 },
      { name: "شیر", unit: "l", quantity: 0.18, reorder_point: 15 },
      { name: "سس شکلات", unit: "kg", quantity: 0.03, reorder_point: 2 },
      { name: "لیوان کاغذی", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "flat_white", productName: "فلت وایت", suggestedPrice: 115_000, icon: "🥛",
    prepMin: 4, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "دانه قهوه", unit: "kg", quantity: 0.02, reorder_point: 3 },
      { name: "شیر", unit: "l", quantity: 0.15, reorder_point: 15 },
      { name: "لیوان کاغذی", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "turkish_coffee", productName: "قهوه ترک", suggestedPrice: 90_000, icon: "☕",
    prepMin: 6, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "پودر قهوه ترک", unit: "kg", quantity: 0.015, reorder_point: 2 },
    ],
  },
  {
    key: "hot_chocolate", productName: "هات چاکلت", suggestedPrice: 120_000, icon: "🍫",
    prepMin: 5, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "پودر هات چاکلت", unit: "kg", quantity: 0.04, reorder_point: 2 },
      { name: "شیر", unit: "l", quantity: 0.22, reorder_point: 15 },
      { name: "خامه قنادی", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "chai_latte", productName: "چای لاته", suggestedPrice: 105_000, icon: "🫖",
    prepMin: 5, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "چای ماسالا", unit: "kg", quantity: 0.01, reorder_point: 1 },
      { name: "شیر", unit: "l", quantity: 0.2, reorder_point: 15 },
    ],
  },
  {
    key: "herbal_tea", productName: "دمنوش گیاهی", suggestedPrice: 70_000, icon: "🌿",
    prepMin: 5, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "دمنوش گیاهی", unit: "kg", quantity: 0.008, reorder_point: 1 },
    ],
  },
  {
    key: "black_tea", productName: "چای سیاه", suggestedPrice: 50_000, icon: "🍵",
    prepMin: 4, category: "نوشیدنی گرم", businessTypes: ["cafe"],
    ingredients: [
      { name: "چای سیاه", unit: "kg", quantity: 0.006, reorder_point: 2 },
      { name: "قند و نبات", unit: "kg", quantity: 0.02, reorder_point: 3 },
    ],
  },
  // ── نوشیدنی سرد ──
  {
    key: "iced_latte", productName: "آیس لاته", suggestedPrice: 125_000, icon: "🧋",
    prepMin: 4, category: "نوشیدنی سرد", businessTypes: ["cafe"],
    ingredients: [
      { name: "دانه قهوه", unit: "kg", quantity: 0.018, reorder_point: 3 },
      { name: "شیر", unit: "l", quantity: 0.2, reorder_point: 15 },
      { name: "یخ", unit: "kg", quantity: 0.15, reorder_point: 10 },
      { name: "لیوان یکبارمصرف سرد", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "iced_americano", productName: "آیس آمریکانو", suggestedPrice: 100_000, icon: "🧊",
    prepMin: 3, category: "نوشیدنی سرد", businessTypes: ["cafe"],
    ingredients: [
      { name: "دانه قهوه", unit: "kg", quantity: 0.018, reorder_point: 3 },
      { name: "یخ", unit: "kg", quantity: 0.15, reorder_point: 10 },
      { name: "لیوان یکبارمصرف سرد", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "frappe", productName: "فراپه", suggestedPrice: 145_000, icon: "🥤",
    prepMin: 6, category: "نوشیدنی سرد", businessTypes: ["cafe"],
    ingredients: [
      { name: "دانه قهوه", unit: "kg", quantity: 0.018, reorder_point: 3 },
      { name: "شیر", unit: "l", quantity: 0.15, reorder_point: 15 },
      { name: "بستنی وانیلی", unit: "kg", quantity: 0.08, reorder_point: 4 },
      { name: "یخ", unit: "kg", quantity: 0.1, reorder_point: 10 },
      { name: "لیوان یکبارمصرف سرد", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "affogato", productName: "آفوگاتو", suggestedPrice: 140_000, icon: "🍨",
    prepMin: 4, category: "نوشیدنی سرد", businessTypes: ["cafe"],
    ingredients: [
      { name: "دانه قهوه", unit: "kg", quantity: 0.018, reorder_point: 3 },
      { name: "بستنی وانیلی", unit: "kg", quantity: 0.12, reorder_point: 4 },
    ],
  },
  {
    key: "milkshake", productName: "میلک‌شیک", suggestedPrice: 150_000, icon: "🥤",
    prepMin: 6, category: "نوشیدنی سرد", businessTypes: ["cafe"],
    ingredients: [
      { name: "بستنی وانیلی", unit: "kg", quantity: 0.15, reorder_point: 4 },
      { name: "شیر", unit: "l", quantity: 0.2, reorder_point: 15 },
      { name: "سس شکلات", unit: "kg", quantity: 0.03, reorder_point: 2 },
      { name: "لیوان یکبارمصرف سرد", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "smoothie", productName: "اسموتی میوه", suggestedPrice: 155_000, icon: "🍓",
    prepMin: 7, category: "نوشیدنی سرد", businessTypes: ["cafe"],
    ingredients: [
      { name: "میوه منجمد", unit: "kg", quantity: 0.2, reorder_point: 5 },
      { name: "ماست چکیده", unit: "kg", quantity: 0.08, reorder_point: 3 },
      { name: "عسل", unit: "kg", quantity: 0.02, reorder_point: 2 },
      { name: "لیوان یکبارمصرف سرد", unit: "عدد", quantity: 1, reorder_point: 200 },
    ],
  },
  {
    key: "lemonade", productName: "لیموناد", suggestedPrice: 95_000, icon: "🍋",
    prepMin: 5, category: "نوشیدنی سرد", businessTypes: ["cafe"],
    ingredients: [
      { name: "لیمو تازه", unit: "kg", quantity: 0.12, reorder_point: 4 },
      { name: "شربت ساده", unit: "l", quantity: 0.05, reorder_point: 3 },
      { name: "نعناع تازه", unit: "kg", quantity: 0.01, reorder_point: 1 },
      { name: "یخ", unit: "kg", quantity: 0.15, reorder_point: 10 },
    ],
  },
  {
    key: "mojito_virgin", productName: "موهیتو (بدون الکل)", suggestedPrice: 130_000, icon: "🌱",
    prepMin: 6, category: "نوشیدنی سرد", businessTypes: ["cafe"],
    ingredients: [
      { name: "لیمو تازه", unit: "kg", quantity: 0.1, reorder_point: 4 },
      { name: "نعناع تازه", unit: "kg", quantity: 0.015, reorder_point: 1 },
      { name: "نوشابه گازدار", unit: "l", quantity: 0.2, reorder_point: 12 },
      { name: "یخ", unit: "kg", quantity: 0.15, reorder_point: 10 },
    ],
  },
  {
    key: "iced_tea", productName: "آیس‌تی", suggestedPrice: 90_000, icon: "🧊",
    prepMin: 4, category: "نوشیدنی سرد", businessTypes: ["cafe"],
    ingredients: [
      { name: "چای سیاه", unit: "kg", quantity: 0.006, reorder_point: 2 },
      { name: "شربت میوه", unit: "l", quantity: 0.05, reorder_point: 3 },
      { name: "یخ", unit: "kg", quantity: 0.15, reorder_point: 10 },
    ],
  },
  // ── کیک و دسر ──
  {
    key: "cheesecake", productName: "چیزکیک", suggestedPrice: 180_000, icon: "🍰",
    prepMin: 2, category: "کیک و دسر", businessTypes: ["cafe", "bakery"],
    ingredients: [
      { name: "پنیر خامه‌ای", unit: "kg", quantity: 0.09, reorder_point: 3 },
      { name: "بیسکویت پایه", unit: "kg", quantity: 0.03, reorder_point: 2 },
      { name: "خامه قنادی", unit: "kg", quantity: 0.04, reorder_point: 2 },
      { name: "سس میوه", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "brownie", productName: "براونی", suggestedPrice: 150_000, icon: "🍫",
    prepMin: 2, category: "کیک و دسر", businessTypes: ["cafe", "bakery"],
    ingredients: [
      { name: "شکلات تلخ", unit: "kg", quantity: 0.06, reorder_point: 3 },
      { name: "کره", unit: "kg", quantity: 0.04, reorder_point: 3 },
      { name: "آرد", unit: "kg", quantity: 0.04, reorder_point: 5 },
      { name: "تخم مرغ", unit: "عدد", quantity: 1, reorder_point: 60 },
    ],
  },
  {
    key: "carrot_cake", productName: "کیک هویج و گردو", suggestedPrice: 160_000, icon: "🥕",
    prepMin: 2, category: "کیک و دسر", businessTypes: ["cafe", "bakery"],
    ingredients: [
      { name: "آرد", unit: "kg", quantity: 0.05, reorder_point: 5 },
      { name: "هویج رنده‌شده", unit: "kg", quantity: 0.06, reorder_point: 3 },
      { name: "گردو", unit: "kg", quantity: 0.02, reorder_point: 2 },
      { name: "پنیر خامه‌ای", unit: "kg", quantity: 0.04, reorder_point: 3 },
    ],
  },
  {
    key: "tiramisu", productName: "تیرامیسو", suggestedPrice: 195_000, icon: "🍮",
    prepMin: 2, category: "کیک و دسر", businessTypes: ["cafe"],
    ingredients: [
      { name: "پنیر ماسکارپونه", unit: "kg", quantity: 0.08, reorder_point: 2 },
      { name: "بیسکویت لیدی‌فینگر", unit: "kg", quantity: 0.04, reorder_point: 2 },
      { name: "دانه قهوه", unit: "kg", quantity: 0.01, reorder_point: 3 },
      { name: "پودر کاکائو", unit: "kg", quantity: 0.005, reorder_point: 1 },
    ],
  },

  // ══════════════════════ آرایشگاه مردانه (۲۰) ══════════════════════
  // هزینه‌ی واقعی این خدمات عمدتاً «زمان/دستمزد آرایشگر» است، نه مواد؛
  // مقدارهای مواد مصرفی زیر تقریبی‌اند تا فقط هزینه‌ی مواد را نشان دهند.
  {
    key: "mens_haircut", productName: "اصلاح مو مردانه", suggestedPrice: 150_000, icon: "💈",
    prepMin: 25,
    category: "مو", businessTypes: ["barber"],
    ingredients: [
      { name: "ژل مو", unit: "kg", quantity: 0.01, reorder_point: 2 },
      { name: "شامپو سالن", unit: "kg", quantity: 0.02, reorder_point: 3 },
    ],
  },
  {
    key: "beard_trim", productName: "اصلاح ریش", suggestedPrice: 90_000, icon: "🧔",
    prepMin: 15,
    category: "ریش و صورت", businessTypes: ["barber"],
    ingredients: [{ name: "فوم اصلاح", unit: "kg", quantity: 0.01, reorder_point: 2 }],
  },
  {
    key: "hair_beard_combo", productName: "اصلاح مو + ریش (پکیج)", suggestedPrice: 220_000, icon: "💈",
    prepMin: 35,
    category: "ریش و صورت", businessTypes: ["barber"],
    ingredients: [
      { name: "ژل مو", unit: "kg", quantity: 0.01, reorder_point: 2 },
      { name: "فوم اصلاح", unit: "kg", quantity: 0.01, reorder_point: 2 },
    ],
  },
  {
    key: "mens_hair_color", productName: "رنگ مو مردانه", suggestedPrice: 280_000, icon: "🎨",
    prepMin: 40,
    category: "رنگ", businessTypes: ["barber"],
    ingredients: [{ name: "رنگ مو", unit: "عدد", quantity: 1, reorder_point: 15 }],
  },
  {
    key: "kids_haircut", productName: "کوتاهی مو کودک", suggestedPrice: 120_000, icon: "🧒",
    prepMin: 20,
    category: "مو", businessTypes: ["barber"],
    ingredients: [{ name: "ژل مو", unit: "kg", quantity: 0.005, reorder_point: 2 }],
  },
  {
    key: "traditional_razor_shave", productName: "اصلاح با تیغ سنتی", suggestedPrice: 110_000, icon: "🪒",
    prepMin: 20,
    category: "ریش و صورت", businessTypes: ["barber"],
    ingredients: [
      { name: "فوم اصلاح", unit: "kg", quantity: 0.015, reorder_point: 2 },
      { name: "تیغ یک‌بارمصرف", unit: "عدد", quantity: 1, reorder_point: 50 },
    ],
  },
  {
    key: "head_face_massage", productName: "ماساژ سر و صورت", suggestedPrice: 130_000, icon: "💆",
    prepMin: 20,
    category: "پوست", businessTypes: ["barber"],
    ingredients: [{ name: "روغن ماساژ", unit: "kg", quantity: 0.02, reorder_point: 2 }],
  },
  {
    key: "hair_keratin", productName: "کراتین مو", suggestedPrice: 850_000, icon: "✨",
    prepMin: 90,
    category: "کراتین و احیا", businessTypes: ["barber"],
    ingredients: [{ name: "محلول کراتین", unit: "kg", quantity: 0.1, reorder_point: 3 }],
  },
  {
    key: "mens_eyebrow", productName: "اصلاح ابرو مردانه", suggestedPrice: 60_000, icon: "✂️",
    prepMin: 10,
    category: "پوست", businessTypes: ["barber"],
    ingredients: [],
  },
  {
    key: "beard_line_up", productName: "فرم دادن خط ریش", suggestedPrice: 70_000, icon: "🪒",
    prepMin: 10,
    category: "ریش و صورت", businessTypes: ["barber"],
    ingredients: [{ name: "فوم اصلاح", unit: "kg", quantity: 0.008, reorder_point: 2 }],
  },
  {
    key: "wash_style", productName: "شستشو و حالت‌دهی مو", suggestedPrice: 100_000, icon: "💇",
    prepMin: 20,
    category: "مو", businessTypes: ["barber"],
    ingredients: [
      { name: "شامپو سالن", unit: "kg", quantity: 0.02, reorder_point: 3 },
      { name: "ژل مو", unit: "kg", quantity: 0.01, reorder_point: 2 },
    ],
  },
  {
    key: "beard_color", productName: "رنگ ریش", suggestedPrice: 150_000, icon: "🎨",
    prepMin: 20,
    category: "رنگ", businessTypes: ["barber"],
    ingredients: [{ name: "رنگ ریش", unit: "عدد", quantity: 1, reorder_point: 15 }],
  },
  {
    key: "fade_cut", productName: "اصلاح فید کات", suggestedPrice: 180_000, icon: "💈",
    prepMin: 30,
    category: "مو", businessTypes: ["barber"],
    ingredients: [{ name: "ژل مو", unit: "kg", quantity: 0.01, reorder_point: 2 }],
  },
  {
    key: "haircut_keratin_combo", productName: "اصلاح مو + کراتین", suggestedPrice: 950_000, icon: "✨",
    prepMin: 100,
    category: "کراتین و احیا", businessTypes: ["barber"],
    ingredients: [
      { name: "محلول کراتین", unit: "kg", quantity: 0.1, reorder_point: 3 },
      { name: "ژل مو", unit: "kg", quantity: 0.01, reorder_point: 2 },
    ],
  },
  {
    key: "hair_styling_wax", productName: "استایل‌دهی نهایی (واکس)", suggestedPrice: 50_000, icon: "💇",
    prepMin: 10,
    category: "مو", businessTypes: ["barber"],
    ingredients: [{ name: "واکس مو", unit: "kg", quantity: 0.008, reorder_point: 2 }],
  },
  {
    key: "neck_shave", productName: "اصلاح گردن و پس‌گردن", suggestedPrice: 50_000, icon: "🪒",
    prepMin: 10,
    category: "ریش و صورت", businessTypes: ["barber"],
    ingredients: [{ name: "فوم اصلاح", unit: "kg", quantity: 0.008, reorder_point: 2 }],
  },
  {
    key: "face_waxing", productName: "اپیلاسیون صورت (وکس)", suggestedPrice: 140_000, icon: "🪄",
    prepMin: 15,
    category: "پوست", businessTypes: ["barber"],
    ingredients: [{ name: "وکس اپیلاسیون", unit: "kg", quantity: 0.03, reorder_point: 2 }],
  },
  {
    key: "machine_haircut", productName: "اصلاح مو با ماشین (صفر)", suggestedPrice: 100_000, icon: "💈",
    prepMin: 15,
    category: "مو", businessTypes: ["barber"],
    ingredients: [],
  },
  {
    key: "hot_wax_shave", productName: "اصلاح با موم داغ", suggestedPrice: 160_000, icon: "🕯️",
    prepMin: 20,
    category: "ریش و صورت", businessTypes: ["barber"],
    ingredients: [{ name: "موم داغ", unit: "kg", quantity: 0.04, reorder_point: 2 }],
  },
  {
    key: "groom_package", productName: "پکیج داماد (اصلاح کامل ویژه)", suggestedPrice: 650_000, icon: "🤵",
    prepMin: 90,
    category: "پکیج", businessTypes: ["barber"],
    ingredients: [
      { name: "ژل مو", unit: "kg", quantity: 0.015, reorder_point: 2 },
      { name: "فوم اصلاح", unit: "kg", quantity: 0.02, reorder_point: 2 },
      { name: "محلول کراتین", unit: "kg", quantity: 0.05, reorder_point: 3 },
    ],
  },

  // ══════════════════════ تعمیرگاه (۲۰) ══════════════════════
  {
    key: "phone_glass_replace", productName: "تعویض گلس گوشی", suggestedPrice: 250_000, icon: "📱",
    category: "موبایل", businessTypes: ["repair"],
    ingredients: [{ name: "گلس گوشی", unit: "عدد", quantity: 1, reorder_point: 15 }],
  },
  {
    key: "phone_battery_replace", productName: "تعویض باتری گوشی", suggestedPrice: 450_000, icon: "🔋",
    category: "موبایل", businessTypes: ["repair"],
    ingredients: [{ name: "باتری گوشی", unit: "عدد", quantity: 1, reorder_point: 10 }],
  },
  {
    key: "phone_lcd_replace", productName: "تعویض ال‌سی‌دی گوشی", suggestedPrice: 1_200_000, icon: "📱",
    category: "موبایل", businessTypes: ["repair"],
    ingredients: [{ name: "ال‌سی‌دی گوشی", unit: "عدد", quantity: 1, reorder_point: 6 }],
  },
  {
    key: "charge_port_repair", productName: "تعمیر پورت شارژ گوشی", suggestedPrice: 350_000, icon: "🔌",
    category: "موبایل", businessTypes: ["repair"],
    ingredients: [{ name: "فلت شارژ", unit: "عدد", quantity: 1, reorder_point: 10 }],
  },
  {
    key: "laptop_battery_replace", productName: "تعویض باتری لپ‌تاپ", suggestedPrice: 950_000, icon: "💻",
    category: "کامپیوتر و لپ‌تاپ", businessTypes: ["repair"],
    ingredients: [{ name: "باتری لپ‌تاپ", unit: "عدد", quantity: 1, reorder_point: 5 }],
  },
  {
    key: "phone_motherboard_repair", productName: "تعمیر مادربرد گوشی", suggestedPrice: 700_000, icon: "🔧",
    category: "موبایل", businessTypes: ["repair"],
    ingredients: [{ name: "قطعات SMD متفرقه", unit: "عدد", quantity: 1, reorder_point: 20 }],
  },
  {
    key: "windows_install", productName: "نصب ویندوز و نرم‌افزار", suggestedPrice: 300_000, icon: "🖥️",
    category: "کامپیوتر و لپ‌تاپ", businessTypes: ["repair"],
    ingredients: [],
  },
  {
    key: "laptop_fan_replace", productName: "تعویض فن لپ‌تاپ", suggestedPrice: 400_000, icon: "🌀",
    category: "کامپیوتر و لپ‌تاپ", businessTypes: ["repair"],
    ingredients: [{ name: "فن لپ‌تاپ", unit: "عدد", quantity: 1, reorder_point: 6 }],
  },
  {
    key: "fridge_gas_leak", productName: "تعمیر نشتی گاز یخچال", suggestedPrice: 850_000, icon: "🧊",
    category: "لوازم خانگی", businessTypes: ["repair"],
    ingredients: [{ name: "گاز مبرد یخچال", unit: "kg", quantity: 0.15, reorder_point: 5 }],
  },
  {
    key: "fridge_compressor_replace", productName: "تعویض کمپرسور یخچال", suggestedPrice: 2_200_000, icon: "🧊",
    category: "لوازم خانگی", businessTypes: ["repair"],
    ingredients: [{ name: "کمپرسور یخچال", unit: "عدد", quantity: 1, reorder_point: 3 }],
  },
  {
    key: "washer_motor_repair", productName: "تعمیر موتور لباسشویی", suggestedPrice: 950_000, icon: "🌀",
    category: "لوازم خانگی", businessTypes: ["repair"],
    ingredients: [{ name: "موتور لباسشویی", unit: "عدد", quantity: 1, reorder_point: 3 }],
  },
  {
    key: "washer_belt_replace", productName: "تعویض تسمه لباسشویی", suggestedPrice: 320_000, icon: "🌀",
    category: "لوازم خانگی", businessTypes: ["repair"],
    ingredients: [{ name: "تسمه لباسشویی", unit: "عدد", quantity: 1, reorder_point: 8 }],
  },
  {
    key: "ac_gas_charge", productName: "شارژ گاز کولر گازی", suggestedPrice: 650_000, icon: "❄️",
    category: "لوازم خانگی", businessTypes: ["repair"],
    ingredients: [{ name: "گاز کولر", unit: "kg", quantity: 0.5, reorder_point: 5 }],
  },
  {
    key: "water_heater_element_replace", productName: "تعویض المنت پکیج", suggestedPrice: 550_000, icon: "🔥",
    category: "لوازم خانگی", businessTypes: ["repair"],
    ingredients: [{ name: "المنت پکیج", unit: "عدد", quantity: 1, reorder_point: 5 }],
  },
  {
    key: "monitor_repair", productName: "تعمیر مانیتور", suggestedPrice: 400_000, icon: "🖥️",
    category: "کامپیوتر و لپ‌تاپ", businessTypes: ["repair"],
    ingredients: [{ name: "قطعات مانیتور متفرقه", unit: "عدد", quantity: 1, reorder_point: 10 }],
  },
  {
    key: "smartwatch_battery_replace", productName: "تعویض باتری ساعت هوشمند", suggestedPrice: 280_000, icon: "⌚",
    category: "موبایل", businessTypes: ["repair"],
    ingredients: [{ name: "باتری ساعت هوشمند", unit: "عدد", quantity: 1, reorder_point: 8 }],
  },
  {
    key: "speaker_repair", productName: "تعمیر اسپیکر گوشی", suggestedPrice: 300_000, icon: "🔊",
    category: "موبایل", businessTypes: ["repair"],
    ingredients: [{ name: "اسپیکر گوشی", unit: "عدد", quantity: 1, reorder_point: 10 }],
  },
  {
    key: "home_button_replace", productName: "تعویض دکمه هوم گوشی", suggestedPrice: 220_000, icon: "📱",
    category: "موبایل", businessTypes: ["repair"],
    ingredients: [{ name: "دکمه هوم", unit: "عدد", quantity: 1, reorder_point: 12 }],
  },
  {
    key: "printer_repair", productName: "تعمیر پرینتر", suggestedPrice: 400_000, icon: "🖨️",
    category: "کامپیوتر و لپ‌تاپ", businessTypes: ["repair"],
    ingredients: [{ name: "قطعات پرینتر متفرقه", unit: "عدد", quantity: 1, reorder_point: 10 }],
  },
  {
    key: "phone_back_glass_replace", productName: "تعویض شیشه پشت گوشی", suggestedPrice: 380_000, icon: "📱",
    category: "موبایل", businessTypes: ["repair"],
    ingredients: [{ name: "شیشه پشت گوشی", unit: "عدد", quantity: 1, reorder_point: 10 }],
  },

  // ══════════════════════ سایر / کافه و کیوسک عمومی (۲۰) ══════════════════════
  {
    key: "tea", productName: "چای ساده", suggestedPrice: 25_000, icon: "🍵",
    category: "نوشیدنی گرم", businessTypes: ["other"],
    ingredients: [
      { name: "چای خشک", unit: "kg", quantity: 0.005, reorder_point: 2 },
      { name: "قند و نبات", unit: "kg", quantity: 0.01, reorder_point: 3 },
    ],
  },
  {
    key: "instant_coffee", productName: "قهوه فوری", suggestedPrice: 40_000, icon: "☕",
    category: "نوشیدنی گرم", businessTypes: ["other"],
    ingredients: [{ name: "قهوه فوری", unit: "kg", quantity: 0.01, reorder_point: 2 }],
  },
  {
    key: "espresso", productName: "اسپرسو", suggestedPrice: 55_000, icon: "☕",
    category: "نوشیدنی گرم", businessTypes: ["other"],
    ingredients: [{ name: "دانه قهوه", unit: "kg", quantity: 0.018, reorder_point: 3 }],
  },
  {
    key: "cake_slice", productName: "کیک خانگی (برش)", suggestedPrice: 70_000, icon: "🍰",
    category: "کیک و دسر", businessTypes: ["other"],
    ingredients: [{ name: "کیک (خرید عمده)", unit: "برش", quantity: 1, reorder_point: 10 }],
  },
  {
    key: "fresh_juice", productName: "آب‌میوه تازه", suggestedPrice: 85_000, icon: "🧃",
    category: "نوشیدنی سرد", businessTypes: ["other"],
    ingredients: [{ name: "میوه فصل", unit: "kg", quantity: 0.3, reorder_point: 10 }],
  },
  {
    key: "ice_cream_scoop", productName: "بستنی (یک اسکوپ)", suggestedPrice: 45_000, icon: "🍦",
    category: "کیک و دسر", businessTypes: ["other"],
    ingredients: [{ name: "بستنی (خرید عمده)", unit: "kg", quantity: 0.08, reorder_point: 5 }],
  },
  {
    key: "chips_snack", productName: "چیپس و پفک (بسته)", suggestedPrice: 35_000, icon: "🍿",
    category: "تنقلات", businessTypes: ["other"],
    ingredients: [{ name: "چیپس/پفک (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 40 }],
  },
  {
    key: "chocolate", productName: "شکلات", suggestedPrice: 50_000, icon: "🍫",
    category: "تنقلات", businessTypes: ["other"],
    ingredients: [{ name: "شکلات (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 30 }],
  },
  {
    key: "cocoa_milk", productName: "شیر کاکائو", suggestedPrice: 40_000, icon: "🥛",
    category: "نوشیدنی سرد", businessTypes: ["other"],
    ingredients: [{ name: "شیر کاکائو (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 30 }],
  },
  {
    key: "magazine", productName: "روزنامه/مجله", suggestedPrice: 30_000, icon: "📰",
    category: "متفرقه", businessTypes: ["other"],
    ingredients: [{ name: "روزنامه/مجله (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 20 }],
  },
  {
    key: "phone_credit", productName: "کارت شارژ", suggestedPrice: 100_000, icon: "💳",
    category: "متفرقه", businessTypes: ["other"],
    ingredients: [{ name: "کارت شارژ (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 20 }],
  },
  {
    key: "energy_drink", productName: "نوشیدنی انرژی‌زا", suggestedPrice: 60_000, icon: "🥤",
    category: "نوشیدنی سرد", businessTypes: ["other"],
    ingredients: [{ name: "نوشیدنی انرژی‌زا (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 30 }],
  },
  {
    key: "water_bottle", productName: "بطری آب معدنی", suggestedPrice: 20_000, icon: "💧",
    category: "نوشیدنی سرد", businessTypes: ["other"],
    ingredients: [{ name: "آب معدنی (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 48 }],
  },
  {
    key: "packed_sandwich", productName: "ساندویچ سرد بسته‌بندی", suggestedPrice: 95_000, icon: "🥪",
    category: "خوراکی", businessTypes: ["other"],
    ingredients: [{ name: "ساندویچ سرد (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 15 }],
  },
  {
    key: "packed_cake", productName: "کیک بسته‌بندی", suggestedPrice: 55_000, icon: "🧁",
    category: "کیک و دسر", businessTypes: ["other"],
    ingredients: [{ name: "کیک بسته‌بندی (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 20 }],
  },
  {
    key: "candy", productName: "آبنبات", suggestedPrice: 15_000, icon: "🍬",
    category: "تنقلات", businessTypes: ["other"],
    ingredients: [{ name: "آبنبات (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 50 }],
  },
  {
    key: "tissue_pack", productName: "دستمال کاغذی", suggestedPrice: 25_000, icon: "🧻",
    category: "متفرقه", businessTypes: ["other"],
    ingredients: [{ name: "دستمال کاغذی (خرید عمده)", unit: "بسته", quantity: 1, reorder_point: 30 }],
  },
  {
    key: "aa_batteries", productName: "باتری قلمی (بسته)", suggestedPrice: 60_000, icon: "🔋",
    category: "متفرقه", businessTypes: ["other"],
    ingredients: [{ name: "باتری قلمی (خرید عمده)", unit: "بسته", quantity: 1, reorder_point: 20 }],
  },
  {
    key: "lighter", productName: "فندک", suggestedPrice: 20_000, icon: "🔥",
    category: "متفرقه", businessTypes: ["other"],
    ingredients: [{ name: "فندک (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 30 }],
  },
  {
    key: "gift_card", productName: "کارت هدیه", suggestedPrice: 200_000, icon: "🎁",
    category: "متفرقه", businessTypes: ["other"],
    ingredients: [{ name: "کارت هدیه (خرید عمده)", unit: "عدد", quantity: 1, reorder_point: 10 }],
  },
  // ══════════════════════ آرایشگاه زنانه (۲۱) ══════════════════════
  // یادآوری: بهای تمام‌شده فقط از «مواد مصرفی» حساب می‌شود، نه دستمزد
  // و زمان. در سالن زنانه که بخش بزرگی از قیمت، مهارت و زمان است،
  // رقم «سود» را با این نکته تفسیر کن.
  {
    key: "womens_haircut", productName: "کوتاهی مو زنانه", suggestedPrice: 350_000, icon: "💇‍♀️",
    prepMin: 45,
    category: "مو", businessTypes: ["salon"],
    ingredients: [
      { name: "شامپو سالن", unit: "kg", quantity: 0.03, reorder_point: 3 },
      { name: "ماسک مو", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "brushing", productName: "براشینگ و حالت‌دهی", suggestedPrice: 300_000, icon: "💫",
    prepMin: 30,
    category: "مو", businessTypes: ["salon"],
    ingredients: [
      { name: "شامپو سالن", unit: "kg", quantity: 0.03, reorder_point: 3 },
      { name: "اسپری حالت‌دهنده", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "root_color", productName: "رنگ مو (ریشه)", suggestedPrice: 900_000, icon: "🎨",
    prepMin: 90,
    category: "رنگ و لایت", businessTypes: ["salon"],
    ingredients: [
      { name: "رنگ مو حرفه‌ای", unit: "عدد", quantity: 1, reorder_point: 20 },
      { name: "اکسیدان", unit: "l", quantity: 0.08, reorder_point: 4 },
    ],
  },
  {
    key: "full_color", productName: "رنگ مو کامل", suggestedPrice: 1_500_000, icon: "🎨",
    prepMin: 150,
    category: "رنگ و لایت", businessTypes: ["salon"],
    ingredients: [
      { name: "رنگ مو حرفه‌ای", unit: "عدد", quantity: 2, reorder_point: 20 },
      { name: "اکسیدان", unit: "l", quantity: 0.15, reorder_point: 4 },
      { name: "ماسک مو", unit: "kg", quantity: 0.03, reorder_point: 2 },
    ],
  },
  {
    key: "highlight", productName: "لایت و هایلایت", suggestedPrice: 2_200_000, icon: "✨",
    prepMin: 180,
    category: "رنگ و لایت", businessTypes: ["salon"],
    ingredients: [
      { name: "پودر دکلره", unit: "kg", quantity: 0.06, reorder_point: 2 },
      { name: "اکسیدان", unit: "l", quantity: 0.2, reorder_point: 4 },
      { name: "فویل آلومینیوم", unit: "عدد", quantity: 25, reorder_point: 200 },
      { name: "ماسک مو", unit: "kg", quantity: 0.04, reorder_point: 2 },
    ],
  },
  {
    key: "balayage", productName: "بالیاژ", suggestedPrice: 3_000_000, icon: "🌈",
    prepMin: 210,
    category: "رنگ و لایت", businessTypes: ["salon"],
    ingredients: [
      { name: "پودر دکلره", unit: "kg", quantity: 0.09, reorder_point: 2 },
      { name: "اکسیدان", unit: "l", quantity: 0.25, reorder_point: 4 },
      { name: "رنگ مو حرفه‌ای", unit: "عدد", quantity: 1, reorder_point: 20 },
      { name: "ماسک مو", unit: "kg", quantity: 0.05, reorder_point: 2 },
    ],
  },
  {
    key: "womens_keratin", productName: "کراتین مو", suggestedPrice: 3_500_000, icon: "💧",
    prepMin: 180,
    category: "کراتین و احیا", businessTypes: ["salon"],
    ingredients: [
      { name: "محلول کراتین", unit: "kg", quantity: 0.15, reorder_point: 3 },
      { name: "شامپو بدون سولفات", unit: "kg", quantity: 0.05, reorder_point: 3 },
    ],
  },
  {
    key: "hair_botox", productName: "بوتاکس مو", suggestedPrice: 3_200_000, icon: "💧",
    prepMin: 150,
    category: "کراتین و احیا", businessTypes: ["salon"],
    ingredients: [
      { name: "بوتاکس مو", unit: "kg", quantity: 0.15, reorder_point: 3 },
      { name: "شامپو بدون سولفات", unit: "kg", quantity: 0.05, reorder_point: 3 },
    ],
  },
  {
    key: "protein_therapy", productName: "احیای مو (پروتئین)", suggestedPrice: 2_500_000, icon: "🧬",
    prepMin: 120,
    category: "کراتین و احیا", businessTypes: ["salon"],
    ingredients: [
      { name: "پروتئین مو", unit: "kg", quantity: 0.12, reorder_point: 3 },
      { name: "ماسک مو", unit: "kg", quantity: 0.05, reorder_point: 2 },
    ],
  },
  {
    key: "face_threading", productName: "اصلاح صورت (بند و موم)", suggestedPrice: 250_000, icon: "🪡",
    prepMin: 15,
    category: "پوست و اصلاح", businessTypes: ["salon"],
    ingredients: [
      { name: "نخ اصلاح", unit: "عدد", quantity: 1, reorder_point: 50 },
      { name: "وکس اپیلاسیون", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "full_body_wax", productName: "اپیلاسیون کامل بدن", suggestedPrice: 1_200_000, icon: "🪄",
    prepMin: 60,
    category: "پوست و اصلاح", businessTypes: ["salon"],
    ingredients: [
      { name: "وکس اپیلاسیون", unit: "kg", quantity: 0.25, reorder_point: 3 },
      { name: "نوار اپیلاسیون", unit: "عدد", quantity: 30, reorder_point: 200 },
      { name: "روغن بعد از اپیلاسیون", unit: "kg", quantity: 0.03, reorder_point: 2 },
    ],
  },
  {
    key: "womens_eyebrow", productName: "اصلاح ابرو", suggestedPrice: 150_000, icon: "✂️",
    prepMin: 15,
    category: "پوست و اصلاح", businessTypes: ["salon"],
    ingredients: [
      { name: "نخ اصلاح", unit: "عدد", quantity: 1, reorder_point: 50 },
    ],
  },
  {
    key: "facial_cleanse", productName: "پاکسازی صورت", suggestedPrice: 900_000, icon: "🧖‍♀️",
    prepMin: 45,
    category: "پوست و اصلاح", businessTypes: ["salon"],
    ingredients: [
      { name: "ژل پاکسازی", unit: "kg", quantity: 0.04, reorder_point: 2 },
      { name: "ماسک صورت", unit: "عدد", quantity: 1, reorder_point: 20 },
      { name: "کرم آبرسان", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "bridal_makeup", productName: "میکاپ عروس", suggestedPrice: 6_000_000, icon: "👰",
    prepMin: 120,
    category: "میکاپ", businessTypes: ["salon"],
    ingredients: [
      { name: "لوازم میکاپ (مصرفی)", unit: "عدد", quantity: 1, reorder_point: 10 },
      { name: "مژه مصنوعی", unit: "عدد", quantity: 1, reorder_point: 30 },
      { name: "فیکساتور آرایش", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "party_makeup", productName: "میکاپ مجلسی", suggestedPrice: 2_500_000, icon: "💄",
    prepMin: 60,
    category: "میکاپ", businessTypes: ["salon"],
    ingredients: [
      { name: "لوازم میکاپ (مصرفی)", unit: "عدد", quantity: 1, reorder_point: 10 },
      { name: "مژه مصنوعی", unit: "عدد", quantity: 1, reorder_point: 30 },
    ],
  },
  {
    key: "updo", productName: "شینیون مو", suggestedPrice: 1_800_000, icon: "👑",
    prepMin: 45,
    category: "میکاپ", businessTypes: ["salon"],
    ingredients: [
      { name: "اسپری حالت‌دهنده", unit: "kg", quantity: 0.05, reorder_point: 2 },
      { name: "گیره و سنجاق مو", unit: "عدد", quantity: 20, reorder_point: 200 },
    ],
  },
  {
    key: "manicure", productName: "مانیکور", suggestedPrice: 450_000, icon: "💅",
    prepMin: 45,
    category: "ناخن", businessTypes: ["salon"],
    ingredients: [
      { name: "لاک ناخن", unit: "عدد", quantity: 1, reorder_point: 20 },
      { name: "استون و پد", unit: "kg", quantity: 0.02, reorder_point: 2 },
    ],
  },
  {
    key: "pedicure", productName: "پدیکور", suggestedPrice: 550_000, icon: "🦶",
    prepMin: 60,
    category: "ناخن", businessTypes: ["salon"],
    ingredients: [
      { name: "لاک ناخن", unit: "عدد", quantity: 1, reorder_point: 20 },
      { name: "نمک و کرم پا", unit: "kg", quantity: 0.03, reorder_point: 2 },
    ],
  },
  {
    key: "nail_extension", productName: "کاشت ناخن", suggestedPrice: 1_300_000, icon: "💅",
    prepMin: 90,
    category: "ناخن", businessTypes: ["salon"],
    ingredients: [
      { name: "پودر کاشت ناخن", unit: "kg", quantity: 0.03, reorder_point: 2 },
      { name: "تیپ ناخن", unit: "عدد", quantity: 10, reorder_point: 100 },
      { name: "لاک ژل", unit: "عدد", quantity: 1, reorder_point: 20 },
    ],
  },
  {
    key: "lash_lift", productName: "لیفت و لمینت مژه", suggestedPrice: 800_000, icon: "👁️",
    prepMin: 45,
    category: "مژه و ابرو", businessTypes: ["salon"],
    ingredients: [
      { name: "کیت لیفت مژه", unit: "عدد", quantity: 1, reorder_point: 15 },
    ],
  },
  {
    key: "microblading", productName: "میکروبلیدینگ ابرو", suggestedPrice: 2_800_000, icon: "🖌️",
    prepMin: 90,
    category: "مژه و ابرو", businessTypes: ["salon"],
    ingredients: [
      { name: "رنگدانه میکروبلیدینگ", unit: "عدد", quantity: 1, reorder_point: 10 },
      { name: "تیغ میکروبلیدینگ", unit: "عدد", quantity: 1, reorder_point: 30 },
      { name: "کرم بی‌حسی", unit: "kg", quantity: 0.01, reorder_point: 2 },
    ],
  },
];

export function templatesFor(businessType: string): BomTemplate[] {
  return BOM_TEMPLATES.filter((t) => t.businessTypes.includes(businessType as BusinessType));
}
