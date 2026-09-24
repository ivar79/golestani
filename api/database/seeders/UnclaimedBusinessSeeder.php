<?php

namespace Database\Seeders;

use App\Models\Business;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Phase 3 — Cold Start seeder (approved scope: "Seeding یا Bulk Import").
 *
 * Populates the map with unclaimed businesses (is_claimed = false) so users
 * never see an empty map. These rows:
 *  - are status=approved with real Tehran coordinates (map pins need geom);
 *  - have NO phone and NO license_tracking_code (they are not active members);
 *  - belong to a shared system placeholder owner (users.user_id FK);
 *  - are idempotent: updateOrCreate keyed on the reserved "unclaimed-" slug,
 *    so re-running never duplicates rows.
 *
 * Guardrails:
 *  - DatabaseSeeder skips this seeder in production (see its env guard);
 *    --force can override only outside production.
 *  - geom is backfilled on pgsql so ST_DWithin / ST_Distance work immediately.
 */
class UnclaimedBusinessSeeder extends Seeder
{
    public function run(): void
    {
        $owner = $this->systemOwner();

        foreach ($this->rows() as $row) {
            $business = Business::updateOrCreate(
                ['slug' => $row['slug']],
                [
                    'user_id' => $owner->id,
                    'name' => $row['name'],
                    'category' => $row['category'],
                    'city' => 'تهران',
                    'neighborhood' => $row['neighborhood'],
                    'address' => $row['address'],
                    'latitude' => $row['latitude'],
                    'longitude' => $row['longitude'],
                    'status' => 'approved',
                    // Cold-start rows: unclaimed, unpromoted, unverified.
                    'is_claimed' => false,
                    'is_promoted' => false,
                    'verification_level' => 0,
                    'license_tracking_code' => null,
                    'phone' => null,
                ]
            );

            $this->syncGeometry($business);
        }

        $this->command?->info('UnclaimedBusinessSeeder: '.count($this->rows()).' cold-start pins ensured.');
    }

    /**
     * Shared placeholder owner for every unclaimed row. Reused across runs
     * (updateOrCreate on the reserved email) so FK + idempotency both hold.
     * Email/username are namespaced and phone is null — no real user can ever
     * collide with these identifiers, and phone is required to log in.
     */
    private function systemOwner(): User
    {
        $user = User::updateOrCreate(
            ['email' => 'cold-start@system.inkart.invalid'],
            [
                'name' => 'اینکارت (کسب‌وکارهای ثبت‌نشده)',
                'is_active' => true,
            ]
        );

        // Username carries a unique index; set it only when still missing and
        // not taken by anyone else (defensive — this handle is reserved).
        if (blank($user->username) && ! User::where('username', 'inkart_cold_start')->exists()) {
            User::whereKey($user->id)->update(['username' => 'inkart_cold_start']);
            $user->refresh();
        }

        return $user;
    }

