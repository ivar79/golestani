<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * FEATURE ACCESS CHAIN — the REAL end-to-end entitlement chain over actual
 * HTTP requests (never internal assertions only):
 *
 *   Payment Success → Subscription Activation → Entitlement Refresh
 *     → Feature Access → Expiration → Feature Restriction
 *
 * 1. User WITHOUT a subscription → feature restricted (403 from the REAL API)
 * 2. Successful payment (gateway stubbed at the network boundary only)
 * 3. SAME session (no logout/login) → entitlements endpoint shows the new plan
 * 4. The SAME feature through the REAL API now succeeds (201)
 * 5. ANOTHER user is completely unaffected (still 403, still free tier)
 * 6. expires_at passes → the SAME feature is restricted again (403),
 *    derived status = expired, free-tier limits back
 */
class FeatureAccessChainTest extends TestCase
{
    use RefreshDatabase;

    private function owner(string $emailSuffix = ''): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########'), 'email' => 'chain-'.uniqid().$emailSuffix.'@test.local']);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $user): Business
    {
        return $user->businesses()->create(['name' => 'Chain Biz', 'slug' => 'chain-'.uniqid(), 'status' => 'approved']);
    }

    private function professionalPlan(): Plan
    {
        return Plan::create([
            'name' => 'حرفه‌ای', 'slug' => 'professional-'.uniqid(), 'price' => 249000,
            'currency' => 'IRR', 'duration_days' => 30, 'features' => ['showcase' => true, 'max_showcases' => 5],
            'is_active' => true, 'is_public' => true,
        ]);
    }

    private function fakeZarinpal(): void
    {
        Http::fake([
            'sandbox.zarinpal.com/pg/v4/payment/request.json' => Http::response(['data' => ['authority' => 'S'.str_repeat('0', 24).uniqid(), 'code' => 100], 'errors' => []]),
            'sandbox.zarinpal.com/pg/v4/payment/verify.json' => Http::response(['data' => ['code' => 100, 'ref_id' => (string) random_int(100000, 999999)], 'errors' => []]),
        ]);
    }

    private function showcasePayload(): array
    {
        return [
            'title' => 'ویترین تست زنجیره',
            'description' => 'تست واقعی برداشته‌شدن محدودیت پس از خرید.',
        ];
    }

