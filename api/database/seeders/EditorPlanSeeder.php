<?php

namespace Database\Seeders;

use App\Models\Plan;
use Illuminate\Database\Seeder;

/**
 * Example plan catalog — DEMO/EXAMPLE values only.
 *
 * These rows are STARTING POINTS for the admin, not business decisions made
 * in code. The site admin can rename, reprice, re-limit, reorder, or delete
 * them from the Admin Panel — prices and entitlements here are placeholders
 * and MUST be replaced by real business values (see
 * docs/SUBSCRIPTION_ARCHITECTURE.md § N "Business decisions required").
 *
 * Adding more tiers later (Business, Enterprise, Gold, …) = creating new
 * plan rows in the Admin Panel. No code changes.
 */
class EditorPlanSeeder extends Seeder
{
    public function run(): void
    {
        $plans = [
            [
                'name' => 'استارتر',
                'slug' => 'starter',
                'description' => 'برای کسب‌وکارهای کوچک که شروع می‌کنند.',
                'price' => 99000,
                'currency' => 'IRR',
                'duration_days' => 30,
                'sort_order' => 1,
                // Difficulty LEVEL, not billing period: plans sharing a tier are
                // durations/SKUs of the same level, so re-buying one is a
                // RENEWAL rather than an upgrade. Without it the payment
                // classifier has to fall back to comparing prices.
                'tier' => 1,
                'is_public' => true,
                'is_featured' => false,
                'is_active' => true,
                // Full free entitlements + bigger quotas.
                'features' => [
                    'card_editor' => true,
                    'card_templates' => ['classic', 'local', 'midnight'],
                    'card_themes' => ['navy', 'emerald', 'warm'],
                    'card_fonts' => ['sans', 'vazir'],
                    'card_exports' => ['png', 'jpg'],
                    'print_file' => false,
                    'max_cards' => 3,
                    'max_showcases' => 3,
                    'max_ads' => 0,
                    'showcase' => true,
                    'ads' => false,
                ],
            ],
            [
                'name' => 'حرفه‌ای',
                'slug' => 'professional',
                'description' => 'تمام امکانات کارت‌ساز و بازاریابی برای رشد.',
                'price' => 249000,
                'currency' => 'IRR',
                'duration_days' => 30,
                'sort_order' => 2,
                'tier' => 2,
                'is_public' => true,
                'is_featured' => true,
                'is_active' => true,
                'features' => [
                    'card_editor' => true,
                    'card_templates' => ['classic', 'local', 'midnight', 'emerald', 'creative'],
                    'card_themes' => ['navy', 'emerald', 'warm'],
                    'card_fonts' => ['sans', 'vazir', 'serif'],
                    'card_exports' => ['png', 'jpg'],
                    'print_file' => true,
                    'max_cards' => 10,
                    'max_showcases' => 10,
                    'max_ads' => 2,
                    'showcase' => true,
                    'ads' => true,
                ],
            ],
        ];

        foreach ($plans as $plan) {
            Plan::updateOrCreate(['slug' => $plan['slug']], $plan);
        }
    }
}
