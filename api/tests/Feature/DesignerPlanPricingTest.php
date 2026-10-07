<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\User;
use App\Services\FeatureGate;
use Database\Seeders\EditorPlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Designer/business plan separation, tier limits and the admin surface.
 *
 * Plan categorization is CAPABILITY-based, never slug-based:
 * `designer_studio` marks designer tiers and `custom_templates` is separately
 * tiered. The Admin Panel can reprice/retune/create plans through the
 * catalog-validated endpoints.
 */
class DesignerPlanPricingTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->unique()->numerify('#########'), 'is_active' => true]);
        $user->assignRole('admin');

        return $user;
    }

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->unique()->numerify('#########'), 'is_active' => true]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function designerPlan(): Plan
    {
        $this->seed(EditorPlanSeeder::class);

        return Plan::where('slug', 'designer-pro')->firstOrFail();
    }

    private function business(): Business
    {
        $owner = $this->owner();

        return $owner->businesses()->create([
            'name' => 'کسب‌وکار آزمایشی',
            'slug' => 'designer-plan-'.fake()->unique()->numerify('####'),
            'status' => 'approved',
        ]);
    }

    public function test_seeder_ships_regular_plans_without_studio_and_three_limited_designer_tiers(): void
    {
        $plan = $this->designerPlan();

        $this->assertGreaterThan(0, $plan->price);
        $this->assertSame('IRR', $plan->currency);
        $this->assertTrue((bool) ($plan->features['designer_studio'] ?? false));
        $this->assertTrue((bool) ($plan->features['custom_templates'] ?? false));
        $this->assertNotEmpty($plan->features['card_templates'] ?? []);
        $this->assertTrue($plan->is_active);
        $this->assertTrue($plan->is_public);
        // Stored price is Toman; the gateway unit is Rial (the only ×10).
        $this->assertSame($plan->price * 10, $plan->priceRial());

        foreach (['starter', 'professional'] as $slug) {
            $businessPlan = Plan::where('slug', $slug)->firstOrFail();
            $this->assertTrue((bool) ($businessPlan->features['card_editor'] ?? false));
            $this->assertFalse((bool) ($businessPlan->features['designer_studio'] ?? false));
            $this->assertFalse((bool) ($businessPlan->features['custom_templates'] ?? false));
        }

        $tiers = collect(['designer-starter', 'designer-pro', 'designer-studio'])
            ->map(fn (string $slug) => Plan::where('slug', $slug)->firstOrFail())
            ->values();
        $this->assertSame([20, 50, 100], $tiers->map(fn (Plan $tier) => $tier->features['max_layers'])->all());
        $this->assertSame([1, 3, 10], $tiers->map(fn (Plan $tier) => $tier->features['max_cards'])->all());
        $this->assertSame([true, true, true], $tiers->map(fn (Plan $tier) => $tier->features['designer_studio'])->all());
        $this->assertSame([false, true, true], $tiers->map(fn (Plan $tier) => $tier->features['custom_templates'])->all());
    }

    public function test_public_pricing_endpoint_shows_designer_plans_only_to_approved_designers(): void
    {
        $plan = $this->designerPlan();

        $response = $this->getJson('/api/plans')->assertOk();
        $publicPlans = collect($response->json('plans'));
        $this->assertNotNull($publicPlans->firstWhere('slug', 'professional'));
        $this->assertNull($publicPlans->firstWhere('slug', 'designer-pro'));

        $owner = $this->owner();
        $ownerResponse = $this->actingAs($owner)->getJson('/api/plans')->assertOk();
        $this->assertNull(collect($ownerResponse->json('plans'))->firstWhere('slug', 'designer-pro'));

        $designer = User::factory()->create([
            'phone' => '09'.fake()->unique()->numerify('#########'),
            'is_active' => true,
            'designer_status' => 'approved',
        ]);
        $designer->assignRole('designer');
        $response = $this->actingAs($designer)->getJson('/api/plans')->assertOk();
        $row = collect($response->json('plans'))->firstWhere('slug', 'designer-pro');

        $this->assertNotNull($row);
        $this->assertSame($plan->price, $row['price']);
        $this->assertTrue((bool) $row['features']['designer_studio']);
        $this->assertSame('designer', $row['audience']);
        // The pricing page renders labels from the SERVER catalog — the studio
        // capability must be advertised there (never hardcoded in the frontend).
        $this->assertArrayHasKey('designer_studio', $response->json('labels'));
    }

    public function test_reseeding_does_not_overwrite_admin_managed_plan_name_price_or_features(): void
    {
        $plan = $this->designerPlan();
        $plan->update([
            'name' => 'نام تنظیم‌شده در پنل',
            'price' => 555000,
            'features' => array_merge($plan->features, ['max_layers' => 42]),
        ]);

        $this->seed(EditorPlanSeeder::class);

        $plan->refresh();
        $this->assertSame('نام تنظیم‌شده در پنل', $plan->name);
        $this->assertSame(555000, $plan->price);
        $this->assertSame(42, $plan->features['max_layers']);
    }

    public function test_only_approved_designers_can_purchase_designer_plans_but_business_users_keep_regular_plans(): void
    {
        $this->designerPlan();
        $business = $this->business();
        $owner = $business->owner;
        $designerPlan = Plan::where('slug', 'designer-starter')->firstOrFail();
        $businessPlan = Plan::where('slug', 'professional')->firstOrFail();

        $this->actingAs($owner)
            ->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $designerPlan->id])
            ->assertForbidden();
        $this->actingAs($owner)
            ->postJson("/api/businesses/{$business->id}/subscriptions", ['plan_id' => $designerPlan->id])
            ->assertForbidden();
        $this->assertDatabaseCount('payment_transactions', 0);

        $this->actingAs($owner)
            ->postJson("/api/businesses/{$business->id}/subscriptions", ['plan_id' => $businessPlan->id])
            ->assertCreated();
    }

    public function test_approved_designer_can_request_their_business_scoped_designer_plan(): void
    {
        $this->designerPlan();
        $business = $this->business();
        $designer = User::factory()->create([
            'phone' => '09'.fake()->unique()->numerify('#########'),
            'is_active' => true,
            'designer_status' => 'approved',
        ]);
        $designer->assignRole('designer');
        $business->update(['user_id' => $designer->id]);
        Http::fake([
            'sandbox.zarinpal.com/pg/v4/payment/request.json' => Http::response([
                'data' => ['authority' => 'S'.str_repeat('1', 24), 'code' => 100],
                'errors' => [],
            ]),
        ]);

        $this->actingAs($designer)
            ->postJson("/api/businesses/{$business->id}/payments/init", [
                'plan_id' => Plan::where('slug', 'designer-starter')->firstOrFail()->id,
            ])
            ->assertCreated();

        $this->actingAs($designer)
            ->postJson("/api/businesses/{$business->id}/subscriptions", [
                'plan_id' => Plan::where('slug', 'designer-starter')->firstOrFail()->id,
            ])
            ->assertCreated();
    }

    public function test_designer_role_without_approved_status_cannot_purchase_a_designer_plan(): void
    {
        $this->designerPlan();
        $business = $this->business();
        $owner = $business->owner;
        $owner->forceFill(['designer_status' => 'pending'])->save();
        $owner->assignRole('designer');

        $this->actingAs($owner)
            ->postJson("/api/businesses/{$business->id}/subscriptions", [
                'plan_id' => Plan::where('slug', 'designer-starter')->firstOrFail()->id,
            ])
            ->assertForbidden();
    }

    public function test_admin_can_reprice_the_designer_plan_from_the_panel_contract(): void
    {
        $plan = $this->designerPlan();
        $admin = $this->admin();

        // The admin plans table payload shows the seeded price.
        $row = collect($this->actingAs($admin)->getJson('/api/admin/plans')->assertOk()->json())
            ->firstWhere('slug', 'designer-pro');
        $this->assertNotNull($row);
        $this->assertSame($plan->price, $row['price']);

        // Repricing — exactly what the edit form submits.
        $this->actingAs($admin)
            ->putJson("/api/admin/plans/{$plan->id}", ['name' => 'طراح حرفه‌ای ویرایش‌شده', 'price' => 499000])
            ->assertOk()
            ->assertJsonPath('name', 'طراح حرفه‌ای ویرایش‌شده')
            ->assertJsonPath('price', 499000);

        $this->assertDatabaseHas('plans', ['id' => $plan->id, 'name' => 'طراح حرفه‌ای ویرایش‌شده', 'price' => 499000]);
    }

    public function test_admin_can_retune_the_designer_capabilities(): void
    {
        $plan = $this->designerPlan();
        $admin = $this->admin();

        $this->actingAs($admin)
            ->putJson("/api/admin/plans/{$plan->id}", [
                'features' => array_merge($plan->features, ['designer_studio' => false]),
            ])
            ->assertOk()
            ->assertJsonPath('features.designer_studio', false);

        $this->assertFalse((bool) $plan->fresh()->features['designer_studio']);
    }

    public function test_admin_can_create_a_new_designer_plan_with_the_capability(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/admin/plans', [
            'name' => 'طراح پلاس',
            'price' => 599000,
            'duration_days' => 30,
            'features' => ['designer_studio' => true, 'custom_templates' => true],
        ])->assertCreated();

        $created = Plan::where('name', 'طراح پلاس')->firstOrFail();
        $this->assertTrue((bool) $created->features['designer_studio']);
        $this->assertSame(599000, $created->price);
    }

    public function test_subscribing_a_business_to_the_designer_plan_grants_the_studio_capability(): void
    {
        $plan = $this->designerPlan();
        $owner = $this->owner();
        $owner->forceFill(['designer_status' => 'approved'])->save();
        $owner->assignRole('designer');
        $business = $owner->businesses()->create(['name' => 'دیزاین', 'slug' => 'designer-plan-biz', 'status' => 'approved']);

        // Real activation flow: the admin approves → snapshot is written.
        $subscription = $business->subscriptions()->create(['plan_id' => $plan->id, 'status' => 'pending_receipt']);
        $this->actingAs($this->admin())
            ->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])
            ->assertOk();

        $gate = app(FeatureGate::class);
        $this->assertTrue($gate->allows($business, 'designer_studio'));
        $this->assertTrue($gate->allows($business, 'custom_templates'));
    }

    public function test_non_admin_cannot_manage_or_reprice_plans(): void
    {
        $plan = $this->designerPlan();
        $owner = $this->owner();

        $this->actingAs($owner)
            ->putJson("/api/admin/plans/{$plan->id}", ['price' => 1])
            ->assertForbidden();

        $this->actingAs($owner)
            ->postJson('/api/admin/plans', ['name' => 'x', 'price' => 1, 'duration_days' => 30])
            ->assertForbidden();

        $this->assertSame($plan->price, $plan->fresh()->price);
    }
}
