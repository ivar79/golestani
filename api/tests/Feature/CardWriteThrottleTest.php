<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Card-write throttling (P1 of the corrective plan).
 *
 *   - one SHARED per-user bucket (card-write) across the card save and the
 *     template-apply endpoints, so hopping between them cannot reset the
 *     quota;
 *   - a SEPARATE bucket (studio-authoring) for template authoring writes.
 *
 * Throttling is defense in depth only — it never replaces authorization or
 * validation (a throttled request would still have been authorized/validated
 * on the way in).
 */
class CardWriteThrottleTest extends TestCase
{
    use RefreshDatabase;

    private function business(): Business
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        $business = $owner->businesses()->create([
            'name' => 'کسب‌وکار throttle',
            'slug' => 'thr-'.fake()->unique()->regexify('[a-z0-9]{8}'),
            'category' => 'آز',
            'phone' => '09120000000',
            'status' => 'approved',
        ]);

        $plan = Plan::create([
            'name' => 'Throttle Plan',
            'price' => 100,
            'duration_days' => 30,
            'features' => ['card_editor' => true, 'max_cards' => 5],
        ]);

        $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'active',
            'start_date' => now(),
            'end_date' => now()->addDays(30),
        ]);

        return $business;
    }

    public function test_card_writes_are_rate_limited_per_user(): void
    {
        config(['studio.rate_limits.card_write' => 2]);
        $business = $this->business();
        $owner = $business->owner;

        for ($i = 0; $i < 2; $i++) {
            $this->actingAs($owner)
                ->putJson("/api/businesses/{$business->id}/card", ['template' => 'classic'])
                ->assertOk();
        }

        $this->actingAs($owner)
            ->putJson("/api/businesses/{$business->id}/card", ['template' => 'classic'])
            ->assertStatus(429);
    }

    public function test_save_and_template_apply_share_one_bucket(): void
    {
        config(['studio.rate_limits.card_write' => 1]);
        $business = $this->business();
        $owner = $business->owner;

        $this->actingAs($owner)
            ->putJson("/api/businesses/{$business->id}/card", ['template' => 'classic'])
            ->assertOk();

        // A second write on a DIFFERENT endpoint must consume the same bucket.
        $this->actingAs($owner)
            ->postJson("/api/businesses/{$business->id}/card/template-apply", [
                'source' => 'builtin',
                'template_id' => 'free-classic-navy',
            ])
            ->assertStatus(429);
    }

    public function test_authoring_writes_use_a_separate_bucket(): void
    {
        config(['studio.rate_limits.card_write' => 1, 'studio.rate_limits.studio_authoring' => 5]);
        $business = $this->business();
        $owner = $business->owner;

        $this->actingAs($owner)
            ->putJson("/api/businesses/{$business->id}/card", ['template' => 'classic'])
            ->assertOk();

        // The card bucket is now exhausted — but the authoring endpoint is not
        // throttled by it (it answers on its own entitlement boundary).
        $this->actingAs($owner)
            ->putJson("/api/businesses/{$business->id}/card", ['template' => 'classic'])
            ->assertStatus(429);

        $this->actingAs($owner)
            ->postJson('/api/my/templates', ['name_fa' => 'قالب', 'design_json' => []])
            ->assertStatus(403);
    }
}
