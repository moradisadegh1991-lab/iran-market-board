# تابلوی بازار ایران — Iran Market Board

داشبورد Next.js روی Vercel + ربات تلگرام برای دلار، تتر، طلا و سکه، کریپتو و بورس تهران/فرابورس.

- قیمت لحظه‌ای + حباب سکه و طلای ۱۸ + پرمیوم تتر
- ریسک خرید / نگهداری / فروش در ۶ افق (روزانه تا سالانه)
- ۱۰ کوین + ۱۰ میم‌کوین (غربال مومنتوم هفتگی)
- ۱۰ سهم بورس/فرابورس (غربال یک‌ماهه)
- سبد دارایی برای ۳ پروفایل ریسک × افق‌های ۱، ۳، ۶ و ۱۲ ماهه
- ارسال همه بخش‌ها به تلگرام (دستورها + گزارش روزانه به کانال و مشترکان)

> ⚠️ خروجی‌ها رتبه‌بندی و مدل آماری‌اند، نه پیش‌بینی قیمت یا توصیه سرمایه‌گذاری.

---

## ۱) Deploy

```bash
unzip iran-market-board.zip && cd iran-market-board
npm install
npm run typecheck && npm run smoke   # تست آفلاین کامل (بدون اینترنت)
git init && git add . && git commit -m "init"
git remote add origin git@github.com:moradisadegh1991-lab/iran-market-board.git
git push -u origin main
```

در Vercel: **Add New → Project → Import** همین ریپو. Framework خودکار Next.js است.

### Storage
`Vercel → Storage → Marketplace → Upstash Redis → Connect` روی همین پروژه.
متغیرهای `KV_REST_API_URL / KV_REST_API_TOKEN` یا `UPSTASH_REDIS_REST_URL / TOKEN` خودکار اضافه می‌شوند؛ هر دو پشتیبانی می‌شوند.
بدون Redis برنامه اجرا می‌شود ولی تاریخچه، کش و مشترکان ربات بعد از هر cold start پاک می‌شوند (بنر زرد بالای صفحه).

### Environment Variables (حداقل)
| متغیر | توضیح |
|---|---|
| `ADMIN_SECRET` | رشته تصادفی بلند؛ برای diag، ingest، setup و broadcast |
| `CRON_SECRET` | Vercel خودش در هدر cron می‌فرستد |
| `BRSAPI_KEY` | کلید BrsApi.ir (برای شاخص و نمادهای بورس) |
| `TELEGRAM_BOT_TOKEN` | از @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | رشته تصادفی (فقط `A-Z a-z 0-9 _ -`) |
| `NEXT_PUBLIC_BOT_USERNAME` | نام ربات بدون @ |
| `TELEGRAM_CHANNEL_ID` | اختیاری، مثل `@mychannel`؛ ربات باید ادمین کانال باشد |
| `COINGECKO_API_KEY` | اختیاری (Demo key)، برای rate limit کمتر |

بقیه در `.env.example`. بعد از تغییر env یک Redeploy بزنید.

---

## ۲) اولین کار بعد از Deploy: تست اتصال منابع

```
https://YOUR-APP.vercel.app/api/diag?secret=ADMIN_SECRET
```

برای هر منبع `ok`، زمان پاسخ، کلیدهای JSON خام و یک نمونه پارس‌شده برمی‌گردد.

- اگر `tgju` یا `nobitex` یا `brsIndex/brsSymbols` خطای 403 / timeout دادند، یعنی IP دیتاسنتر Vercel را مسدود کرده‌اند → بخش ۵.
- در `brsIndex` و `brsSymbols` بررسی کنید `parsed` مقدار واقعی دارد؛ پارسر نام فیلدها را به‌صورت تدافعی حدس می‌زند (`l18, pl, pc, tval, …`). اگر خالی بود، خروجی `rawKeys` را برای اصلاح `lib/sources/brsapi.ts` استفاده کنید.

---

## ۳) ربات تلگرام

```
https://YOUR-APP.vercel.app/api/telegram/setup?secret=ADMIN_SECRET
```
webhook و منوی دستورها را ثبت می‌کند. بعد در ربات `/start` بزنید.

