/* ============================================================
   game-engine.js — موتور بازی «واحد کنترل اقتصاد»
   منتقل‌شده از پروژه eqtesad-control-unit بدون تغییر در منطق.
   فقط دو تغییر مکانیکی: حذف import/export (چون هر دو فایل در یک
   scope قرار گرفته‌اند) و در معرض گذاشتن API روی window.ECU،
   تا بدون ES modules در WebView اندروید هم اجرا شود.
   ============================================================ */
(function () {
  'use strict';

/* ============================================================
   content.js — محتوای بازی
   شغل‌ها، درس‌ها، و رویدادها. بدون وابستگی به React.
   ============================================================ */

/* ── شغل‌ها ──────────────────────────────────────────────────
   هر شغل سه چیز را تعیین می‌کند:
   sideRate   : چند برابرِ نرخ روزانهٔ شغل اصلی می‌توانی در کار آزاد بگیری
   offerRate  : چقدر پیشنهاد کار آزاد به سراغت می‌آید (۰ تا ۱)
   intl       : آیا مسیر درآمد بین‌المللی برای این شغل واقع‌بینانه است
   volatility : نوسان ماهانهٔ درآمد اصلی
   ---------------------------------------------------------- */
const JOBS = {
  engineer: {
    label: "مهندس / فنی و صنعتی",
    sideRate: 1.5, offerRate: 0.75, intl: true, volatility: 0.18,
    note: "تخصص فنی، مشاوره و پروژهٔ صنعتی. درآمد جانبی خوب، ولی وقت‌گیر.",
    sideKinds: ["پروژهٔ داشبورد و گزارش", "مشاورهٔ فنی", "طراحی و محاسبات"],
  },
  developer: {
    label: "برنامه‌نویس / فناوری اطلاعات",
    sideRate: 1.7, offerRate: 0.85, intl: true, volatility: 0.15,
    note: "بالاترین قابلیت درآمد جانبی و تنها مسیر واقعاً باز به بازار بین‌المللی.",
    sideKinds: ["ساخت وب‌سایت", "اپلیکیشن سفارشی", "اتوماسیون و ربات"],
  },
  teacher: {
    label: "معلم / مدرس",
    sideRate: 1.2, offerRate: 0.7, intl: false, volatility: 0.1,
    note: "تدریس خصوصی و آنلاین. درآمد پایدار ولی سقف‌دار.",
    sideKinds: ["تدریس خصوصی", "دورهٔ آنلاین", "تألیف جزوه"],
  },
  medical: {
    label: "پزشک / پرستار / کادر درمان",
    sideRate: 1.6, offerRate: 0.6, intl: false, volatility: 0.22,
    note: "نرخ ساعتی بالا، ولی روزهای آزاد کم و انرژی‌بر.",
    sideKinds: ["شیفت اضافه", "ویزیت خصوصی", "مشاورهٔ آنلاین"],
  },
  shopkeeper: {
    label: "کاسب / فروشنده",
    sideRate: 1.1, offerRate: 0.5, intl: false, volatility: 0.35,
    note: "درآمد پرنوسان. رشد از راه سرمایه‌گذاری در خودِ کسب‌وکار می‌آید، نه کار آزاد.",
    sideKinds: ["فروش آنلاین", "عمده‌فروشی", "همکاری در فروش"],
  },
  govt: {
    label: "کارمند دولت / بخش عمومی",
    sideRate: 0.9, offerRate: 0.45, intl: false, volatility: 0.05,
    note: "پایدارترین درآمد و ضعیف‌ترین رشد. تورم بیشترین فشار را به این گروه می‌آورد.",
    sideKinds: ["کار پاره‌وقت", "خدمات اداری", "آموزش"],
  },
  service: {
    label: "راننده / خدمات / اصناف",
    sideRate: 1.0, offerRate: 0.65, intl: false, volatility: 0.28,
    note: "درآمد مستقیماً به ساعت کار گره خورده. استراحت اینجا از همه‌جا مهم‌تر است.",
    sideKinds: ["سرویس اضافه", "کار قراردادی", "خدمات فنی"],
  },
  creative: {
    label: "طراح / تولیدکنندهٔ محتوا",
    sideRate: 1.4, offerRate: 0.7, intl: true, volatility: 0.3,
    note: "درآمد نامنظم. نمونه‌کار و اعتبار، خودشان دارایی‌اند.",
    sideKinds: ["طراحی گرافیک", "تدوین ویدیو", "تولید محتوا"],
  },
  other: {
    label: "سایر",
    sideRate: 1.2, offerRate: 0.6, intl: false, volatility: 0.2,
    note: "تنظیمات متعادل و خنثی.",
    sideKinds: ["پروژهٔ آزاد", "کار قراردادی", "مشاوره"],
  },
};

/* ── درس‌ها ───────────────────────────────────────────────── */
const LESSONS = {
  L1: { n: 1, t: "تورم و قدرت خرید",
    b: "نقد نگه‌داشتن یک تصمیم است، نه بی‌تصمیمی. پول راکد هر ماه بخشی از قدرت خریدش را از دست می‌دهد. قانون ۷۲: عدد ۷۲ را بر نرخ تورم تقسیم کن تا ببینی چند سال طول می‌کشد پولت نصف شود.",
    ex: "با تورم ۶۰٪، پول راکد در کمتر از ۱٫۲ سال نصف می‌شود." },
  L2: { n: 2, t: "اسمی در برابر واقعی",
    b: "بازده واقعی = (۱+اسمی) ÷ (۱+تورم) − ۱. عدد اسمی بدون تعدیل تورم و بدون مخرج زمان، تبلیغ است نه اندازه‌گیری. سود تجمعی با سود سالانه یکی نیست.",
    ex: "سود ۳۰٪ در تورم ۶۰٪ یعنی بازده واقعی منفی ۱۹٪ — نه منفی ۳۰٪." },
  L3: { n: 3, t: "تطبیق دارایی با تعهد",
    b: "تعهد ارزی را با دارایی ارزی بپرداز و تعهد تومانی را با دارایی تومانی. اگر قیمت چیزی که می‌خواهی بخری به دلار گره خورده، پس‌انداز تومانی برایش یعنی مسابقه با نرخ ارز.",
    ex: "لپ‌تاپ، موبایل، قطعهٔ وارداتی: همه کالای دلاری‌اند حتی وقتی قیمتشان به تومان نوشته شده." },
  L4: { n: 4, t: "سپر نقدینگی",
    b: "سپر یعنی ۳ تا ۶ ماه هزینهٔ کامل زندگی به‌علاوهٔ اقساط، در دارایی کم‌ریسک و در دسترس. بدون آن، اولین هزینهٔ غیرمنتظره تو را به فروش اجباری دارایی وادار می‌کند.",
    ex: "فروش اجباری در بدترین زمان، بزرگ‌ترین قاتل بازده بلندمدت است — بیشتر از انتخاب بد دارایی." },
  L5: { n: 5, t: "هزینهٔ فرصت",
    b: "هزینهٔ هر تصمیم برابر است با پول خرج‌شده به‌علاوهٔ بهترین گزینه‌ای که از دست دادی. روزهایی که روی یک کار می‌گذاری، هزینه‌شان صفر نیست.",
    ex: "اگر روزی ۸ میلیون می‌ارزی، ۴ روز کار روی پروژهٔ شخصی یعنی ۳۲ میلیون سرمایه‌گذاری نامرئی." },
  L6: { n: 6, t: "نرخ کف",
    b: "نرخ کف را از قبل حساب کن و پایین‌تر از آن کار قبول نکن. عدد را قبل از فشار تعیین می‌کنی تا در لحظهٔ نیاز، تصمیم احساسی نگیری.",
    ex: "نرخ کف ≈ (درآمد ماهانه ÷ روزهای کاری) × ۱٫۵ — ضریب برای نبود مزایا و بی‌ثباتی." },
  L7: { n: 7, t: "قیمت‌گذاری",
    b: "قیمت مقطوع بده، نه نرخ ساعتی. سه بسته بچین تا بستهٔ وسط انتخاب شود. پیش‌پرداخت بگیر: در تورم بالا، پول سه ماه دیرتر یعنی تخفیف پنهانی که خودت نمی‌بینی.",
    ex: "دریافت کل مبلغ در ماه سوم با تورم ۶۰٪ یعنی حدود ۶٪ تخفیف ناخواسته." },
  L8: { n: 8, t: "نقدینگی و تورم",
    b: "کسری بودجه، رشد پایهٔ پولی، رشد نقدینگی، و در نهایت تورم — با تأخیر ۶ تا ۱۸ ماه. وقتی پول رشد می‌کند ولی تولید نه، فشار روی قیمت‌ها خالی می‌شود.",
    ex: "رشد نقدینگی، پیش‌نشانگر تورم آینده است. زودتر از آمار رسمی خبر می‌دهد." },
  L9: { n: 9, t: "سیاست پولی",
    b: "سود سپردهٔ بانکی دستوری تعیین می‌شود و در اقتصاد تورمی معمولاً زیر تورم می‌ماند. یعنی نرخ واقعی سپرده منفی است. این اشتباه سپرده‌گذار نیست، ویژگی ساختاری است.",
    ex: "به همین دلیل پول به سمت دریچهٔ اطمینان — ارز و طلا — فرار می‌کند و فشار آنجا بیشتر می‌شود." },
  L10: { n: 10, t: "نظام چندنرخی ارز",
    b: "وقتی یک ارز چند نرخ دارد، شکاف بین نرخ رسمی و آزاد هم رانت می‌سازد و هم سیگنال می‌دهد. هرچه شکاف بازتر، احتمال تعدیل ناگهانی بیشتر.",
    ex: "تعدیل ناگهانی نرخ رسمی، خودش یک شوک تورمی است." },
  L11: { n: 11, t: "ابزارهای سرمایه‌گذاری",
    b: "صندوق درآمد ثابت در تورم بالا بازده واقعی منفی دارد — ولی از نقد راکد بهتر است. نقشش سپر است، نه رشد. صندوق سهامی نوسان دارد و در روز بد، نقد کردنش کند است.",
    ex: "ابزار را با نقشی که در سبد دارد انتخاب کن، نه با بازدهی که تبلیغ می‌شود." },
  L12: { n: 12, t: "بدهی در تورم",
    b: "وام با نرخ ثابت در تورم بالا به نفع بدهکار است، چون تورم ارزش واقعی قسط را کم می‌کند. تسویهٔ پیش از موعد یعنی از دست دادن این مزیت.",
    ex: "قسط ۱۰ میلیونی امروز، با تورم ۶۰٪، سال بعد به قدرت خرید حدود ۶ میلیون تبدیل می‌شود." },
  L13: { n: 13, t: "تمرکز ریسک",
    b: "طلا و ارز یک ریسک‌فاکتور مشترک دارند: نرخ ارز. داشتن هر دو تنوع نیست — یک شرط با دو لباس است. تنوع واقعی یعنی دارایی‌هایی که با هم حرکت نمی‌کنند.",
    ex: "اگر همهٔ دارایی‌هایت با یک خبر بالا و پایین می‌روند، تنوع نداری." },
  L14: { n: 14, t: "فرسودگی",
    b: "ظرفیت کاری یک دارایی مستهلک‌شونده است. حذف استراحت، بازده روزهای بعدی را پایین می‌آورد و این افت تدریجی و نامحسوس است.",
    ex: "کار مداوم بدون استراحت، مثل کارکرد پیوستهٔ یک دستگاه بدون توقف سرویس است." },
};

/* ── رویدادها ─────────────────────────────────────────────── */
const EVENTS = [
  {
    id: "proj", weight: 34,
    when: (s) => s.month >= 1 && Math.random() < s.job.offerRate + 0.2,
    build: (s, rnd = Math.random) => {
      const days = 3 + Math.floor(rnd() * (s.freeDays * 0.7));
      const quality = 0.6 + rnd() * 1.1;
      const price = Math.max(1e6, Math.round((days * s.floorRate * quality) / 1e6) * 1e6);
      const kind = s.job.sideKinds[Math.floor(rnd() * s.job.sideKinds.length)];
      return {
        title: "پیشنهاد پروژه",
        body: `${kind}: قیمت مقطوع ${s.M(price)} میلیون تومان، برآورد ${s.fa(days)} روز کار.`,
        meta: `نرخ ضمنی ${s.M(price / days)} میلیون در روز · نرخ کف تو ${s.M(s.floorRate)} میلیون`,
        options: [
          { label: "قبول می‌کنم", apply: (st) => {
              const creep = Math.random() < 0.3 ? 1 + Math.random() * 0.6 : 1;
              const actual = Math.round(days * creep);
              st.pendingProjects.push({ price, days: actual, left: actual });
              st.note.push(creep > 1
                ? `پروژه قبول شد، اما دامنه گسترش پیدا کرد: ${st.fa(actual)} روز به‌جای ${st.fa(days)}.`
                : `پروژه قبول شد: ${st.fa(actual)} روز کار.`);
              if (price / days < st.floorRate) st.learn.push("L6");
              if (creep > 1) st.learn.push("L7");
            } },
          { label: "رد می‌کنم", apply: (st) => {
              if (price / days < st.floorRate) {
                st.rep += 2;
                st.note.push("پروژهٔ زیر نرخ کف را رد کردی. اعتبار حرفه‌ای‌ات بالا رفت.");
                st.learn.push("L6");
              } else {
                st.rep -= 1;
                st.note.push("پروژه‌ای بالای نرخ کف را رد کردی — این فرصت از دست رفت.");
              }
            } },
        ],
      };
    },
  },
  {
    id: "terms", weight: 11, when: (s) => s.month >= 3,
    build: (s, rnd = Math.random) => {
      const price = Math.round((s.floorRate * (7 + rnd() * 8)) / 1e6) * 1e6;
      const dd = Math.max(3, Math.round(s.freeDays * 0.5));
      return {
        title: "شرایط پرداخت",
        body: `مشتری بزرگی حاضر است ${s.M(price)} میلیون بدهد، اما تمام مبلغ را در پایان ماه سوم پرداخت می‌کند.`,
        meta: "پول دیرتر، در تورم بالا، یعنی تخفیف پنهان.",
        options: [
          { label: "با همین شرایط قبول می‌کنم", apply: (st) => {
              st.pendingCash.push({ amount: price, inMonths: 3 });
              st.consumeDays += dd;
              st.note.push(`قبول شد. ${st.M(price)} میلیون در ماه سوم دریافت می‌شود.`);
              st.learn.push("L7");
            } },
          { label: "قیمت را ۱۵٪ بالا می‌برم", apply: (st) => {
              if (Math.random() < 0.6) {
                const p = Math.round(price * 1.15);
                st.pendingCash.push({ amount: p, inMonths: 3 });
                st.consumeDays += dd;
                st.note.push(`مشتری پذیرفت: ${st.M(p)} میلیون در ماه سوم.`);
                st.learn.push("L7");
              } else st.note.push("مشتری قبول نکرد و رفت.");
            } },
          { label: "پیش‌پرداخت ۴۰٪ می‌خواهم", apply: (st) => {
              if (Math.random() < 0.75) {
                st.cash += price * 0.4;
                st.pendingCash.push({ amount: price * 0.6, inMonths: 2 });
                st.consumeDays += dd;
                st.note.push("مشتری پذیرفت. ۴۰٪ همین حالا نقد شد.");
                st.learn.push("L7");
              } else st.note.push("مشتری قبول نکرد و رفت.");
            } },
        ],
      };
    },
  },
  {
    id: "emergency", weight: 22, when: (s) => s.month >= 2,
    build: (s, rnd = Math.random) => {
      const cost = Math.max(1e6, Math.round((s.living * (1.4 + rnd() * 3.6)) / 1e6) * 1e6);
      const kinds = ["تعمیر اضطراری خودرو", "هزینهٔ درمانی خانواده", "خرابی تأسیسات خانه", "کمک فوری به بستگان", "جریمه و هزینهٔ اداری"];
      return {
        title: "هزینهٔ غیرمنتظره",
        body: `${kinds[Math.floor(rnd() * kinds.length)]}: ${s.M(cost)} میلیون تومان، همین ماه.`,
        meta: "اینجا معلوم می‌شود سپر نقدینگی تشریفاتی بوده یا واقعی.",
        options: [{ label: "پرداخت می‌کنم", apply: (st) => {
          st.cash -= cost; st.note.push(`${st.M(cost)} میلیون پرداخت شد.`); st.learn.push("L4");
        } }],
      };
    },
  },
  {
    id: "bigbuy", weight: 9, once: true, when: (s) => s.month >= 2 && !s.flags.bigbuy,
    build: (s) => {
      const usdPrice = 1500 + Math.floor(Math.random() * 1200);
      return {
        title: "خرید بزرگ و ضروری",
        body: `یک کالای وارداتی مورد نیازت (ابزار کار یا لوازم خانه) حدود ${s.fa(usdPrice)} دلار قیمت دارد — امروز ${s.M(usdPrice * s.p.usd)} میلیون تومان.`,
        meta: "قیمت این کالا به دلار گره خورده، نه به تومان.",
        options: [
          { label: "از نقد تومانی می‌خرم", apply: (st) => {
              st.cash -= usdPrice * st.p.usd; st.flags.bigbuy = true; st.prod += 0.06;
              st.note.push("خرید از نقد تومانی انجام شد.");
            } },
          { label: "دلار می‌فروشم و می‌خرم", apply: (st) => {
              if (st.a.usd >= usdPrice) {
                st.a.usd -= usdPrice; st.flags.bigbuy = true; st.prod += 0.06;
                st.note.push("تعهد دلاری با دارایی دلاری پرداخت شد — بدون قرار گرفتن در معرض نوسان نرخ.");
                st.learn.push("L3");
              } else st.note.push("دلار کافی نداری.");
            } },
          { label: "فعلاً صبر می‌کنم", apply: (st) => {
              st.prod -= 0.1; st.note.push("نبود این وسیله، بهره‌وری کاری‌ات را پایین آورد.");
            } },
        ],
      };
    },
  },
  {
    id: "quota", weight: 9, when: (s) => s.month >= 4,
    build: (s) => {
      const face = Math.max(20e6, Math.round((s.living * 3) / 1e7) * 1e7);
      const fee = Math.round(face * 0.2);
      const inst = face / 12;
      return {
        title: "بازار امتیاز وام",
        body: `کسی امتیاز وام ${s.M(face)} میلیونی قرض‌الحسنه را به ${s.M(fee)} میلیون می‌فروشد. بازپرداخت ۱۲ قسط ${s.M(inst)} میلیونی بر عهدهٔ توست.`,
        meta: "نرخ اسمی مؤثر حدود ۵۳٪ سالانه — زیر تورم است، ولی قسط از جریان نقدی‌ات کم می‌کند.",
        options: [
          { label: "می‌خرم", apply: (st) => {
              st.cash += face - fee; st.extraInstallment += inst; st.extraLeft = 12;
              st.note.push(`${st.M(face - fee)} میلیون نقد وارد شد. قسط ماهانه ${st.M(inst)} میلیون اضافه شد.`);
              st.learn.push("L9"); st.learn.push("L12");
            } },
          { label: "رد می‌کنم", apply: (st) => st.note.push("پیشنهاد رد شد.") },
        ],
      };
    },
  },
  {
    id: "fomo", weight: 12, when: (s) => s.month >= 3,
    build: (s) => {
      const j = s.lastMove || { key: "gold", name: "طلا", chg: 0.05 };
      return {
        title: "هیجان بازار",
        body: `همه دربارهٔ ${j.name} حرف می‌زنند — ماه گذشته ${s.pct(j.chg * 100)} حرکت کرد. می‌گویند تازه شروع شده.`,
        meta: "خرید در اوج هیجان، گران‌ترین لحظهٔ ورود است.",
        options: [
          { label: "نصف نقدم را وارد می‌کنم", apply: (st) => {
              const amt = st.cash * 0.5;
              if (amt < 1e6) { st.note.push("نقد کافی نداری."); return; }
              st.cash -= amt;
              if (j.key === "gold") st.a.gold += amt / st.p.goldGram;
              else if (j.key === "usd") st.a.usd += amt / st.p.usd;
              else st.a.equity += amt;
              st.fomo += 1; st.note.push("در اوج هیجان وارد شدی.");
            } },
          { label: "به برنامهٔ خودم پایبند می‌مانم", apply: (st) => {
              st.note.push("تصمیم بر اساس برنامه گرفته شد، نه بر اساس تیتر خبر.");
            } },
        ],
      };
    },
  },
  {
    id: "venture", weight: 12, when: (s) => s.month >= 1 && s.ventureStage < 4,
    build: (s) => {
      const base = s.living * 1.2;
      const cost = Math.round((base * [1, 1.6, 2.4, 3.6][s.ventureStage]) / 1e6) * 1e6;
      const names = ["راه‌اندازی اولیه", "توسعهٔ محصول", "بازاریابی آزمایشی", "مقیاس‌دهی"];
      return {
        title: `کسب‌وکار شخصی · ${names[s.ventureStage]}`,
        body: `برای رفتن به مرحلهٔ بعد ${s.M(cost)} میلیون تومان هزینه لازم است.`,
        meta: "هزینهٔ واقعی این مرحله برابر است با این پول به‌علاوهٔ روزهایی که صرفش می‌کنی.",
        options: [
          { label: "سرمایه‌گذاری می‌کنم", apply: (st) => {
              if (st.cash < cost) { st.note.push("نقد کافی نداری."); return; }
              st.cash -= cost; st.ventureInvested += cost; st.ventureStage += 1;
              st.note.push(`مرحلهٔ ${st.fa(st.ventureStage)} کسب‌وکار باز شد.`);
              st.learn.push("L5");
            } },
          { label: "این ماه نه", apply: (st) => st.note.push("سرمایه‌گذاری به تعویق افتاد.") },
        ],
      };
    },
  },
  {
    id: "devaluation", weight: 7, when: (s) => s.month >= 6 && s.pressure > 0.1,
    build: () => ({
      title: "هشدار ارزی",
      body: "شکاف نرخ رسمی و بازار آزاد به‌شدت باز شده و زمزمهٔ «یکسان‌سازی نرخ ارز» در اخبار پررنگ شده است.",
      meta: "تاریخاً بعد از این زمزمه‌ها یک تعدیل ناگهانی نرخ آمده است.",
      options: [{ label: "متوجه شدم", apply: (st) => st.learn.push("L10") }],
    }),
  },
  {
    id: "deposit", weight: 8, when: (s) => s.month >= 2,
    build: (s) => {
      const amt = Math.round((s.living * 3) / 1e6) * 1e6;
      return {
        title: "پیشنهاد بانک",
        body: `بانک سپردهٔ یک‌ساله با سود ۲۴٪ سالانه پیشنهاد می‌دهد — «تضمین‌شده و بدون ریسک».`,
        meta: "بدون ریسک اسمی. با ریسک واقعی.",
        options: [
          { label: `${s.M(amt)} میلیون سپرده می‌گذارم`, apply: (st) => {
              if (st.cash < amt) { st.note.push("نقد کافی نداری."); return; }
              st.cash -= amt; st.deposit += amt;
              st.note.push(`${st.M(amt)} میلیون سپردهٔ بانکی ثبت شد.`);
              st.learn.push("L9");
            } },
          { label: "رد می‌کنم", apply: (st) => { st.note.push("پیشنهاد سپرده رد شد."); st.learn.push("L9"); } },
        ],
      };
    },
  },
];


/* ============================================================
   engine.js — موتور اقتصاد و قوانین
   توابع خالص. هیچ I/O، هیچ React. کاملاً قابل تست.

   اصل طراحی: تمام محاسبات اینجاست تا با تست قفل شود.
   خطای محاسباتی در امور مالی بی‌صداست — عدد قابل‌قبولی
   نشان می‌دهد و ماه‌ها بر اساسش تصمیم گرفته می‌شود.
   ============================================================ */



const MONTHS = 24;

/* ── قالب‌بندی ───────────────────────────────────────────── */
const fa = (n) => (Math.round(n) || 0).toLocaleString("fa-IR");
const M = (n) => fa(n / 1e6);
const pct = (n, d = 1) =>
  `${n >= 0 ? "" : "−"}${Math.abs(Number.isFinite(n) ? n : 0).toFixed(d)}٪`;

const MONTH_NAMES = ["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
function monthLabel(i, startMonth = 5, startYear = 1405) {
  const idx = (startMonth - 1 + i) % 12;
  const yr = startYear + Math.floor((startMonth - 1 + i) / 12);
  return `${MONTH_NAMES[idx]} ${yr}`;
}

/* ── پروفایل پیش‌فرض ─────────────────────────────────────── */
const DEFAULT_PROFILE = {
  jobKey: "engineer",
  income: 90e6,          // درآمد ماهانهٔ خالص
  living: 30e6,          // هزینهٔ زندگی ماهانه
  installment: 0,        // قسط ماهانه
  loanMonths: 0,         // تعداد اقساط باقی‌مانده
  freeDays: 8,           // روزهای آزاد در ماه
  workdays: 22,          // روزهای کاری شغل اصلی
  assets: { cash: 50e6, gold: 0, usd: 0, coin: 0, fixed: 0, equity: 0 },
  prices: { goldGram: 18_700_000, usd: 193_000, coinHalf: 92_510_000 },
  inflation: 60,         // برآورد تورم سالانه٪ — نقطهٔ شروع شبیه‌سازی
};

/* ── ساخت بازی از پروفایل ────────────────────────────────── */
function newGame(profile) {
  const P = { ...DEFAULT_PROFILE, ...profile };
  const job = JOBS[P.jobKey] || JOBS.other;
  const monthlyInfl = Math.pow(1 + P.inflation / 100, 1 / 12) - 1;

  const s = {
    month: 0,
    profile: P,
    job,
    freeDays: P.freeDays,
    cash: P.assets.cash,
    deposit: 0,
    a: {
      gold: P.assets.gold,
      usd: P.assets.usd,
      coin: P.assets.coin,
      fixed: P.assets.fixed,
      equity: P.assets.equity,
    },
    p: { ...P.prices },
    cpi: 100,
    liq: monthlyInfl / 0.82,
    pressure: 0,
    ounce: 4054,
    baseIncome: P.income,
    living: P.living,
    installment: P.installment,
    loanLeft: P.loanMonths,
    extraInstallment: 0,
    extraLeft: 0,
    prod: 1,
    rep: 50,
    skillIntl: 0,
    fomo: 0,
    restDebt: 0,
    ventureStage: 0,
    ventureInvested: 0,
    ventureRevenue: 0,
    ventureDays: 0,
    pendingProjects: [],
    pendingCash: [],
    lessons: [],
    hist: [],
    flags: {},
    note: [],
    learn: [],
  };
  s.floorRate = floorRateOf(s);
  s.startWealth = wealthOf(s);
  s.hist = [{ m: 0, nominal: s.startWealth, real: s.startWealth, cpi: 100, usd: s.p.usd }];
  return s;
}

/* ── محاسبات پایه ───────────────────────────────────────── */
function incomeOf(s, rnd = Math.random) {
  // حقوق با تأخیر و به‌طور ناقص با تورم تعدیل می‌شود — واقعیت اقتصاد تورمی
  const adj = 1 + (s.cpi / 100 - 1) * 0.55;
  const noise = 1 + (rnd() - 0.5) * 2 * s.job.volatility;
  return s.baseIncome * adj * Math.max(0.4, noise);
}

const wealthOf = (s) =>
  s.cash + s.deposit +
  s.a.gold * s.p.goldGram +
  s.a.usd * s.p.usd +
  s.a.coin * s.p.coinHalf +
  s.a.fixed + s.a.equity;

const burnOf = (s) =>
  s.living +
  (s.loanLeft > 0 ? s.installment : 0) +
  (s.extraLeft > 0 ? s.extraInstallment : 0);

/* نرخ کف: ضریب > ۱ چون روز آزاد رقیب دارد، مزایا ندارد،
   و بی‌ثباتی درآمد روی دوش خودت است */
function floorRateOf(s) {
  const wd = Math.max(1, s.profile.workdays);
  return (s.baseIncome / wd) * 1.5 * s.job.sideRate;
}

const bufferMonthsOf = (s) => {
  const b = burnOf(s);
  return b > 0 ? (s.cash + s.deposit + s.a.fixed) / b : 99;
};

const realWealthOf = (s) => (wealthOf(s) / s.cpi) * 100;

const fxShareOf = (s) => {
  const w = wealthOf(s);
  if (w <= 0) return 0;
  return ((s.a.gold * s.p.goldGram + s.a.usd * s.p.usd + s.a.coin * s.p.coinHalf) / w) * 100;
};

function annualInflationOf(s) {
  if (s.month < 1) return s.profile.inflation;
  return (Math.pow(s.cpi / 100, 12 / s.month) - 1) * 100;
}

/* ── یک ماه جلو ─────────────────────────────────────────── */
function stepMonth(prev, alloc, rnd = Math.random) {
  const st = structuredCloneSafe(prev);
  st.note = st.note || [];
  st.learn = st.learn || [];

  /* ۱) استراحت و فرسودگی */
  const restTarget = Math.max(1, Math.round(st.freeDays / 6));
  st.restDebt = Math.max(0, st.restDebt + (restTarget - alloc.rest));
  if (st.restDebt >= restTarget * 2) {
    st.prod = Math.max(0.55, st.prod - 0.07);
    st.note.push("کم‌خوابی و فشار کاری، بهره‌وری‌ات را پایین آورد.");
    st.learn.push("L14");
  } else if (alloc.rest >= restTarget) {
    st.prod = Math.min(1.15, st.prod + 0.02);
  }

  /* ۲) کار روی پروژه‌های پذیرفته‌شده */
  let workDays = alloc.side * st.prod;
  let earned = 0;
  for (const pr of st.pendingProjects) {
    if (workDays <= 0) break;
    const d = Math.min(workDays, pr.left);
    pr.left -= d;
    workDays -= d;
    if (pr.left <= 0.01) { earned += pr.price; st.rep += 3; }
  }
  st.pendingProjects = st.pendingProjects.filter((p) => p.left > 0.01);
  st.cash += earned;
  if (earned > 0) st.note.push(`تحویل پروژه: ${M(earned)} میلیون دریافت شد.`);
  if (workDays > 0) st.rep += workDays * 1.2;

  /* ۳) مسیر بین‌المللی */
  if (st.job.intl) {
    st.skillIntl += alloc.intl * (3 + rnd() * 2);
    if (st.skillIntl >= 60 && alloc.intl > 0) {
      const inc = alloc.intl * st.floorRate * 2.2 * st.prod;
      st.cash += inc;
      st.note.push(`درآمد بین‌المللی: ${M(inc)} میلیون.`);
    } else if (alloc.intl > 0) {
      st.note.push(`ساخت پایگاه بین‌المللی: ${fa(Math.min(100, st.skillIntl))}٪ از ۶۰٪ لازم.`);
    }
  } else if (alloc.intl > 0) {
    st.rep += alloc.intl * 1.5;
  }

  /* ۴) کسب‌وکار شخصی */
  st.ventureDays += alloc.venture;
  if (st.ventureStage > 0) {
    const growth = alloc.venture * st.ventureStage * (0.9 + rnd() * 0.5);
    st.ventureRevenue = st.ventureRevenue * 1.04 + growth * st.living * 0.055;
    st.cash += st.ventureRevenue;
    if (st.ventureRevenue > 1e6) st.note.push(`درآمد کسب‌وکار: ${M(st.ventureRevenue)} میلیون.`);
  }

  /* ۵) درآمد اصلی و هزینه‌ها */
  st.cash += incomeOf(st, rnd);
  st.cash -= burnOf(st);
  if (st.loanLeft > 0) st.loanLeft -= 1;
  if (st.extraLeft > 0) st.extraLeft -= 1;

  st.pendingCash = st.pendingCash.filter((pc) => {
    pc.inMonths -= 1;
    if (pc.inMonths <= 0) {
      st.cash += pc.amount;
      st.note.push(`دریافت معوق: ${M(pc.amount)} میلیون.`);
      return false;
    }
    return true;
  });

  /* ۶) اقتصاد کلان: نقدینگی → تورم با تأخیر */
  st.liq = Math.max(0.015, Math.min(0.08, st.liq + (rnd() - 0.5) * 0.008));
  const infl = Math.max(0.005, st.liq * 0.82 + (rnd() - 0.5) * 0.012);
  st.cpi *= 1 + infl;

  /* هزینهٔ زندگی با تورم بالا می‌رود — اما آدم‌ها وقتی تحت فشارند
     سبک زندگی را جمع می‌کنند. این «سفت‌کردن کمربند» واقعی است و
     بدون آن، مدل هر حقوق‌بگیر کم‌درآمدی را قطعاً ورشکسته می‌کند. */
  const squeezed = st.cash < burnOf(st);
  const livingInfl = squeezed ? infl * 0.55 : infl * (0.9 + rnd() * 0.2);
  st.living *= 1 + livingInfl;
  if (squeezed && !st.flags.belt) {
    st.flags.belt = true;
    st.note.push("زیر فشار نقدینگی، ناچار سبک زندگی را جمع کردی. هزینه‌ها کندتر رشد می‌کنند.");
  }

  /* ۷) ارز: فشار انباشته می‌شود و ناگهانی آزاد می‌گردد */
  st.pressure += infl - 0.012;
  let fxMove;
  if (st.pressure > 0.14 && rnd() < 0.45) {
    fxMove = st.pressure * (0.7 + rnd() * 0.5);
    st.pressure = 0.01;
    st.note.push("جهش ارزی: فشار انباشته آزاد شد.");
  } else {
    fxMove = infl * (0.25 + rnd() * 0.6) + (rnd() - 0.5) * 0.02;
    st.pressure = Math.max(0, st.pressure - fxMove * 0.5);
  }

  const usdOld = st.p.usd;
  const goldOld = st.p.goldGram;
  st.p.usd *= 1 + fxMove;
  st.ounce *= 1 + (rnd() - 0.48) * 0.05;
  // نسبت طلا به دلار از قیمت‌های ورودی کاربر کالیبره می‌شود تا پرش ساختگی نداشته باشیم
  const k = st.profile.prices.goldGram / ((4054 / 31.1035) * st.profile.prices.usd);
  st.p.goldGram = (st.ounce / 31.1035) * st.p.usd * k;
  st.p.coinHalf = st.p.goldGram * (st.profile.prices.coinHalf / st.profile.prices.goldGram) * (1 + (rnd() - 0.5) * 0.05);

  /* ۸) صندوق‌ها و سپرده */
  const eqMove = st.liq * 1.4 - 0.02 + (rnd() - 0.5) * 0.16;
  st.a.equity *= 1 + eqMove;
  st.a.fixed *= 1 + 0.029;
  st.deposit *= 1 + 0.019;

  st.lastMove = [
    { key: "gold", name: "طلا", chg: st.p.goldGram / goldOld - 1 },
    { key: "usd", name: "دلار", chg: st.p.usd / usdOld - 1 },
    { key: "equity", name: "صندوق سهامی", chg: eqMove },
  ].sort((a, b) => b.chg - a.chg)[0];

  /* ۹) فروش اجباری — گران‌ترین اتفاق ممکن */
  if (st.cash < 0) {
    let need = -st.cash;
    st.cash = 0;
    const order = [
      [() => st.a.fixed, (v) => (st.a.fixed -= v)],
      [() => st.a.equity, (v) => (st.a.equity -= v)],
      [() => st.deposit, (v) => (st.deposit -= v)],
      [() => st.a.usd * st.p.usd, (v) => (st.a.usd -= v / st.p.usd)],
      [() => st.a.gold * st.p.goldGram, (v) => (st.a.gold -= v / st.p.goldGram)],
      [() => st.a.coin * st.p.coinHalf, (v) => (st.a.coin -= v / st.p.coinHalf)],
    ];
    let penalty = 0;
    for (const [get, take] of order) {
      if (need <= 0) break;
      const avail = get();
      if (avail <= 0) continue;
      const grab = Math.min(avail, need * 1.05);
      take(grab);
      penalty += grab * 0.05;
      need -= grab * 0.95;
    }
    if (need > 0) {
      st.debtSpiral = (st.debtSpiral || 0) + need;
      st.note.push("دارایی کافی برای پوشش کسری نبود. بدهی معوق ثبت شد.");
    }
    st.note.push(`فروش اجباری دارایی. ${M(penalty)} میلیون بابت فروش عجولانه از دست رفت.`);
    st.learn.push("L4");
  }

  st.month += 1;
  st.floorRate = floorRateOf(st);
  st.hist.push({
    m: st.month,
    nominal: wealthOf(st),
    real: realWealthOf(st),
    cpi: st.cpi,
    usd: st.p.usd,
  });
  st.learn.push("L1", "L8");
  if (fxShareOf(st) > 80) st.learn.push("L13");
  return st;
}

/* ── معامله ─────────────────────────────────────────────── */
const TRADE_FEE = 0.01;

function trade(s, kind, dir, amountToman) {
  const n = structuredCloneSafe(s);
  if (!(amountToman > 0)) return s;
  if (dir === "buy") {
    if (n.cash < amountToman) return s;
    n.cash -= amountToman;
    const net = amountToman * (1 - TRADE_FEE);
    if (kind === "gold") n.a.gold += net / n.p.goldGram;
    if (kind === "usd") n.a.usd += net / n.p.usd;
    if (kind === "fixed") n.a.fixed += net;
    if (kind === "equity") n.a.equity += net;
  } else {
    let val = 0;
    if (kind === "gold") { const g = Math.min(n.a.gold, amountToman / n.p.goldGram); n.a.gold -= g; val = g * n.p.goldGram; }
    if (kind === "usd") { const u = Math.min(n.a.usd, amountToman / n.p.usd); n.a.usd -= u; val = u * n.p.usd; }
    if (kind === "fixed") { const v = Math.min(n.a.fixed, amountToman); n.a.fixed -= v; val = v; }
    if (kind === "equity") { const v = Math.min(n.a.equity, amountToman); n.a.equity -= v; val = v; }
    n.cash += val * (1 - TRADE_FEE);
  }
  return n;
}

/* ── انتخاب رویداد ──────────────────────────────────────── */
function pickEvent(s, rnd = Math.random) {
  const pool = EVENTS.filter((e) => e.when(s) && !(e.once && s.flags[e.id]));
  if (!pool.length || rnd() > 0.85) return null;
  const tot = pool.reduce((a, e) => a + e.weight, 0);
  let r = rnd() * tot;
  for (const e of pool) { r -= e.weight; if (r <= 0) return e; }
  return null;
}

/* رویدادها به این توابع نیاز دارند؛ تزریق می‌شوند تا content.js
   وابسته به engine.js نباشد و حلقهٔ import ایجاد نشود */
function withHelpers(s) {
  return { ...s, fa, M, pct };
}

/* ── هفت شاخص داشبورد ───────────────────────────────────── */
function gaugesOf(s) {
  const burn = burnOf(s);
  const buf = bufferMonthsOf(s);
  const income = s.baseIncome * (1 + (s.cpi / 100 - 1) * 0.55);
  const savings = income > 0 ? ((income - burn) / income) * 100 : 0;
  const realChg = s.startWealth > 0 ? (realWealthOf(s) / s.startWealth - 1) * 100 : 0;
  const trueVenture = s.ventureInvested + s.ventureDays * s.floorRate;
  const fx = fxShareOf(s);

  return [
    { n: 1, title: "فرسایش نقد", value: `${M(s.cash * (Math.pow(1 + annualInflationOf(s) / 100, 1 / 12) - 1))}م`,
      status: s.cash > burn * 5 ? "warn" : "ok", note: "آب شدن نقد راکد در یک ماه" },
    { n: 2, title: "ثروت واقعی", value: pct(realChg),
      status: realChg < 0 ? "alarm" : realChg < 5 ? "warn" : "ok",
      note: `تورم سالانه ${pct(annualInflationOf(s), 0)}` },
    { n: 3, title: "تمرکز ارزی", value: pct(fx, 0),
      status: fx > 85 ? "alarm" : fx > 70 ? "warn" : "ok", note: "سهم دارایی وابسته به نرخ ارز" },
    { n: 4, title: "سپر نقدینگی", value: `${buf.toFixed(1)} ماه`,
      status: buf < 1 ? "alarm" : buf < 3 ? "warn" : "ok",
      note: `از ۳ ماه · سوخت ${M(burn)}م` },
    { n: 5, title: "هزینهٔ واقعی کسب‌وکار", value: `${M(trueVenture)}م`,
      status: s.ventureRevenue * 12 < trueVenture && s.ventureStage > 0 ? "warn" : "ok",
      note: "پول به‌علاوهٔ زمان" },
    { n: 6, title: "نرخ کف روزانه", value: `${M(s.floorRate)}م`,
      status: "ok", note: "زیر این عدد پروژه را رد کن" },
    { n: 7, title: "نرخ پس‌انداز", value: pct(savings, 0),
      status: savings < 0 ? "alarm" : savings < 20 ? "warn" : "ok",
      note: "درآمد منهای تعهدات ثابت" },
  ];
}

/* ── کمکی ───────────────────────────────────────────────── */
function structuredCloneSafe(o) {
  // پروفایل و job فقط خواندنی‌اند؛ ساختار بقیه ساده و JSON-safe است
  const { job, profile, ...rest } = o;
  const c = JSON.parse(JSON.stringify(rest));
  c.job = job;
  c.profile = profile;
  return c;
}


  window.ECU = {
    MONTHS, DEFAULT_PROFILE, JOBS, EVENTS,
    newGame, stepMonth, trade, pickEvent, withHelpers,
    incomeOf, wealthOf, burnOf, bufferMonthsOf, realWealthOf, fxShareOf,
    annualInflationOf, floorRateOf, monthLabel, TRADE_FEE,
    fa: fa, M: M, pct: pct,
  };
})();