    private function syncGeometry(Business $b): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        if ($b->latitude !== null && $b->longitude !== null) {
            DB::statement(
                'UPDATE businesses SET geom = ST_SetSRID(ST_MakePoint(?, ?), 4326) WHERE id = ?',
                [$b->longitude, $b->latitude, $b->id]
            );
        }
    }

    /**
     * Real-ish Tehran businesses spread across the city so the map never
     * looks empty. Coordinates are real district centers (WGS84).
     *
     * @return array<int, array{slug: string, name: string, category: string, neighborhood: string, address: string, latitude: float, longitude: float}>
     */
    private function rows(): array
    {
        return [
            ['slug' => 'unclaimed-nobakht-bakery', 'name' => 'نانوایی بربری نوبخت', 'category' => 'نانوایی', 'neighborhood' => 'یوسف‌آباد', 'address' => 'خیابان دیدار، نبش کوچه ششم', 'latitude' => 35.7268, 'longitude' => 51.3891],
            ['slug' => 'unclaimed-andisheh-barber', 'name' => 'آرایشگاه مردانه اندیشه', 'category' => 'آرایشگاه', 'neighborhood' => 'پونک', 'address' => 'بلوار عدل، خیابان سیمون بولیوار', 'latitude' => 35.7561, 'longitude' => 51.3362],
            ['slug' => 'unclaimed-vanak-florist', 'name' => 'گلخانه ونک', 'category' => 'گل و گیاه', 'neighborhood' => 'ونک', 'address' => 'خیابان ملاصدرا، پلاک ۱۲۰', 'latitude' => 35.7597, 'longitude' => 51.4102],
            ['slug' => 'unclaimed-sadeghieh-tire', 'name' => 'لاستیک‌فروشی صادقیه', 'category' => 'خدمات خودرو', 'neighborhood' => 'صادقیه', 'address' => 'فلکه دوم صادقیه، بلوار آیت‌الله کاشانی', 'latitude' => 35.7174, 'longitude' => 51.3398],
            ['slug' => 'unclaimed-tajrish-gold', 'name' => 'طلا و جواهر تهراندوست', 'category' => 'طلا و جواهر', 'neighborhood' => 'تجریش', 'address' => 'میدان تجریش، پاساژ نگین', 'latitude' => 35.8034, 'longitude' => 51.4342],
            ['slug' => 'unclaimed-rey-locksmith', 'name' => 'قفل‌سازی چهره', 'category' => 'خدمات ساختمان', 'neighborhood' => 'شهرک غرب', 'address' => 'خیابان ایران‌زمین، پلاک ۴۵', 'latitude' => 35.7623, 'longitude' => 51.3662],
            ['slug' => 'unclaimed-narmak-print', 'name' => 'چاپخانه نارمک', 'category' => 'چاپ و تبلیغات', 'neighborhood' => 'نارمک', 'address' => 'میدان هلال احمر، خیابان گلبرگ', 'latitude' => 35.7456, 'longitude' => 51.4942],
            ['slug' => 'unclaimed-shahrara-tailor', 'name' => 'خیاطی شب‌بو', 'category' => 'خیاطی', 'neighborhood' => 'شهرآرا', 'address' => 'خیابان شهرآرا، نبش کوچه زرتشت', 'latitude' => 35.7159, 'longitude' => 51.3791],
            ['slug' => 'unclaimed-jannatabad-cafe', 'name' => 'کافه کرانه', 'category' => 'کافه', 'neighborhood' => 'جنت‌آباد', 'address' => 'بلوار میرزا بابایی، خیابان نورانی', 'latitude' => 35.7551, 'longitude' => 51.3061],
            ['slug' => 'unclaimed-sattarkhan-electric', 'name' => 'تأسیسات برقی رستگار', 'category' => 'تأسیسات', 'neighborhood' => 'ستارخان', 'address' => 'خیابان ستارخان، کوچه حسینی', 'latitude' => 35.7194, 'longitude' => 51.3568],
            ['slug' => 'unclaimed-elnaz-gym', 'name' => 'باشگاه تناسب آرمان', 'category' => 'ورزشی', 'neighborhood' => 'تهرانپارس', 'address' => 'فلکه اول تهرانپارس، خیابان جشنواره', 'latitude' => 35.7358, 'longitude' => 51.5298],
            ['slug' => 'unclaimed-gholhak-pharmacy', 'name' => 'داروخانه دکتر بهنام', 'category' => 'داروخانه', 'neighborhood' => 'قلهک', 'address' => 'خیابان شریعتی، بالاتر از سه‌راه قلهک', 'latitude' => 35.7765, 'longitude' => 51.4352],
            ['slug' => 'unclaimed-saadatabad-carwash', 'name' => 'کارواش نازی‌آباد نو', 'category' => 'خدمات خودرو', 'neighborhood' => 'سعادت‌آباد', 'address' => 'بلوار دریا، خیابان مهران', 'latitude' => 35.7823, 'longitude' => 51.3712],
            ['slug' => 'unclaimed-azarbaijan-carpet', 'name' => 'قالی‌فروشی آذربایجان', 'category' => 'قالی و فرش', 'neighborhood' => 'آزادگان', 'address' => 'خیابان آزادگان، روبه‌روی پارک آزادگان', 'latitude' => 35.6451, 'longitude' => 51.3871],
            ['slug' => 'unclaimed-haft-tir-mobile', 'name' => 'موبایل سنتر هفتم', 'category' => 'موبایل و لوازم', 'neighborhood' => 'هفت‌تیر', 'address' => 'خیابان مفتح جنوبی، پلاک ۸۸', 'latitude' => 35.7271, 'longitude' => 51.4278],
            ['slug' => 'unclaimed-damavand-restaurant', 'name' => 'رستوران سنتی دیباج', 'category' => 'رستوران', 'neighborhood' => 'پیروزی', 'address' => 'خیابان پیروزی، نبش خیابان بغدادی', 'latitude' => 35.7065, 'longitude' => 51.4789],
            ['slug' => 'unclaimed-yeida-optical', 'name' => 'اپتیک بینایی', 'category' => 'عینک و بینایی', 'neighborhood' => 'یوسف‌آباد', 'address' => 'خیابان اسدآبادی، پلاک ۳۳', 'latitude' => 35.7312, 'longitude' => 51.3968],
            ['slug' => 'unclaimed-kekilik-oil', 'name' => 'روغن‌کشی صنعتی راه‌آهن', 'category' => 'خدمات خودرو', 'neighborhood' => 'راه‌آهن', 'address' => 'خیابان شهید کاظمی، کیلومتر ۴ جاده قدیم کرج', 'latitude' => 35.6789, 'longitude' => 51.3374],
            ['slug' => 'unclaimed-mirdamad-book', 'name' => 'کتاب‌فروشی اندیشه میرداماد', 'category' => 'کتاب و لوازم‌التحریر', 'neighborhood' => 'میرداماد', 'address' => 'خیابان میرداماد، پلاک ۱۷۶', 'latitude' => 35.7659, 'longitude' => 51.4241],
            ['slug' => 'unclaimed-marzdaran-plumbing', 'name' => 'لوله‌کشی مرزداران', 'category' => 'خدمات ساختمان', 'neighborhood' => 'مرزداران', 'address' => 'بلوار مرزداران، خیابان شهید فرحزادی', 'latitude' => 35.7389, 'longitude' => 51.3498],
            ['slug' => 'unclaimed-piroozi-carpentry', 'name' => 'نجاری و دکور آهنگر', 'category' => 'خدمات ساختمان', 'neighborhood' => 'نازی‌آباد', 'address' => 'میدان نازی‌آباد، خیابان عبدل آباد', 'latitude' => 35.6653, 'longitude' => 51.3991],
            ['slug' => 'unclaimed-dolatabad-fruits', 'name' => 'میوه‌فروشی بهاران', 'category' => 'خواربار', 'neighborhood' => 'دولت‌آباد', 'address' => 'خیابان ۱۵ متری دولت‌آباد', 'latitude' => 35.6798, 'longitude' => 51.4628],
            ['slug' => 'unclaimed-shahran-laundry', 'name' => 'خشکشویی آبان', 'category' => 'خشکشویی', 'neighborhood' => 'شهران', 'address' => 'شهران، بلوار خرمشهر', 'latitude' => 35.7748, 'longitude' => 51.2908],
            ['slug' => 'unclaimed-pasdaran-sweets', 'name' => 'شیرینی‌فروشی رزتا', 'category' => 'شیرینی و کیک', 'neighborhood' => 'پاسداران', 'address' => 'خیابان پاسداران، نبش گلستان پنجم', 'latitude' => 35.7817, 'longitude' => 51.4648],
            ['slug' => 'unclaimed-jomhoori-stationery', 'name' => 'لوازم‌التحریر جمهوری', 'category' => 'کتاب و لوازم‌التحریر', 'neighborhood' => 'جمهوری', 'address' => 'خیابان جمهوری، پاساژ تهران', 'latitude' => 35.6993, 'longitude' => 51.3978],
            ['slug' => 'unclaimed-afsarieh-dentist', 'name' => 'کلینیک دندانپزشکی لبخند', 'category' => 'پزشکی', 'neighborhood' => 'افسریه', 'address' => 'خیابان ۱۵ متری اول افسریه', 'latitude' => 35.6537, 'longitude' => 51.4873],
            ['slug' => 'unclaimed-varamin-gate-mobile', 'name' => 'تعمیرات موبایل مهر', 'category' => 'موبایل و لوازم', 'neighborhood' => 'مسعودیه', 'address' => 'خیابان مسعودیه، پلاک ۵۹', 'latitude' => 35.6941, 'longitude' => 51.3598],
            ['slug' => 'unclaimed-niavaran-painting', 'name' => 'خدمات نقاشی ساختمان نیاوران', 'category' => 'خدمات ساختمان', 'neighborhood' => 'نیاوران', 'address' => 'خیابان نیاوران، کوچه سند', 'latitude' => 35.8168, 'longitude' => 51.4708],
            ['slug' => 'unclaimed-shademan-bakery', 'name' => 'شیرینی‌پزی شادمان', 'category' => 'شیرینی و کیک', 'neighborhood' => 'آریاشهر', 'address' => 'شهرک آریاشهر، فاز ۳', 'latitude' => 35.7442, 'longitude' => 51.3089],
            ['slug' => 'unclaimed-emam-hossein-scr', 'name' => 'خدمات کامپیوتر صفه', 'category' => 'کامپیوتر وIT', 'neighborhood' => 'امام حسین', 'address' => 'میدان امام حسین، خیابان مجاهدین اسلام', 'latitude' => 35.7013, 'longitude' => 51.4429],
            ['slug' => 'unclaimed-zhaleh-greenery', 'name' => 'گل‌فروشی ژاله', 'category' => 'گل و گیاه', 'neighborhood' => 'سهروردی', 'address' => 'خیابان شهید بهشتی، نرسیده به پارک ژاله', 'latitude' => 35.7218, 'longitude' => 51.4189],
            ['slug' => 'unclaimed-hamadan-mat', 'name' => 'مبل و دکور حسینی', 'category' => 'مبلمان', 'neighborhood' => 'یافت‌آباد', 'address' => 'بلوار یافت‌آباد، نبش خیابان دادگر', 'latitude' => 35.6772, 'longitude' => 51.3428],
        ];
    }
}
