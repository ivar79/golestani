/**
 * Iranian Provinces, Counties, Major Cities and Villages Comprehensive Geospatial Dataset
 * Part of InCard Phase 3: Nationwide coverage with Lat/Lng centroids.
 */

export interface ProvinceData {
  name: string;
  slug: string;
  center: string;
  lat: number;
  lng: number;
  cities: string[];
}

export const IRAN_PROVINCES: ProvinceData[] = [
  {
    name: "گلستان",
    slug: "golestan",
    center: "گرگان",
    lat: 36.8456,
    lng: 54.4393,
    cities: [
      "گرگان", "گنبد کاووس", "علی‌آباد کتول", "بندر ترکمن", "آق‌قلا",
      "کردکوی", "کلاله", "آزادشهر", "مینو‌دشت", "گالیکش", "بندر گز",
      "گمیشان", "رامیان", "مراوه‌تپه", "روستای زیارت", "روستای ناهارخوران", "اینچه‌برون"
    ],
  },
  {
    name: "تهران",
    slug: "tehran",
    center: "تهران",
    lat: 35.6892,
    lng: 51.3890,
    cities: [
      "تهران", "شهریار", "اسلامشهر", "ورامین", "شهرری", "دماوند",
      "قدس", "ملارد", "پاکدشت", "پردیس", "بهارستان", "رباط‌کریم",
      "فیروزکوه", "بومهن", "رودهن", "لواسان", "فشم", "کهریزک", "شریف‌آباد"
    ],
  },
  {
    name: "خراسان رضوی",
    slug: "razavi-khorasan",
    center: "مشهد",
    lat: 36.2972,
    lng: 59.6067,
    cities: [
      "مشهد", "نیشابور", "سبزوار", "تربت حیدریه", "کاشمر", "قوچان",
      "تربت جام", "چناران", "سرخس", "گناباد", "فریمان", "درگز",
      "بردسکن", "طرقبه", "شاندیز", "خواف", "تایباد"
    ],
  },
  {
    name: "اصفهان",
    slug: "isfahan",
    center: "اصفهان",
    lat: 32.6546,
    lng: 51.6680,
    cities: [
      "اصفهان", "کاشان", "خمینی‌شهر", "نجف‌آباد", "شاهین‌شهر", "شهرضا",
      "فولادشهر", "مبارکه", "زرین‌شهر", "آران و بیدگل", "گلپایگان",
      "فلاورجان", "سمیرم", "نائین", "خوانسار", "نطنز", "اردستان", "ابیانه"
    ],
  },
  {
    name: "فارس",
    slug: "fars",
    center: "شیراز",
    lat: 29.5926,
    lng: 52.5836,
    cities: [
      "شیراز", "مرودشت", "کازرون", "جهرم", "لار", "فسا", "داراب",
      "فیروزآباد", "آباده", "نورآباد", "اقلید", "استهبان", "نی‌ریز",
      "گراش", "اوز", "لامرد", "سپیدان"
    ],
  },
  {
    name: "مازندران",
    slug: "mazandaran",
    center: "ساری",
    lat: 36.5659,
    lng: 53.0586,
    cities: [
      "ساری", "بابل", "آمل", "قائم‌شهر", "بهشهر", "چالوس", "نکا",
      "بابلسر", "تنکابن", "نوشهر", "فریدونکنار", "رامسر", "جویبار",
      "محمودآباد", "نور", "گلوگاه", "سوادکوه", "کلاردشت", "عباس‌آباد"
    ],
  },
  {
    name: "گیلان",
    slug: "gilan",
    center: "رشت",
    lat: 37.2809,
    lng: 49.5924,
    cities: [
      "رشت", "بندر انزلی", "لاهیجان", "لنگرود", "تالش", "آستارا",
      "صومعه‌سرا", "رودسر", "فومن", "آستانه اشرفیه", "رودبار",
      "ماسال", "شفت", "سیاهکل", "املش", "رضوانشهر", "ماسوله"
    ],
  },
  {
    name: "آذربایجان شرقی",
    slug: "east-azerbaijan",
    center: "تبریز",
    lat: 38.0800,
    lng: 46.2919,
    cities: [
      "تبریز", "مراغه", "مرند", "میانه", "اهر", "بناب", "سراب",
      "آذرشهر", "شبستر", "عجب‌شیر", "ملکان", "هریس", "اسکو", "جلفا", "کندوان"
    ],
  },
  {
    name: "آذربایجان غربی",
    slug: "west-azerbaijan",
    center: "ارومیه",
    lat: 37.5527,
    lng: 45.0761,
    cities: [
      "ارومیه", "خوی", "بوکان", "مهاباد", "میاندوآب", "سلماس",
      "پیرانشهر", "نقده", "سردشت", "ماکو", "شاهین‌دژ", "تکاب", "اشنویه", "چالدران"
    ],
  },
  {
    name: "البرز",
    slug: "alborz",
    center: "کرج",
    lat: 35.8400,
    lng: 50.9391,
    cities: [
      "کرج", "فردیس", "کمال‌شهر", "نظرآباد", "محمدشهر", "ماهدشت",
      "مشکین‌دشت", "هشتگرد", "چهارباغ", "اشتهارد", "طالقان", "گرمدره", "کردان"
    ],
  },
  {
    name: "خوزستان",
    slug: "khuzestan",
    center: "اهواز",
    lat: 31.3183,
    lng: 48.6706,
    cities: [
      "اهواز", "دزفول", "آبادان", "بندر ماهشهر", "خرمشهر", "اندیمشک",
      "ایذه", "بهبهان", "شوشتر", "مسجد سلیمان", "بندر امام خمینی",
      "رامهرمز", "شوش", "امیدیه", "شادگان", "سوسنگرد", "دشت آزادگان"
    ],
  },
  {
    name: "قم",
    slug: "qom",
    center: "قم",
    lat: 34.6401,
    lng: 50.8764,
    cities: ["قم", "جعفریه", "کهک", "قنوات", "دستجرد", "سلفچگان"],
  },
  {
    name: "کرمانشاه",
    slug: "kermanshah",
    center: "کرمانشاه",
    lat: 34.3277,
    lng: 47.0778,
    cities: [
      "کرمانشاه", "اسلام‌آباد غرب", "کنگاور", "جوانرود", "سنقر",
      "هرسین", "صحنه", "سرپل ذهاب", "پاوه", "گیلانغرب", "روانسر", "قصر شیرین"
    ],
  },
  {
    name: "کردستان",
    slug: "kurdistan",
    center: "سنندج",
    lat: 35.3219,
    lng: 46.9862,
    cities: [
      "سنندج", "سقز", "مریوان", "بانه", "قروه", "کامیاران",
      "بیجار", "دیواندره", "دهگلان", "سروآباد", "اورامان"
    ],
  },
  {
    name: "همدان",
    slug: "hamedan",
    center: "همدان",
    lat: 34.7989,
    lng: 48.5150,
    cities: [
      "همدان", "ملایر", "نهاوند", "اسدآباد", "تویسرکان",
      "بهار", "کبودرآهنگ", "رزن", "فامنین", "لالجین"
    ],
  },
  {
    name: "یزد",
    slug: "yazd",
    center: "یزد",
    lat: 31.8974,
    lng: 54.3569,
    cities: [
      "یزد", "میبد", "اردکان", "بافق", "مهریز", "ابرکوه",
      "اشکذر", "تفت", "هرات", "مروست", "زارچ"
    ],
  },
  {
    name: "کرمان",
    slug: "kerman",
    center: "کرمان",
    lat: 30.2839,
    lng: 57.0834,
    cities: [
      "کرمان", "سیرجان", "رفسنجان", "جیرفت", "بم", "زرند",
      "کهنوج", "شهر بابک", "بافت", "بردسیر", "عنبرآباد", "راور", "ماهان"
    ],
  },
  {
    name: "هرمزگان",
    slug: "hormozgan",
    center: "بندرعباس",
    lat: 27.1832,
    lng: 56.2666,
    cities: [
      "بندرعباس", "میناب", "قشم", "کیش", "دهبارز", "بندر لنگه",
      "حاجی‌آباد", "کنگ", "پارسیان", "جاسک", "بستک", "خمیر", "هرمز"
    ],
  },
  {
    name: "مرکزی",
    slug: "markazi",
    center: "اراک",
    lat: 34.0954,
    lng: 49.7013,
    cities: [
      "اراک", "ساوه", "خمین", "محلات", "دلیجان", "شازند",
      "زرندیه", "تفرش", "کمیجان", "آشتیان", "خنداب"
    ],
  },
  {
    name: "قزوین",
    slug: "qazvin",
    center: "قزوین",
    lat: 36.2797,
    lng: 50.0049,
    cities: [
      "قزوین", "الوند", "تاکستان", "آبیک", "محمدیه", "بیدستان",
      "محمودآباد نمونه", "بوئین‌زهرا", "شریفیه", "اقبالیه", "الموت"
    ],
  },
  {
    name: "زنجان",
    slug: "zanjan",
    center: "زنجان",
    lat: 36.6744,
    lng: 48.4845,
    cities: [
      "زنجان", "ابهر", "خرمدره", "قیدار", "هیدج", "صائین‌قلعه",
      "آب‌بر", "سلطانیه", "زرین‌آباد", "ماهنشان"
    ],
  },
  {
    name: "سمنان",
    slug: "semnan",
    center: "سمنان",
    lat: 35.5729,
    lng: 53.3971,
    cities: [
      "سمنان", "شاهرود", "دامغان", "گرمسار", "مهدی‌شهر",
      "ایوانکی", "شهمیرزاد", "سرخه", "بسطام", "آرادان"
    ],
  },
  {
    name: "اردبیل",
    slug: "ardabil",
    center: "اردبیل",
    lat: 38.2498,
    lng: 48.2933,
    cities: [
      "اردبیل", "پارس‌آباد", "مشگین‌شهر", "خلخال", "گرمی",
      "نمین", "بیله‌سوار", "اصلاندوز", "کوثر", "سرعین", "گیوی"
    ],
  },
  {
    name: "لرستان",
    slug: "lorestan",
    center: "خرم‌آباد",
    lat: 33.4878,
    lng: 48.3558,
    cities: [
      "خرم‌آباد", "بروجرد", "دورود", "کوهدشت", "الیگودرز",
      "نورآباد", "ازنا", "الشتر", "پلدختر", "سراب دوره", "چغلوندی"
    ],
  },
  {
    name: "بوشهر",
    slug: "bushehr",
    center: "بوشهر",
    lat: 28.9234,
    lng: 50.8203,
    cities: [
      "بوشهر", "برازجان", "بندر گناوه", "بندر کنگان", "خورموج",
      "جم", "بندر دیلم", "عسلویه", "بندر دیر", "اهرم", "خارگ"
    ],
  },
  {
    name: "سیستان و بلوچستان",
    slug: "sistan-and-baluchestan",
    center: "زاهدان",
    lat: 29.4963,
    lng: 60.8629,
    cities: [
      "زاهدان", "زابل", "ایرانشهر", "چابهار", "سراوان", "خاش",
      "کنارک", "نیک‌شهر", "پیشین", "سوران", "زهک", "فنوج", "مهرستان"
    ],
  },
  {
    name: "چهارمحال و بختیاری",
    slug: "chaharmahal-and-bakhtiari",
    center: "شهرکرد",
    lat: 32.3256,
    lng: 50.8644,
    cities: [
      "شهرکرد", "بروجن", "لردگان", "فرخ‌شهر", "فارسان", "هفشجان",
      "سامان", "چلگرد", "کیار", "بن", "اردل", "کوهرنگ"
    ],
  },
  {
    name: "ایلام",
    slug: "ilam",
    center: "ایلام",
    lat: 33.6374,
    lng: 46.4227,
    cities: [
      "ایلام", "ایوان", "دهلران", "آبدانان", "دره‌شهر",
      "مهران", "سرابله", "ارکواز", "بدره", "چوار", "هلیلان"
    ],
  },
  {
    name: "کهگیلویه و بویراحمد",
    slug: "kohgiluyeh-and-boyer-ahmad",
    center: "یاسوج",
    lat: 30.6684,
    lng: 51.5876,
    cities: [
      "یاسوج", "دوگنبدان (گچساران)", "دهدشت", "لیکک", "چرام",
      "لنده", "باشت", "سی‌سخت", "دیشموک"
    ],
  },
  {
    name: "خراسان جنوبی",
    slug: "south-khorasan",
    center: "بیرجند",
    lat: 32.8663,
    lng: 59.2211,
    cities: [
      "بیرجند", "قائن", "فردوس", "طبس", "نهبندان", "سرایان",
      "سربیشه", "بشرویه", "اسدیه", "حاجی‌آباد", "خوسف"
    ],
  },
  {
    name: "خراسان شمالی",
    slug: "north-khorasan",
    center: "بجنورد",
    lat: 37.4747,
    lng: 57.3290,
    cities: [
      "بجنورد", "شیروان", "اسفراین", "آشخانه", "جاجرم",
      "گرمه", "فاروج", "راز", "ایور", "صفی‌آباد"
    ],
  },
];