| دستور | خروجی |
|---|---|
| `/prices` | قیمت‌ها، حباب و پرمیوم |
| `/risk` | ریسک ۶ افق همه دارایی‌ها |
| `/crypto` · `/meme` | ۱۰ کوین · ۱۰ میم‌کوین هفته |
| `/stocks` | ۱۰ سهم ماه |
| `/portfolio` · `/portfolio_safe` · `/portfolio_bold` | سبد متعادل · محتاط · جسور |
| `/all` | گزارش کامل (چند پیام) |
| `/stop` | لغو گزارش روزانه |

ارسال دستی به کانال + همه مشترکان:
```bash
curl -X POST https://YOUR-APP.vercel.app/api/telegram/broadcast -H "x-admin-secret: ADMIN_SECRET"
```
یا از پنل «ربات تلگرام» پایین داشبورد.

### Cron (UTC)
| مسیر | زمان | تهران |
|---|---|---|
| `/api/cron/refresh` | `0 10 * * *` | ۱۳:۳۰ (بعد از بسته شدن بازار؛ ثبت روز معاملاتی) |
| `/api/cron/broadcast` | `30 4 * * *` | ۸:۰۰ صبح |

پلن Hobby فقط cron روزانه مجاز است؛ این دو همین‌طورند. `DAILY_BROADCAST=0` گزارش روزانه را خاموش می‌کند.

---

## ۴) پر کردن تاریخچه بورس (ضروری برای غربال سهام)

غربال یک‌ماهه به حداقل ۲۰ روز معاملاتی ذخیره‌شده نیاز دارد. تا آن زمان حالت «گرم‌شدن» فعال است و رتبه‌بندی فقط با معاملات همان روز انجام می‌شود (اعتبار پایین).

برای پر کردن فوری، از ماشینی که TSETMC را باز می‌کند (معمولاً IP ایران):

```bash
# فقط Python 3 استاندارد لازم است (Termux هم کافی است)
python3 scripts/backfill_tse.py --probe                 # تست دسترسی به TSETMC با ۳ نماد
python3 scripts/backfill_tse.py \
  --url https://YOUR-APP.vercel.app --secret ADMIN_SECRET \
  --days 60 --top 300
```

اسکریپت از endpointهای `cdn.tsetmc.com` استفاده می‌کند (market watch، سابقه قیمت پایانی، سابقه شاخص کل). این endpointها غیررسمی‌اند و ممکن است تغییر کنند؛ اگر `--probe` خطا داد، فایل CSV را از هر منبعی (خروجی TSETMC، pytse-client، …) بسازید:

```csv
symbol,date,close,value
فولاد,2026-08-20,5230,120000000000
```
```bash
python3 scripts/backfill_tse.py --url https://YOUR-APP.vercel.app --secret ADMIN_SECRET --csv history.csv
```
- `date` میلادی `YYYY-MM-DD`، `close` و `value` به **ریال**.
- حروف «ي/ك» عربی خودکار به «ی/ک» فارسی تبدیل می‌شوند تا با نام نمادهای BrsApi یکی شوند.
- سرور حداکثر ۸۰ روز و ۴۵۰ نماد نگه می‌دارد.

---

## ۵) اگر منبعی IP ویرسل را مسدود کرد: `/api/ingest`

۱. نام منبع را در env بگذارید تا Vercel دیگر مستقیم درخواست نزند:
```
INGEST_ONLY_SOURCES=tgju,nobitex
```
۲. از ماشینی با IP ایران (مثلاً n8n روی Termux، هر ۵ دقیقه) JSON خام همان API را push کنید:

```bash
URL=https://YOUR-APP.vercel.app/api/ingest
SECRET=ADMIN_SECRET

# TGJU
curl -s https://call.tgju.org/ajax.json \
 | jq -c '{source:"tgju", data:.}' \
 | curl -s -X POST "$URL" -H "x-admin-secret: $SECRET" -H "content-type: application/json" -d @-

# Nobitex
curl -s "https://api.nobitex.ir/market/stats?srcCurrency=usdt,btc,eth&dstCurrency=rls,usdt" \
 | jq -c '{source:"nobitex", data:.}' \
 | curl -s -X POST "$URL" -H "x-admin-secret: $SECRET" -H "content-type: application/json" -d @-
```

در n8n: `HTTP Request (API منبع)` → `HTTP Request (POST به /api/ingest)` با body
`{"source":"tgju","data": {{ $json }} }` و هدر `x-admin-secret`.