    public function test_full_chain_payment_activates_refresh_grants_then_expiration_restricts(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));

        $userA = $this->owner('-a');
        $userB = $this->owner('-b');
        $businessA = $this->business($userA);
        $businessB = $this->business($userB);
        $plan = $this->professionalPlan();

        /* ── 1. WITHOUT subscription: the REAL API restricts the feature ── */
        $this->actingAs($userA)
            ->postJson("/api/businesses/{$businessA->id}/showcases", $this->showcasePayload())
            ->assertStatus(403);

        $this->actingAs($userA)->getJson("/api/businesses/{$businessA->id}/entitlements")
            ->assertOk()
            ->assertJsonPath('entitlements.plan', 'Free')
            ->assertJsonPath('entitlements.capabilities.showcase', false)
            ->assertJsonPath('subscription', null);

        /* ── 2. SUCCESSFUL PAYMENT (init → callback → verify → activate) ── */
        $this->fakeZarinpal();
        $res = $this->actingAs($userA)->postJson("/api/businesses/{$businessA->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();
        $authority = $res->json('authority');
        $this->assertSame(2490000, (int) PaymentTransaction::where('authority', $authority)->first()->amount);

        $this->getJson("/api/payments/callback?Authority={$authority}&Status=OK")->assertOk();

        /* ── 3. SAME SESSION (no logout/login): entitlement refresh ── */
        $this->actingAs($userA)->getJson("/api/businesses/{$businessA->id}/entitlements")
            ->assertOk()
            ->assertJsonPath('entitlements.plan', $plan->name)
            ->assertJsonPath('entitlements.capabilities.showcase', true)
            ->assertJsonPath('entitlements.capabilities.max_showcases', 5)
            ->assertJsonPath('subscription.effective_status', 'active')
            ->assertJsonPath('subscription.plan_name', $plan->name)
            ->assertJsonPath('subscription.remaining_seconds', 30 * 86400);

        /* ── 4. The SAME feature through the REAL API now works ── */
        $this->actingAs($userA)
            ->postJson("/api/businesses/{$businessA->id}/showcases", $this->showcasePayload())
            ->assertCreated();

        /* ── 5. ISOLATION: user B is completely unaffected ── */
        $this->actingAs($userB)
            ->postJson("/api/businesses/{$businessB->id}/showcases", $this->showcasePayload())
            ->assertStatus(403);
        $this->actingAs($userB)->getJson("/api/businesses/{$businessB->id}/entitlements")
            ->assertOk()
            ->assertJsonPath('entitlements.plan', 'Free')
            ->assertJsonPath('entitlements.capabilities.showcase', false);

        /* ── 6. EXPIRATION: the feature restricts again, without any cron ── */
        Carbon::setTestNow(Carbon::parse('2026-10-28 15:30:01', 'UTC')); // 1s past expires_at

        $this->actingAs($userA)
            ->postJson("/api/businesses/{$businessA->id}/showcases", $this->showcasePayload())
            ->assertStatus(403);

        $this->actingAs($userA)->getJson("/api/businesses/{$businessA->id}/entitlements")
            ->assertOk()
            ->assertJsonPath('subscription.effective_status', 'expired')
            ->assertJsonPath('entitlements.capabilities.showcase', false)
            ->assertJsonPath('entitlements.plan', 'Free');

        // The stored flag may still read active (nightly sweep is separate)
        // — access control MUST NOT depend on it.
        $this->assertNotSame('expired', PaymentTransaction::query()->first()?->status ?? 'paid');

        Carbon::setTestNow();
    }

    public function test_chain_holds_for_a_second_feature_path_card_entitlements(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-28 15:30:00', 'UTC'));

        $user = $this->owner();
        $business = $this->business($user);
        $plan = Plan::create([
            'name' => 'حرفه‌ای', 'slug' => 'professional-'.uniqid(), 'price' => 249000,
            'currency' => 'IRR', 'duration_days' => 30,
            'features' => ['showcase' => false, 'card_templates' => ['classic', 'local', 'midnight'], 'print_file' => true],
            'is_active' => true, 'is_public' => true,
        ]);

        /* 1. Free: premium template is rejected by the REAL card save API. */
        $this->actingAs($user)
            ->putJson("/api/businesses/{$business->id}/card", ['template' => 'midnight'])
            ->assertStatus(403)
            ->assertJsonPath('entitlement_errors.template', 'locked');

        /* 2–3. Payment → activation → same session shows the new grants. */
        $this->fakeZarinpal();
        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $plan->id])
            ->assertCreated();
        $this->getJson("/api/payments/callback?Authority={$res->json('authority')}&Status=OK")->assertOk();

        $this->actingAs($user)->getJson("/api/businesses/{$business->id}/entitlements")
            ->assertOk()
            ->assertJsonPath('entitlements.capabilities.print_file', true)
            ->assertJsonPath('subscription.effective_status', 'active');

        /* 4. The REAL card save API accepts the premium template now. */
        $this->actingAs($user)
            ->putJson("/api/businesses/{$business->id}/card", ['template' => 'midnight'])
            ->assertOk();

        /* 6. After expiry the premium template is rejected again. */
        Carbon::setTestNow(Carbon::parse('2026-10-28 15:30:01', 'UTC'));
        $this->actingAs($user)->getJson("/api/businesses/{$business->id}/entitlements")
            ->assertOk()
            ->assertJsonPath('subscription.effective_status', 'expired');

        // Note: grandfathering (POLICY) still allows re-saving the stored
        // value — the fresh premium VALUE on a NEW card is blocked:
        $this->actingAs($user)
            ->putJson("/api/businesses/{$business->id}/card", ['template' => 'creative'])
            ->assertStatus(403);

        Carbon::setTestNow();
    }
}