/**
 * Normalizes Persian strings (replaces Arabic yeh/kaf and zero-width spaces).
 */
export function normalizePersian(str: string): string {
  if (!str) return "";
  return str
    .replace(/\u064A/g, "\u06CC") // Arabic Yeh -> Persian
    .replace(/\u0643/g, "\u06A9") // Arabic Kaf -> Persian
    .replace(/\u200C/g, " ")     // Half space to space
    .replace(/\s+/g, " ")        // Multiple spaces
    .trim()
    .toLowerCase();
}

/**
 * Get all 31 Iranian provinces
 */
export function getAllProvinces(): ProvinceData[] {
  return IRAN_PROVINCES;
}

/**
 * Find province by name or slug
 */
export function getProvince(query: string): ProvinceData | undefined {
  const norm = normalizePersian(query);
  return IRAN_PROVINCES.find(
    (p) =>
      normalizePersian(p.name) === norm ||
      p.slug.toLowerCase() === query.toLowerCase() ||
      normalizePersian(p.center) === norm
  );
}

/**
 * Search cities, towns and villages across all Iran with fuzzy matching
 */
export function searchIranLocations(
  query: string,
  limit = 15
): Array<{ name: string; province: string; lat: number; lng: number; isCenter?: boolean }> {
  const q = normalizePersian(query);
  if (!q) return [];

  const matches: Array<{ name: string; province: string; lat: number; lng: number; isCenter?: boolean }> = [];

  for (const prov of IRAN_PROVINCES) {
    const provNorm = normalizePersian(prov.name);
    // If query matches province directly
    if (provNorm.includes(q)) {
      matches.push({
        name: prov.center,
        province: prov.name,
        lat: prov.lat,
        lng: prov.lng,
        isCenter: true,
      });
    }

    // Match in cities/villages
    for (const city of prov.cities) {
      if (normalizePersian(city).includes(q)) {
        matches.push({
          name: city,
          province: prov.name,
          lat: prov.lat,
          lng: prov.lng,
          isCenter: city === prov.center,
        });
      }
      if (matches.length >= limit) break;
    }
    if (matches.length >= limit) break;
  }

  return matches;
}

export function isValidLocation(name: string): boolean {
  if (!name) return false;
  const decoded = decodeURIComponent(name).replace(/-/g, " ");
  const norm = normalizePersian(decoded);
  return IRAN_PROVINCES.some(
    (p) =>
      normalizePersian(p.name) === norm ||
      p.slug.toLowerCase() === decoded.toLowerCase() ||
      p.cities.some((c) => normalizePersian(c) === norm)
  );
}