قالب‌های قابل قبول:
```jsonc
{"source": "tgju|goldapi|nobitex|brsIndex|brsSymbols", "data": <JSON خام API>}
{"kind": "daily", "asset": "usd|usdt|g18|coin|ons|btc|eth|tse", "points": [{"date":"2026-01-31","value":1050000}]}  // ریال
{"kind": "tse", "symbols": {"فولاد": [{"date":"2026-01-31","close":5230,"value":1.2e11}]}}
```
`kind: daily` برای وارد کردن سابقه واقعی دلار و سکه است (مثلاً از خروجی قدیمی n8n) تا ریسک بلندمدت به‌جای proxy از داده واقعی ساخته شود.

---

## ۶) مدل‌ها در یک نگاه

**ریسک (۶ افق)** — بازده لگاریتمی با توزیع نرمال؛ روند تاریخی ۵۰٪ کوچک می‌شود، نوسان کوتاه‌مدت ترکیب EWMA (λ=0.94) و انحراف معیار نمونه است. آستانه افت/رشد: ۲٪ روزانه، ۴٪ هفتگی، ۸٪ ماهانه، ۱۲٪ سه‌ماهه، ۱۸٪ شش‌ماهه، ۲۵٪ سالانه.
- خرید = احتمال افت + گرانی (RSI و z-score) + بیشینه افت اخیر + (حباب برای سکه و طلا)
- نگهداری = احتمال افت + بیشینه افت
- فروش = احتمال جاماندن از رشد + ارزانی نسبی

تا تاریخچه واقعی جمع شود، بازده‌ها با proxy ساخته می‌شوند: دلار ← USDT/IRT نوبیتکس، طلا ← PAXG × تتر. ستون «اعتماد به داده» این را نشان می‌دهد.

**کریپتو (هفته)** — رتبه صدکی: روند ۷ روزه × R²، بازده ۷ و ۳۰ روزه، گردش معاملات به ارزش بازار، نزدیکی به سقف، آرامش نوسان؛ جریمه جهش ۲۴ ساعته. استیبل‌کوین‌ها، توکن‌های wrapped/staked و نمادهای تکراری حذف می‌شوند.

**سهام (ماه)** — قدرت نسبی ۲۰ روزه به شاخص، بازده ۶۰ روزه، جهش ارزش معاملات ۵ روز به ۴۰ روز، نزدیکی به سقف ۶۰ روزه، SMA20/50، ورود پول حقیقی؛ جریمه اشباع خرید، صف خرید، P/E بالا و زیان‌ده. فیلتر نقدشوندگی: `TSE_MIN_TVAL`.

**سبد** — وزن پایه هر پروفایل/افق در `lib/engine/portfolio.ts` (قابل ویرایش)، ضریب ۰٫۴ تا ۱٫۶ بر اساس ریسک ورود همان افق، سقف هر دسته، کف درآمد ثابت، نوسان سبد با ماتریس همبستگی فرضی و VaR ۹۵٪.

---

## ۶-ب) معامله‌گر شبیه‌ساز (`/simulator`)

بازه زمانی گذشته، سرمایه اولیه، ریسک‌پذیری و بازارهای مجاز را می‌گیرد و روز به روز معامله می‌کند:

