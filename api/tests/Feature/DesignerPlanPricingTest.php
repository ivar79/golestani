<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\User;
use App\Services\FeatureGate;
use Database\Seeders\EditorPlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The example DESIGNER plan (slug `designer-pro`) and its admin surface.
 *
 * The plan is CAPABILITY-based, never slug-based: `designer_studio` +
 * `custom_templates` are what make it a designer plan, it carries a real
 * starting price, and the Admin Panel can reprice/retune/create it through the
 * catalog-validated plan endpoints (the panel editor renders itself from the
 * entitlement catalog).
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

    public function test_seeder_ships_a_priced_designer_plan_with_the_studio_capabilities(): void
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
    }

    public function test_public_pricing_endpoint_lists_the_priced_designer_plan(): void
    {
        $plan = $this->designerPlan();

        $response = $this->getJson('/api/plans')->assertOk();
        $row = collect($response->json('plans'))->firstWhere('slug', 'designer-pro');

        $this->assertNotNull($row);
        $this->assertSame($plan->price, $row['price']);
        $this->assertTrue((bool) $row['features']['designer_studio']);
        // The pricing page renders labels from the SERVER catalog — the studio
        // capability must be advertised there (never hardcoded in the frontend).
        $this->assertArrayHasKey('designer_studio', $response->json('labels'));
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
            ->putJson("/api/admin/plans/{$plan->id}", ['price' => 499000])
            ->assertOk()
            ->assertJsonPath('price', 499000);

        $this->assertDatabaseHas('plans', ['id' => $plan->id, 'price' => 499000]);
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
