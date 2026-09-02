# آماده‌سازی پرداخت

در Revenue MVP هیچ پرداخت واقعی یا درگاه فعالی اضافه نشده است. `PaymentGatewayInterface` قرارداد مشترک برای adapterهای آینده است. برای ZarinPal، IDPay یا Mellat باید adapter جداگانه نوشته شود و credentials فقط از environment خوانده شوند. فعال‌سازی درگاه، callback، verify و ثبت تراکنش باید در یک مرحله مستقل و پس از تأیید provider انجام شود.
