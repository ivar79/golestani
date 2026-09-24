/**
 * سازندهٔ خالصِ DOM پاپ‌آپ کسب‌وکار برای موتور نشان (MapLibre).
 *
 * امنیت (S1 — Stored XSS): هیچ داده‌ای که از دیتابیس/کاربر می‌آید
 * (title, category, subtitle, logoUrl, href) هرگز با innerHTML تزریق
 * نمی‌شود. همه با textContent / setAttribute ست می‌شوند تا یک نام مخرب مثل
 * "<img src=x onerror=alert(1)>" صرفاً «متن» رندر شود و هرگز اجرا نشود.
 *
 * href/logoUrl فقط با اسکیم http(s) مجازند (relative مثل "/b/x" برای href هم
 * مجاز است چون مسیر داخلی است)؛ javascript:/data: و هر ورودی خطرناک رد
 * می‌شود. پیاده‌سازی خالص DOM است (بدون React) و در تست node هم اجرا می‌شود.
 *
 * Phase 3 contract (استنساخ دقیق از نسخهٔ قبلی innerHTML):
 *  - unclaimed → متن توافقی + تنها لینک CTA به /login (بدون لینک پروفایل/شبکه)
 *  - claimed   → لوگو (اختیاری) + title + category + subtitle + CTA «مشاهده کارت ویزیت»
 */

export type PopupMarker = {
  id: number | string;
  latitude: number;
  longitude: number;
  title: string;
  subtitle?: string;
  href?: string;
  category?: string;
  distance?: number | null;
  unclaimed?: boolean;
  promoted?: boolean;
  logoUrl?: string | null;
};

/** فقط http(s) مطلق یا مسیر relative امن (باید با «/» تک شروع شود). */
export function isSafeHref(url: string | null | undefined): boolean {
  if (!url) return false;
  if (/^https?:\/\//i.test(url)) return true;
  return /^\/(?!\/)/.test(url);
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function appendLogo(parent: HTMLElement, logoUrl: string | null | undefined): void {
  if (!logoUrl || !isSafeHref(logoUrl)) return;
  const img = document.createElement("img");
  // setAttribute (نه property) — شفاف و قابل‌آزمون؛ فقط پس از تأیید isSafeHref.
  img.setAttribute("src", logoUrl);
  img.setAttribute("alt", "");
  img.className = "h-9 w-9 rounded-lg object-cover shrink-0";
  img.loading = "lazy";
  parent.appendChild(img);
}

function appendCta(parent: HTMLElement, href: string, label: string): void {
  if (!isSafeHref(href)) return;
  const a = el(
    "a",
    "mt-1 block text-center rounded-lg bg-[#0b1626] px-2 py-1.5 text-[11px] font-bold text-white hover:bg-[#00c98d] hover:text-[#0b1626] transition-colors",
    label,
  );
  a.setAttribute("href", href);
  parent.appendChild(a);
}

/**
 * ساخت ریشهٔ پاپ‌آپ کاملاً با DOM API. خروجی آمادهٔ popup.setDOMContent است.
 */
export function buildPopupDom(item: PopupMarker): HTMLElement {
  const root = document.createElement("div");
  root.dir = "rtl";
  root.className = "space-y-1 p-1 text-right";

  if (item.unclaimed === true) {
    // Phase 3: پین خاکستری — پاپ‌آپ سبک توافقی؛ تنها CTA ثبت مالکیت.
    root.appendChild(el("p", "text-sm font-bold text-slate-900", item.title));
    if (item.category) {
      root.appendChild(el("p", "text-xs text-slate-500", item.category));
    }
    root.appendChild(
      el("p", "text-[11px] leading-relaxed text-slate-600", "این کسب‌وکار هنوز در اینکارت فعال نشده است."),
    );
    appendCta(root, "/login", "صاحب این کسب‌وکار هستید؟ ثبت مالکیت رایگان");
    return root;
  }

  // claimed
  const head = el("div", "flex items-center gap-2");
  appendLogo(head, item.logoUrl);
  head.appendChild(el("p", "text-sm font-bold text-slate-900", item.title));
  root.appendChild(head);

  if (item.category) {
    root.appendChild(el("p", "text-xs text-slate-500", item.category));
  }
  if (item.subtitle) {
    root.appendChild(el("p", "text-xs text-slate-600", item.subtitle));
  }
  if (item.href) {
    appendCta(root, item.href, "مشاهده کارت ویزیت");
  }
  return root;
}
