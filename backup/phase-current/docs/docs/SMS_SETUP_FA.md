# راه‌اندازی SMS

در توسعه از `LogSmsDriver` استفاده می‌شود و provider واقعی به سیستم وابسته نیست. برای اتصال provider واقعی، یک کلاس مطابق `SmsProviderInterface` بسازید و binding را در `SmsServiceProvider` تنظیم کنید. فقط تنظیمات provider مانند API key، username، password و template ID باید از environment خوانده شوند؛ این مقادیر نباید در کد یا repository قرار گیرند. محدودیت ارسال OTP سه درخواست در ده دقیقه و محدودیت تأیید پنج تلاش در پانزده دقیقه حفظ شده است.
