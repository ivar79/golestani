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
                // Full free entitlements + bigger quotas + layered-editor keys.
                // NOTE: every editor cap the UI mirrors MUST be spelled out here —
                // a missing key falls through to the free-tier default, which is
                // exactly how the first seeder accidentally kept professional
                // plans on the free layer cap.
                'features' => [
                    'card_editor' => true,
                    'custom_templates' => false,
                    // Starter: legacy keys + the starter/modern layered ids.
                    'card_templates' => ['classic', 'local', 'midnight', 'starter-modern-dark-gradient', 'starter-emerald-executive', 'starter-creative-diagonal', 'starter-tech-developer', 'starter-medical-health', 'starter-real-estate-gold', 'free-classic-navy', 'free-minimal-white', 'free-local-shop'],
                    'card_themes' => ['navy', 'emerald', 'warm'],
                    'card_fonts' => ['sans', 'vazir'],
                    'card_exports' => ['png', 'jpg'],
                    'print_file' => false,
                    'card_layer_kinds' => ['text', 'image', 'qr', 'badge', 'shape', 'path'],
                    'card_premium_layer_kinds' => [],
                    'max_layers' => 30,
                    'max_premium_elements' => null,
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
                    'custom_templates' => true,
                    // Professional: everything — legacy keys + ALL layered
                    // catalog ids (the full gallery), kept explicit so the
                    // snapshot contract stays auditable.
                    'card_templates' => ['classic', 'local', 'midnight', 'emerald', 'creative', 'pro-persian-carpet-toranj', 'pro-persian-architecture-gereh', 'pro-laser-cut-walnut-wood', 'pro-gol-o-morgh-miniature', 'pro-gold-foil-embossed', 'pro-marble-stone-gold', 'starter-modern-dark-gradient', 'starter-emerald-executive', 'starter-creative-diagonal', 'starter-tech-developer', 'starter-medical-health', 'starter-real-estate-gold', 'free-classic-navy', 'free-minimal-white', 'free-local-shop'],
                    'card_themes' => ['navy', 'emerald', 'warm'],
                    'card_fonts' => ['sans', 'vazir', 'serif'],
                    // Full export freedom — the vector upgrade's SVG/PDF formats
                    // belong to the tier that pays for the full studio.
                    'card_exports' => ['png', 'jpg', 'svg', 'pdf'],
                    'print_file' => true,
                    // null = UNLIMITED (FeatureGate::limit contract). The free
                    // structural validator cap (120) remains the only bound —
                    // it is a security cap, not a plan quota.
                    'max_layers' => null,
                    'card_layer_kinds' => ['text', 'image', 'qr', 'badge', 'shape', 'path'],
                    'card_premium_layer_kinds' => [],
                    'max_premium_elements' => null,
                    'max_cards' => null,
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