- **داده قیمت:** همان تاریخچه روزانه‌ای که بقیه سایت استفاده می‌کند (TGJU برای دلار، طلا و سکه؛ TSETMC/BrsApi برای شاخص؛ CoinGecko × دلار برای کریپتو). حداکثر بازه حدود ۴۰۰ روز است.
- **بدون نگاه به آینده:** تصمیم در پایان هر جلسه فقط با قیمت‌های تا همان روز و خبرهای منتشرشده تا ساعت ۱۶ گرفته می‌شود و سفارش در قیمت پایانی جلسه بعد اجرا می‌شود.
- **هزینه واقعی:** اسپرد صرافی و طلافروشی، کارمزد صندوق و صرافی کریپتو برای هر طرف معامله؛ نقدینگی بیکار سود `FIXED_INCOME_YIELD` می‌گیرد.
- **منطق:** امتیاز روند (میانگین ۲۰/۵۰)، مومنتوم ۲۰ و ۶۰ روزه نسبت به نوسان، RSI، فاصله از سقف، حباب سکه و اخبار ۱۰ روز اخیر. بازبینی هفتگی، بازبینی فوری فقط برای رویداد خبری جدید و مهم، حد ضرر متحرک بر پایه نوسان، سیو سود یک‌سوم.
- **اخبار:** جست‌وجوی تاریخ‌دار Google News (فارسی و انگلیسی) برای هر ماه، و GDELT در صورت خطا. هر ماه جدا کش می‌شود؛ ماه‌های تمام‌شده ۱۲۰ روز. هر تیتر با قاعده‌های کلیدواژه‌ای (تحریم، مذاکره، تنش، نرخ بهره آمریکا، ETF، هک صرافی و …) به اثر روی هر دارایی تبدیل می‌شود و در دلیل معامله با منبع و تاریخ ذکر می‌شود.
- **خروجی:** دفتر معاملات با دلیل هر خرید و فروش، نمودار ارزش سرمایه با فلش معاملات، مقایسه با سپرده و خرید و نگهداری، سهم هر دارایی، و تحلیل کلی.

اجرای اول برای یک سال ممکن است تا ~۶۰ ثانیه طول بکشد (دریافت خبرها). اگر زمان کم بیاید، بخشی از ماه‌ها دریافت می‌شود و هشدار نمایش داده می‌شود؛ اجرای دوباره از کش ادامه می‌دهد.

بعد از دیپلوی در `/api/diag` سه مورد `googleNewsFa`، `googleNewsEn` و `gdeltNews` را چک کنید. اگر هر سه خطا دادند، شبیه‌ساز بدون خبر اجرا می‌شود.

**اختیاری — تحلیل روایی با Claude:** اگر `ANTHROPIC_API_KEY` تنظیم شود، علاوه بر تحلیل قاعده‌محور، یک مرور چهار پاراگرافی فقط بر پایه اعداد و خبرهای همان شبیه‌سازی نوشته می‌شود (`ANTHROPIC_MODEL` پیش‌فرض `claude-sonnet-5`).

تست آفلاین: `npm run smoke:sim` (بررسی عدم نگاه به آینده، نقد منفی نشدن، اتحاد حسابداری سود و زیان، و کش خبر).

## ۶-ج) معامله برخط (`/live`)

همان موتور و قواعد شبیه‌ساز، این‌بار روی قیمت زنده و تیک‌به‌تیک. معامله کاغذی است: پول واقعی جابه‌جا نمی‌شود.

**شروع:** صفحه `/live` → سرمایه، مدت (۱ هفته تا ۳ ماه)، پروفایل ریسک، دارایی‌های مجاز → `ADMIN_SECRET` → شروع. هر زمان یک معامله فعال بیشتر مجاز نیست.

**تفاوت‌ها با شبیه‌ساز گذشته‌نگر:**
- سفارش در همان لحظه با قیمت زنده ± اسپرد اجرا می‌شود، ولی فقط وقتی بازار آن دارایی باز است؛ در غیر این صورت در صف می‌ماند تا بازار باز شود (کریپتو ۲۴ ساعته؛ دلار، طلا و سکه شنبه تا چهارشنبه؛ بورس ۹ تا ۱۲:۳۰ به وقت تهران).
- حد ضرر و سیو سود در هر تیک (هر چند دقیقه) بررسی می‌شود، نه روزی یک‌بار.
- پارامترهای موتور در لحظه شروع قفل می‌شوند تا کل جلسه یک استراتژی ثابت باشد.

**⚠️ قدم ضروری — ضربان‌ساز:** پلن Hobby ورسل حداکثر روزی یک cron اجرا می‌کند، ولی معامله برخط هر چند دقیقه تیک لازم دارد. فایل `.github/workflows/paper-tick.yml` در پروژه هست و هر ۱۰ دقیقه `/api/paper/tick` را صدا می‌زند؛ فقط این دو Secret را در گیت‌هاب بسازید (`Settings → Secrets and variables → Actions`):

| Secret | مقدار |
|---|---|
| `BOARD_URL` | `https://YOUR-APP.vercel.app` |
| `CRON_SECRET` | همان مقداری که در env ورسل گذاشتید |

