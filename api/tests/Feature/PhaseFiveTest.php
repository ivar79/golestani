<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Advertisement;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
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

    public function test_owner_can_upload_a_valid_receipt_file(): void
    {
        Storage::fake('public');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'Receipt Demo', 'slug' => 'receipt-demo', 'status' => 'approved']);
        $plan = Plan::create(['name' => 'Receipt Plan', 'price' => 100, 'duration_days' => 30, 'features' => []]);

        $response = $this->actingAs($owner)->postJson('/api/businesses/'.$business->id.'/subscriptions', [
            'plan_id' => $plan->id,
            'receipt_reference' => 'TRX-FILE',
            'receipt' => UploadedFile::fake()->create('receipt.pdf', 100, 'application/pdf'),
        ])->assertCreated();

        $this->assertNotNull($response->json('receipt_path'));
        Storage::disk('public')->assertExists($response->json('receipt_path'));

        $this->actingAs($owner)->get('/api/subscriptions/'.$response->json('id').'/receipt')->assertOk();
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
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'Ad Business', 'slug' => 'ad-business', 'status' => 'approved']);

        foreach (range(1, 5) as $number) {
            Advertisement::create([
                'business_id' => $business->id,
                'slot' => 'homepage',
                'title' => 'Ad '.$number,
                'target_url' => 'https://example.com/'.$number,
                'status' => 'approved',
                'starts_at' => now()->subDay(),
                'ends_at' => now()->addDay(),
            ]);
        }

        $this->getJson('/api/public/advertisements/homepage')
            ->assertOk()
            ->assertJsonCount(4);
    }

    public function test_expired_subscription_cannot_create_advertisement(): void
    {
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'Demo', 'slug' => 'expired-ad', 'status' => 'approved']);
        $plan = Plan::create(['name' => 'Ads', 'price' => 100, 'duration_days' => 30, 'features' => ['ads' => true]]);

        Subscription::create([
            'business_id' => $business->id,
            'plan_id' => $plan->id,
            'status' => 'active',
            'start_date' => now()->subDays(31),
            'end_date' => now()->subDay(),
        ]);

        $this->actingAs($owner)->postJson('/api/businesses/'.$business->id.'/advertisements', [
            'slot' => 'homepage',
            'title' => 'Expired',
            'target_url' => 'https://example.com',
        ])->assertForbidden();
    }

    public function test_admin_approval_sets_subscription_dates(): void
    {
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'Demo', 'slug' => 'approval-demo', 'status' => 'approved']);
        $plan = Plan::create(['name' => 'Pro', 'price' => 100, 'duration_days' => 30, 'features' => []]);
        $subscription = $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'pending_receipt',
            'receipt_reference' => 'TRX-456',
        ]);
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');

        $this->actingAs($admin)->patchJson('/api/admin/subscriptions/'.$subscription->id.'/moderate', [
            'status' => 'active',
        ])->assertOk()->assertJsonPath('status', 'active');

        $subscription->refresh();
        $this->assertSame(now()->toDateString(), $subscription->start_date->toDateString());
        $this->assertSame(now()->addDays(30)->toDateString(), $subscription->end_date->toDateString());
        $this->assertDatabaseHas('internal_notifications', [
            'user_id' => $owner->id,
            'type' => 'subscription_active',
            'related_id' => $subscription->id,
        ]);
    }

    public function test_expiry_command_marks_subscription_and_notifies_owner(): void
    {
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'Expiry Demo', 'slug' => 'expiry-demo', 'status' => 'approved']);
        $plan = Plan::create(['name' => 'Expiry Plan', 'price' => 100, 'duration_days' => 30, 'features' => ['ads' => true]]);
        $subscription = $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'active',
            'start_date' => now()->subDays(31),
            'end_date' => now()->subDay(),
        ]);

        $this->artisan('subscriptions:expire')->assertSuccessful();

        $this->assertDatabaseHas('subscriptions', ['id' => $subscription->id, 'status' => 'expired']);
        $this->assertDatabaseHas('internal_notifications', [
            'user_id' => $owner->id,
            'type' => 'subscription_expired',
            'related_id' => $subscription->id,
        ]);
    }

    public function test_owner_can_read_and_mark_notifications_as_read(): void
    {
        $owner = $this->owner();
        $notification = \App\Models\InternalNotification::create([
            'user_id' => $owner->id,
            'type' => 'subscription_expired',
            'title' => 'Expired',
            'message' => 'Expired subscription',
        ]);

        $this->actingAs($owner)->getJson('/api/notifications')->assertOk()->assertJsonCount(1);
        $this->actingAs($owner)->patchJson('/api/notifications/'.$notification->id.'/read')
            ->assertOk()->assertJsonPath('id', $notification->id);
        $this->assertNotNull($notification->fresh()->read_at);
    }

    public function test_admin_revenue_report_contains_subscription_and_designer_data(): void
    {
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');

        $this->actingAs($admin)->getJson('/api/admin/reports/revenue')
            ->assertOk()
            ->assertJsonStructure(['subscriptions' => ['total', 'pending', 'active', 'revenue'], 'designer_attribution']);
    }

    public function test_admin_can_manage_plans_but_cannot_delete_used_plan(): void
    {
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');

        $response = $this->actingAs($admin)->postJson('/api/admin/plans', [
            'name' => 'Managed Pro',
            'price' => 250,
            'duration_days' => 45,
            'features' => ['showcase' => true, 'ads' => false],
        ])->assertCreated();

        $planId = $response->json('id');
        $this->actingAs($admin)->putJson('/api/admin/plans/'.$planId, ['is_active' => false])
            ->assertOk()->assertJsonPath('is_active', false);

        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'Plan User', 'slug' => 'plan-user', 'status' => 'approved']);
        $business->subscriptions()->create(['plan_id' => $planId, 'status' => 'rejected']);
        $this->actingAs($admin)->deleteJson('/api/admin/plans/'.$planId)->assertStatus(422);

        $unusedPlan = Plan::create(['name' => 'Unused', 'price' => 0, 'duration_days' => 1, 'features' => []]);
        $this->actingAs($admin)->deleteJson('/api/admin/plans/'.$unusedPlan->id)->assertOk();
    }
}
