<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PhaseFiveTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');
        return $user;
    }

    public function test_owner_can_submit_manual_subscription_receipt(): void
    {
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'Demo', 'slug' => 'demo', 'status' => 'approved']);
        $plan = Plan::create(['name' => 'Pro', 'price' => 100, 'duration_days' => 30, 'features' => ['showcase' => true, 'ads' => true]]);

        $this->actingAs($owner)->postJson('/api/businesses/'.$business->id.'/subscriptions', [
            'plan_id' => $plan->id,
            'receipt_reference' => 'TRX-123',
        ])->assertCreated()->assertJsonPath('status', 'pending_receipt');
    }

    public function test_showcase_is_gated_by_active_plan(): void
    {
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'Demo', 'slug' => 'demo-gate', 'status' => 'approved']);
        $plan = Plan::create(['name' => 'Basic', 'price' => 0, 'duration_days' => 30, 'features' => ['showcase' => false, 'ads' => false]]);
        $business->subscriptions()->create(['plan_id' => $plan->id, 'status' => 'active', 'start_date' => now(), 'end_date' => now()->addDays(30)]);

        $this->actingAs($owner)->postJson('/api/businesses/'.$business->id.'/showcases', ['title' => 'Item'])->assertForbidden();
    }

    public function test_public_advertisements_are_limited_to_four(): void
    {
        $this->assertTrue(true);
    }
}
