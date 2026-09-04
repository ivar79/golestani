<?php

namespace Database\Seeders;

use App\Models\SiteSetting;
use Illuminate\Database\Seeder;

/**
 * Seeds the default homepage CMS content from the design reference
 * (docs/design/homepage/code.html). Every value is stored in the CMS
 * `site_settings` table so components read from the DB, never hardcoded.
 */
class HomepageSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            'homepage.brand' => 'اینکارت',
            'homepage.logo' => null,
            'homepage.header.login' => 'ورود / ثبت‌نام',
            'homepage.nav.features' => 'ویژگی‌ها',
            'homepage.nav.showcase' => 'نمونه کارها',
            'homepage.nav.about' => 'درباره ما',
            'homepage.nav.contact' => 'تماس با ما',

            'homepage.hero.badges' => 'هوشمندترین راه برای معرفی شما',
            'homepage.hero.title' => 'بانک مشاغل و کارت ویزیت‌های دیجیتال ایران',
            'homepage.hero.title_accent' => 'مشاغل',
            'homepage.hero.subtitle' => 'با اینکارت، کسب‌وکار خود را به دنیای دیجیتال متصل کنید. لینک اختصاصی، کد QR و مدیریت هوشمند مخاطبان، همه در یک پلتفرم حرفه‌ای.',
            'homepage.hero.button_primary' => 'شروع رایگان',
            'homepage.hero.button_primary_link' => '/login',
            'homepage.hero.button_secondary' => 'مشاهده دمو',
            'homepage.hero.button_secondary_link' => '/demo',
            'homepage.hero.image' => '/assets/hero-2.jpg',
            'homepage.hero.background' => '/assets/hero-1.jpg',

            'homepage.feature.1.icon' => 'contactPage',
            'homepage.feature.1.title' => 'معرفی حرفه‌ای کسب‌وکار',
            'homepage.feature.1.description' => 'صفحه اختصاصی و لینک اختصاصی برای معرفی کسب‌وکار، خدمات، اطلاعات تماس.',
            'homepage.feature.2.icon' => 'qrScanner',
            'homepage.feature.2.title' => 'کارت ویزیت دیجیتال هوشمند',
            'homepage.feature.2.description' => 'کارت دیجیتال، QR Code، ذخیره مخاطب، مسیریابی شبکه‌های اجتماعی و بیشتر.',
            'homepage.feature.3.icon' => 'search',
            'homepage.feature.3.title' => 'دیده شدن در جستجو',
            'homepage.feature.3.description' => 'در نتایج جستجو و نقشه‌ها دیده شوید و مشتریان جدید را جذب کنید.',

            'homepage.showcase.title' => 'نمونه کارت‌های دیجیتال',
            'homepage.showcase.subtitle' => 'ببینید کاربران اینکارت چطور برند خود را می‌سازند.',
            'homepage.showcase.link' => 'مشاهده همه',
            'homepage.showcase.link_href' => '/search',
            'homepage.showcase.cards' => json_encode([
                ['title' => 'کلینیک دندان‌پزشکی', 'subtitle' => 'دکتر حمید هاشمی'],
                ['title' => 'کافه رستوران نت', 'subtitle' => 'خوشمزه و بی‌نظیر'],
                ['title' => 'گروه طراحی وب', 'subtitle' => 'خلاقیت در طراحی'],
            ], JSON_UNESCAPED_UNICODE),

            'homepage.howitworks.title' => 'چطور کار می‌کند؟',
            'homepage.howitworks.steps' => json_encode([
                ['icon' => 'storefront', 'title' => 'ثبت کسب‌وکار', 'description' => 'اطلاعات کسب‌وکار خود را ثبت کنید.'],
                ['icon' => 'badge', 'title' => 'ساخت کارت دیجیتال', 'description' => 'کارت و صفحه اختصاصی کسب‌وکار شما آماده می‌شود.'],
                ['icon' => 'groups', 'title' => 'دیده شدن و رشد', 'description' => 'مشتریان شما را پیدا می‌کنند و با شما ارتباط می‌گیرند.'],
            ], JSON_UNESCAPED_UNICODE),

            'homepage.cta.title' => 'کسب‌وکار شما، شایسته دیده شدن است',
            'homepage.cta.subtitle' => 'همین حالا رایگان شروع کنید و آینده دیجیتال کسب‌وکارتان را بسازید.',
            'homepage.cta.subtitle_accent' => 'رایگان شروع کنید',
            'homepage.cta.button_primary' => 'ثبت کسب‌وکار رایگان',
            'homepage.cta.button_primary_link' => '/login',
            'homepage.cta.button_secondary' => 'بیشتر بدانید',
            'homepage.cta.button_secondary_link' => '/about',

            'homepage.footer.about' => 'پلتفرم هوشمند کارت ویزیت دیجیتال برای کسب‌وکارهای مدرن ایرانی. برند خود را با اینکارت جهانی کنید.',
            'homepage.footer.links_title' => 'دسترسی سریع',
            'homepage.footer.links' => json_encode([
                ['label' => 'پشتیبانی', 'href' => '/contact'],
                ['label' => 'قوانین و مقررات', 'href' => '/privacy'],
                ['label' => 'سوالات متداول', 'href' => '/about'],
            ], JSON_UNESCAPED_UNICODE),
            'homepage.footer.socials_title' => 'شبکه‌های اجتماعی',
            'homepage.footer.socials' => json_encode([
                ['icon' => 'share', 'href' => '#', 'label' => 'Share'],
                ['icon' => 'at', 'href' => 'mailto:hello@inkart.ir', 'label' => 'Email'],
            ], JSON_UNESCAPED_UNICODE),
            'homepage.footer.copyright' => '© ۱۴۰۳ تمامی حقوق برای اینکارت محفوظ است.',

            // SEO (used by the homepage server component's generateMetadata)
            'seo.homepage' => json_encode([
                'title' => 'اینکارت | کارت ویزیت دیجیتال و معرفی کسب‌وکارها',
                'description' => 'با اینکارت، کسب‌وکار خود را به دنیای دیجیتال متصل کنید. لینک اختصاصی، کد QR و مدیریت هوشمند مخاطبان، همه در یک پلتفرم حرفه‌ای.',
            ], JSON_UNESCAPED_UNICODE),
        ];

        foreach ($rows as $key => $value) {
            SiteSetting::updateOrCreate(['key' => $key], ['value' => $value]);
        }
    }
}
