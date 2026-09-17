# پلاگین بومی خواندن پیامک

> ⚠️ **این کد روی گوشی شما تست نشده.** من در محیطی کار می‌کنم که Android SDK ندارد، پس نتوانستم آن را کامپایل یا اجرا کنم. منطق پارس پیامک (که بخش پیچیده است) در `www/sms-parser.js` جداست و با ۲۱ تست پوشش داده شده؛ ولی همین فایل Java باید روی دستگاه واقعی آزمایش شود.

## چرا این‌قدر کوچک است

پلاگین فقط متن خام پیامک‌ها را برمی‌گرداند. تشخیص تراکنش، مبلغ، بانک و دسته‌بندی همه در جاوااسکریپت انجام می‌شود که قابل تست است. هرچه کد بومیِ تست‌نشده کمتر باشد، ریسک کمتر است.

فقط **می‌خواند**. نه ارسال، نه حذف، نه هیچ درخواست شبکه‌ای — متن پیامک‌ها از گوشی خارج نمی‌شود.

## نصب

پس از `npx cap add android`:

**۱.** فایل را در مسیر پکیج اپ بگذارید (نام پکیج باید با `appId` در `capacitor.config.json` یکی باشد):

```
android/app/src/main/java/ir/moradisadegh/marketboard/SmsReaderPlugin.java
```

**۲.** در `android/app/src/main/java/.../MainActivity.java` ثبتش کنید:

```java
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(SmsReaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

**۳.** مجوز را به `android/app/src/main/AndroidManifest.xml` اضافه کنید:

```xml
<uses-permission android:name="android.permission.READ_SMS" />
```

**۴.** بیلد بگیرید و **روی گوشی واقعی** تست کنید — شبیه‌ساز پیامک بانکی ندارد.

## استفاده از سمت JS

```js
const { SmsReader } = window.Capacitor.Plugins;
const { granted } = await SmsReader.requestPermission();
if (granted) {
  const { messages } = await SmsReader.read({ sinceMs: lastImport, limit: 500 });
  for (const m of messages) {
    const c = window.SmsParser.classify(m.body);
    if (c.kind === 'confirmed') { /* ثبت تراکنش */ }
    else if (c.kind === 'ambiguous') { /* از کاربر بپرس */ }
  }
}
```

## نکته مهم درباره انتشار

گوگل‌پلی مجوز `READ_SMS` را فقط برای اپ‌های پیش‌فرض پیامک تأیید می‌کند و اپ شما رد می‌شود. **مایکت و کافه‌بازار این محدودیت را ندارند** و مقصد شما همان‌هاست، ولی اگر روزی قصد گوگل‌پلی داشتید این بخش باید حذف شود.

## دو باگی که در پارسر اصلی پیدا شد

هنگام انتقال منطق از `SmsParser.kt` دو اشکال پیدا شد که در نسخه JS رفع شده‌اند و **در اپ ExpenseTracker هم باید رفع شوند**:

۱. **پیامک بلو، مانده را به‌جای مبلغ ثبت می‌کرد.** در «۵۰٬۰۰۰ ریال از حساب شما پرید. مانده: ۱٬۰۰۰٬۰۰۰» مبلغ *قبل* از کلیدواژه است، ولی `substringAfter` فقط بعد از کلیدواژه را می‌گشت و به مانده می‌رسید.

۲. **پیامک رمز پویا به‌عنوان تراکنش ثبت می‌شد.** `classify` اول `parse` را صدا می‌زد و بعد فیلتر اسپم را؛ چون پیامک رمز پویا مبلغ دارد («رمز پویا: ۸۴۲۱۳ مبلغ ۱٬۵۰۰٬۰۰۰ ریال»)، با موفقیت پارس می‌شد و به‌عنوان تراکنش قطعی ثبت می‌شد. بعد پیامک برداشت واقعی هم می‌آمد، یعنی **هر خرید کارتی دو بار شمرده می‌شد**. ضمناً «رمز پویا» و «رمز دوم» اصلاً در فهرست کلیدواژه‌های اسپم نبودند.