جایگزین‌ها: cron-job.org با آدرس `https://YOUR-APP.vercel.app/api/paper/tick?secret=ADMIN_SECRET` هر ۵ تا ۱۰ دقیقه. بازدید داشبورد و پیام به ربات هم فرصتی برای تیک می‌سازند، ولی به‌تنهایی قابل اتکا نیستند.

**تلگرام:** `/live_on ADMIN_SECRET` نزد ربات (ربات همان پیام را برای پاک‌کردن رمز حذف می‌کند) → از آن پس هر خرید و فروش با دلیل، قیمت اجرا، سود/زیان تحقق‌یافته و ارزش سبد اطلاع داده می‌شود. `/live` وضعیت، `/live_off` لغو اعلان، `/live_stop` پایان.

**یادگیری:** پایان هر جلسه (برخط یا شبیه‌سازی) وزن‌ها و ضریب اعتماد هر دارایی کمی تنظیم می‌شود و نسخه موتور یک عدد بالا می‌رود؛ `/api/learning` وضعیت فعلی را نشان می‌دهد و `POST {"action":"reset"}` با `ADMIN_SECRET` به قواعد پایه برمی‌گرداند. آموزش دوباره روی همان بازه بلوکه می‌شود تا بیش‌برازش نشود.

تست آفلاین: `npx tsx scripts/learn-live-test.ts` (اجرای یک جلسه کامل ۳۰ روزه، بررسی اجرای سفارش فقط در ساعات بازار، منفی‌نشدن نقد، یادگیری، و کران‌دار بودن حجم جلسه).

## ۷) ساختار

```
app/               صفحه‌ها: / · scenarios · simulator · live · swing · charts · risk · stocks · crypto · portfolio · bot
app/api/           snapshot · diag · ingest · chart · simulate · paper/{,tick} · learning · swing · holdings · cron/* · telegram/{webhook,setup,broadcast}
lib/sources/       tgju · goldapi · nobitex · brsapi · coingecko · history · news · cache
lib/engine/        stats · risk · crypto · tse · portfolio · scenario · simulator · live · learning · swing
lib/telegram/      api · format · handler · paper
lib/               snapshot · series · history · simulate · paper · learning · intraday · store · auth · num · http
components/        Shell · SnapshotProvider · ui · TradeEntry · EquityChart · PriceChart · Sparkline · HoldingsPanel
components/views/  Overview · Scenarios · Simulator · Live · Swing · Charts · Risk · Stocks · Crypto · Portfolio · Bot
scripts/           smoke · sim-smoke · sim-regression · learn-live-test · swing-validate · backfill_tse.py
.github/workflows/ paper-tick.yml (ضربان‌ساز معامله برخط)
```

تست‌ها: `npm run typecheck` · `npm run smoke` · `npm run smoke:sim` · `npx tsx scripts/sim-regression.ts` · `npx tsx scripts/learn-live-test.ts` · `npx tsx scripts/swing-validate.ts`

## محدودیت‌های واقعی
- endpointهای TGJU، نوبیتکس، BrsApi و TSETMC ممکن است بدون اطلاع تغییر کنند یا IP خارجی را ببندند؛ `/api/diag` را بعد از هر خطا چک کنید.
- غربال‌ها رتبه‌بندی مومنتوم‌اند؛ دقت پیش‌بینی آن‌ها به‌ویژه برای میم‌کوین‌ها و سهام با صف پایین است.
- همبستگی‌ها و وزن‌های پایه سبد فرض‌اند، نه برآورد آماری.
- معامله برخط کاغذی است و روی قیمت‌های مرجع (نه دفتر سفارش واقعی) اجرا می‌شود؛ اسپرد و کارمزد تقریبی‌اند و لغزش قیمت در حجم بالا لحاظ نمی‌شود.
- ضربان‌ساز گیت‌هاب اجرای زمان‌بندی‌شده را زیر بار چند دقیقه عقب می‌اندازد و بعد از ۶۰ روز بی‌فعالیتی در ریپو غیرفعال می‌شود؛ فاصله تیک‌ها تضمین‌شده نیست.
- یادگیری روی تعداد کم جلسه انجام می‌شود، پس تغییر پارامترها شاهد آماری قوی ندارد؛ در تست walk-forward نسخه آموخته همیشه بهتر از پایه نبود.
