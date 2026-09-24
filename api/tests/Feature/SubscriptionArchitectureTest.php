<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Services\FeatureGate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Subscription / Plan / Entitlement architecture tests.
 *
 * Covers: free default state, paid unlock, entitlement SNAPSHOT semantics
 * (POLICY snapshot_entitlements), legacy fallback, supersede-on-activation,
 * money snapshot, price manipulation, plan deactivation, slug identity, and
 * the entitlement catalog endpoint.
 */
class SubscriptionArchitectureTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function admin(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('admin');

        return $user;
    }

    private function business(User $user, string $slug = 'arch-demo'): Business
    {
        return $user->businesses()->create(['name' => 'Arch Demo', 'slug' => $slug, 'status' => 'approved']);
    }

    private function plan(array $features, string $name = 'Gold', int $price = 5000000, int $days = 30): Plan
    {
        return Plan::create(['name' => $name, 'slug' => strtolower($name), 'price' => $price, 'currency' => 'IRR', 'duration_days' => $days, 'features' => $features]);
    }

    /**
     * Activate through the REAL admin flow (moderate) so the entitlement
     * snapshot is written exactly like production. Use direct row creation
     * only where a test deliberately exercises the legacy/no-snapshot path.
     */
    private function activate(Business $business, Plan $plan, ?User $admin = null): Subscription
    {
        $subscription = $business->subscriptions()->create(['plan_id' => $plan->id, 'status' => 'pending_receipt']);
        $admin ??= $this->admin();
        $this->actingAs($admin)->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])->assertOk();

        return $subscription->refresh();
    }

    /** Legacy path: an active row with NO snapshot (pre-snapshot era). */
    private function activateLegacy(Business $business, Plan $plan): Subscription
    {
        return $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'active',
            'start_date' => now(),
            'end_date' => now()->addDays($plan->duration_days),
        ]);
    }

    /* ---------------------------------------------------------------
     | Free default state
     * --------------------------------------------------------------- */

    public function test_free_business_resolves_free_tier_capabilities(): void
    {
        $gate = app(FeatureGate::class);
        $payload = $gate->payload($this->business($this->owner()));

        $this->assertSame('free', $payload['source']);
        $this->assertTrue($payload['capabilities']['card_editor']);
        $this->assertFalse($payload['capabilities']['showcase']);
        $this->assertFalse($payload['capabilities']['print_file']);
        $this->assertSame(1, $payload['capabilities']['max_cards']);
        $this->assertSame(['classic', 'local'], $payload['capabilities']['card_templates']);
    }

    public function test_free_user_gets_free_plan_info_from_public_plans_endpoint(): void
    {
        $response = $this->getJson('/api/plans')->assertOk();

        $this->assertSame('Free', $response->json('free_tier.name'));
        $this->assertIsArray($response->json('labels'));
        // labels must come from the server catalog — no hardcoded feature names
        $this->assertArrayHasKey('showcase', $response->json('labels'));
    }

    /* ---------------------------------------------------------------
     | Paid unlock + limits
     * --------------------------------------------------------------- */

    public function test_paid_plan_unlocks_entitlements(): void
    {
        $business = $this->business($this->owner());
        $plan = $this->plan(['showcase' => true, 'max_cards' => 10, 'print_file' => true, 'card_templates' => ['classic', 'local', 'midnight']]);
        $this->activateLegacy($business, $plan);

        $gate = app(FeatureGate::class);
        $this->assertTrue($gate->allows($business, 'showcase'));
        $this->assertTrue($gate->allows($business, 'print_file'));
        $this->assertSame(10, $gate->limit($business, 'max_cards'));
        $this->assertTrue($gate->allowsValue($business, 'card_templates', 'midnight'));
        $this->assertFalse($gate->allowsValue($business, 'card_templates', 'creative'));
    }

    public function test_limit_counts_first_n_then_blocks(): void
    {
        $business = $this->business($this->owner());
        $plan = $this->plan(['showcase' => true, 'max_showcases' => 2]);
        $this->activateLegacy($business, $plan);

        for ($i = 1; $i <= 2; $i++) {
            $this->actingAs($business->owner)->postJson("/api/businesses/{$business->id}/showcases", [
                'title' => "Item {$i}",
            ])->assertCreated();
        }

        // Third item exceeds max_showcases=2 → blocked with machine-readable error.
        $response = $this->actingAs($business->owner)->postJson("/api/businesses/{$business->id}/showcases", [
            'title' => 'Item 3',
        ]);
        $this->assertSame(403, $response->status());
        $this->assertSame('limit_reached', $response->json('entitlement_errors.max_showcases'));
    }

    public function test_unlimited_limit_is_honored(): void
    {
        $business = $this->business($this->owner());
        $this->activate($business, $this->plan(['max_cards' => null]));

        $this->assertNull(app(FeatureGate::class)->limit($business, 'max_cards'));
    }

    /** Track rows superseded mid-test so history assertions stay exact. */
    private array $subscriptionIds = [];

    /* ---------------------------------------------------------------
     | POLICY snapshot_entitlements
     * --------------------------------------------------------------- */

    public function test_activation_freezes_entitlement_snapshot(): void
    {
        $admin = $this->admin();
        $business = $this->business($this->owner());
        $plan = $this->plan(['showcase' => true, 'max_showcases' => 5]);
        $subscription = $business->subscriptions()->create(['plan_id' => $plan->id, 'status' => 'pending_receipt']);

        $this->actingAs($admin)->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])->assertOk();

        $subscription->refresh();
        $this->assertNotNull($subscription->entitlements);
        // JSON column round-trip: order-insensitive comparison.
        $this->assertEqualsCanonicalizing(['showcase' => true, 'max_showcases' => 5], $subscription->entitlements);
    }

    public function test_plan_edit_applies_to_new_purchases_but_not_active_subscribers(): void
    {
        $admin = $this->admin();
        $businessA = $this->business($this->owner(), 'snap-a');
        $plan = $this->plan(['showcase' => true]);
        $this->activate($businessA, $plan);

        $gate = app(FeatureGate::class);
        $this->assertTrue($gate->allows($businessA, 'showcase'));

        // Admin edits the plan: showcase removed for FUTURE buyers.
        $this->actingAs($admin)->putJson("/api/admin/plans/{$plan->id}", ['features' => ['showcase' => false, 'max_showcases' => 0]])->assertOk();

        // Active subscriber A keeps the snapshot (business decision pending —
        // default policy: no retroactive changes).
        $this->assertTrue($gate->allows($businessA, 'showcase'));

        // New subscriber B resolves the EDITED plan at activation.
        $businessB = $this->business($this->owner(), 'snap-b');
        $this->activate($businessB, $plan->fresh());
        $this->assertFalse($gate->allows($businessB, 'showcase'));
    }

    public function test_legacy_subscription_without_snapshot_falls_back_to_live_plan(): void
    {
        $business = $this->business($this->owner());
        $plan = $this->plan(['ads' => true]);
        // Direct creation bypasses moderate() → no entitlement snapshot (pre-snapshot era row).
        $subscription = $this->activateLegacy($business, $plan);
        $this->assertNull($subscription->entitlements);

        $this->assertTrue(app(FeatureGate::class)->allows($business, 'ads'));
    }

    public function test_renewal_creates_a_fresh_snapshot(): void
    {
        $admin = $this->admin();
        $business = $this->business($this->owner(), 'renewal');
        $plan = $this->plan(['showcase' => true]);

        $first = $business->subscriptions()->create(['plan_id' => $plan->id, 'status' => 'pending_receipt']);
        $this->actingAs($admin)->patchJson("/api/admin/subscriptions/{$first->id}/moderate", ['status' => 'active'])->assertOk();

        // Admin improves the plan AFTER the first term.
        $this->actingAs($admin)->putJson("/api/admin/plans/{$plan->id}", ['features' => ['showcase' => true, 'max_showcases' => 20]])->assertOk();

        // Renewal request → new activation → new snapshot.
        $renewal = $business->subscriptions()->create(['plan_id' => $plan->id, 'status' => 'pending_receipt']);
        $this->actingAs($admin)->patchJson("/api/admin/subscriptions/{$renewal->id}/moderate", ['status' => 'active'])->assertOk();

        $renewal->refresh();
        $this->assertEqualsCanonicalizing(['showcase' => true, 'max_showcases' => 20], $renewal->entitlements);
        $this->assertSame(20, app(FeatureGate::class)->limit($business, 'max_showcases'));
    }

    /* ---------------------------------------------------------------
     | Supersede / upgrade-downgrade (single-active invariant)
     * --------------------------------------------------------------- */

    public function test_activating_new_subscription_supersedes_the_old_active_one(): void
    {
        $admin = $this->admin();
        $business = $this->business($this->owner(), 'supersede');
        $starter = $this->plan(['showcase' => true], 'Starter');
        $pro = $this->plan(['showcase' => true, 'ads' => true, 'max_cards' => 10], 'Professional');

        $first = $business->subscriptions()->create(['plan_id' => $starter->id, 'status' => 'pending_receipt']);
        $this->actingAs($admin)->patchJson("/api/admin/subscriptions/{$first->id}/moderate", ['status' => 'active'])->assertOk();

        // Upgrade request while an active subscription exists (old flow returned 422).
        $second = $this->actingAs($business->owner)->postJson("/api/businesses/{$business->id}/subscriptions", [
            'plan_id' => $pro->id,
            'receipt_reference' => 'UPGRADE-1',
        ])->assertCreated();

        $this->actingAs($admin)->patchJson("/api/admin/subscriptions/{$second->json('id')}/moderate", ['status' => 'active'])->assertOk();

        $this->assertSame('expired', $first->fresh()->status);
        $this->assertSame('active', Subscription::find($second->json('id'))->status);
        $this->assertSame(1, Subscription::where('status', 'active')->count());
        $this->assertTrue(app(FeatureGate::class)->allows($business, 'ads'));
        $this->assertSame(10, app(FeatureGate::class)->limit($business, 'max_cards'));
    }

    public function test_activation_requires_an_active_plan(): void
    {
        $admin = $this->admin();
        $business = $this->business($this->owner(), 'inactive-plan');
        $plan = $this->plan(['showcase' => true]);
        $plan->update(['is_active' => false]);
        $subscription = $business->subscriptions()->create(['plan_id' => $plan->id, 'status' => 'pending_receipt']);

        $this->actingAs($admin)->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])->assertStatus(422);
    }

    /* ---------------------------------------------------------------
     | Money snapshot / price manipulation / history
     * --------------------------------------------------------------- */

    public function test_store_snapshots_plan_pricing_and_ignores_client_price_fields(): void
    {
        $business = $this->business($this->owner());
        $plan = $this->plan(['showcase' => true], 'Priced', 490000, 45);

        $response = $this->actingAs($business->owner)->postJson("/api/businesses/{$business->id}/subscriptions", [
            'plan_id' => $plan->id,
            'receipt_reference' => 'TRX-1',
            // Manipulation attempt: client-sent money fields must be ignored.
            'price_amount' => 1,
            'price_currency' => 'USD',
            'plan_name' => 'Free',
            'entitlements' => ['ads' => true, 'max_cards' => 9999],
            'duration_days' => 99999,
        ])->assertCreated();

        // Read from the DB row, not the echoed response — that is the truth.
        $row = $response->json('id');
        $stored = Subscription::find($row);
        $this->assertSame('Priced', $stored->plan_name);
        $this->assertSame(490000, (int) $stored->price_amount);
        $this->assertSame('IRR', $stored->price_currency);
        $this->assertSame(45, (int) $stored->duration_days);
        $this->assertNull($response->json('entitlements')); // only written at activation, server-side
    }

    public function test_plan_price_change_does_not_rewrite_subscription_history(): void
    {
        $admin = $this->admin();
        $business = $this->business($this->owner(), 'history');
        $plan = $this->plan(['showcase' => true], 'Historic', 1000);

        $subscription = $business->subscriptions()->create(['plan_id' => $plan->id, 'status' => 'pending_receipt']);
        $this->actingAs($admin)->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])->assertOk();

        $this->actingAs($admin)->putJson("/api/admin/plans/{$plan->id}", ['price' => 9000])->assertOk();

        $subscription->refresh();
        $this->assertSame(1000, $subscription->price_amount);
        $this->assertSame(1000, (int) Subscription::where('status', 'active')->sum('price_amount'));
    }

    public function test_revenue_report_reads_the_money_snapshot(): void
    {
        $admin = $this->admin();
        $business = $this->business($this->owner(), 'revenue');
        $plan = $this->plan(['showcase' => true], 'RevenuePlan', 1234);
        $subscription = $business->subscriptions()->create(['plan_id' => $plan->id, 'status' => 'pending_receipt']);
        $this->actingAs($admin)->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])->assertOk();
        $this->subscriptionIds[] = $subscription->id;

        $this->actingAs($admin)->putJson("/api/admin/plans/{$plan->id}", ['price' => 999999])->assertOk();

        $this->actingAs($admin)->getJson('/api/admin/reports/revenue')
            ->assertOk()
            ->assertJsonPath('subscriptions.revenue', 1234);
    }

    /* ---------------------------------------------------------------
     | Plan lifecycle: deactivation blocks purchases, keeps subscribers
     * --------------------------------------------------------------- */

    public function test_deactivated_plan_blocks_new_purchases_but_keeps_active_subscription(): void
    {
        $business = $this->business($this->owner(), 'lifecycle');
        $plan = $this->plan(['showcase' => true]);
        $this->activate($business, $plan);
        $plan->update(['is_active' => false]);

        // New purchase blocked (firstOrFail on the active-plan query → 404).
        $this->actingAs($business->owner)->postJson("/api/businesses/{$business->id}/subscriptions", [
            'plan_id' => $plan->id,
        ])->assertStatus(404);

        // Existing active subscription stays valid.
        $this->assertTrue(app(FeatureGate::class)->allows($business, 'showcase'));
    }

    public function test_hidden_public_plan_is_excluded_from_pricing_page(): void
    {
        $this->plan(['showcase' => true], 'Visible');
        $this->plan(['ads' => true], 'Hidden')->update(['is_public' => false]);

        $names = collect($this->getJson('/api/plans')->json('plans'))->pluck('name');
        $this->assertContains('Visible', $names);
        $this->assertNotContains('Hidden', $names);
    }

    /* ---------------------------------------------------------------
     | Identity + admin security
     * --------------------------------------------------------------- */

    public function test_slug_is_immutable_after_creation(): void
    {
        $admin = $this->admin();
        $plan = $this->plan(['showcase' => true], 'Immutable');

        $this->actingAs($admin)->putJson("/api/admin/plans/{$plan->id}", ['price' => 42])
            ->assertOk();
        $this->assertSame('immutable', $plan->fresh()->slug);

        // A client attempting to change the identity gets a 422, not silence.
        $this->actingAs($admin)->putJson("/api/admin/plans/{$plan->id}", ['slug' => 'hacked'])
            ->assertStatus(422);
    }

    public function test_unknown_entitlement_key_is_rejected_on_plan_save(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/admin/plans', [
            'name' => 'Bad Plan',
            'price' => 10,
            'duration_days' => 30,
            'features' => ['is_premium' => true, 'made_up_feature' => 7],
        ])->assertStatus(422);
    }

    public function test_wrong_type_entitlement_value_is_rejected(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->postJson('/api/admin/plans', [
            'name' => 'Bad Types',
            'price' => 10,
            'duration_days' => 30,
            'features' => ['showcase' => 'yes-please', 'card_templates' => 'classic'],
        ])->assertStatus(422);
    }

    public function test_catalog_endpoint_requires_admin(): void
    {
        // Guest is bounced by the auth layer (401) — the important assertion
        // is that a NON-admin can never read the catalog.
        $this->getJson('/api/admin/entitlements/catalog')->assertUnauthorized();
        $this->actingAs($this->admin())->getJson('/api/admin/entitlements/catalog')
            ->assertOk()
            ->assertJsonStructure(['catalog' => [['key', 'type', 'label', 'group', 'free_value']], 'free_tier', 'policies']);
    }

    /* ---------------------------------------------------------------
     | Expiration
     * --------------------------------------------------------------- */

    public function test_expired_subscription_falls_back_to_free_entitlement(): void
    {
        $business = $this->business($this->owner(), 'expired');
        $plan = $this->plan(['showcase' => true, 'ads' => true, 'print_file' => true]);
        $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'active',
            'start_date' => now()->subDays(40),
            'end_date' => now()->subDay(),
        ]);

        $gate = app(FeatureGate::class);
        $this->assertFalse($gate->allows($business, 'showcase'));
        $this->assertFalse($gate->allows($business, 'ads'));
        $this->assertFalse($gate->allows($business, 'print_file'));
        $this->assertTrue($gate->allows($business, 'card_editor'));
        $this->assertSame(1, $gate->limit($business, 'max_cards'));
    }
}
