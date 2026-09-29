<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * HTTPS REQUIREMENT (ZarinPal production era).
 *
 * In the production gateway environment every gateway-facing URL (the
 * callback APP_URL and the frontend result URL) MUST be https. The rule is
 * fail-safe: an insecure configuration aborts BEFORE any provider call and
 * BEFORE any meaningful row is created — an insecure payment session can
 * never exist. Sandbox/local development on http localhost stays allowed.
 */
class PaymentHttpsEnforcementTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $user): Business
    {
        return $user->businesses()->create(['name' => 'HTTPS Biz', 'slug' => 'https-'.uniqid(), 'status' => 'approved']);
    }

    private function plan(): Plan
    {
        return Plan::create([
            'name' => 'حرفه‌ای', 'slug' => 'professional-'.uniqid(), 'price' => 249000,
            'currency' => 'IRR', 'duration_days' => 30, 'features' => ['showcase' => true],
            'is_active' => true, 'is_public' => true,
        ]);
    }

    private function fakeGatewaySuccess(): void
    {
        Http::fake([
            'sandbox.zarinpal.com/pg/v4/payment/request.json' => Http::response(['data' => ['authority' => 'S'.str_repeat('0', 24).uniqid(), 'code' => 100], 'errors' => []]),
            'payment.zarinpal.com/pg/v4/payment/request.json' => Http::response(['data' => ['authority' => 'S'.str_repeat('0', 24).uniqid(), 'code' => 100], 'errors' => []]),
        ]);
    }

    public function test_production_rejects_http_app_url_before_any_gateway_call(): void
    {
        config([
            'zarinpal.env' => 'production',
            'zarinpal.merchant_id' => 'real-merchant-uuid',
            'app.url' => 'http://api.example.com',
        ]);
        $this->fakeGatewaySuccess();

        $user = $this->owner();
        $business = $this->business($user);

        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $this->plan()->id]);
        $this->assertContains($res->status(), [500, 503], 'production + http APP_URL must fail safely');

        // No gateway call was ever made — the insecure session never existed.
        Http::assertNothingSent();

        // Fail-safe ordering: the payment row is still pending (recoverable),
        // not a half-initialized "ready" row.
        $row = PaymentTransaction::first();
        $this->assertNotNull($row);
        $this->assertSame(PaymentTransaction::STATUS_PENDING, $row->status);
        $this->assertNull($row->authority);
    }

    public function test_production_accepts_https_app_url(): void
    {
        config([
            'zarinpal.env' => 'production',
            'zarinpal.merchant_id' => 'real-merchant-uuid',
            'app.url' => 'https://api.example.com',
        ]);
        $this->fakeGatewaySuccess();

        $user = $this->owner();
        $business = $this->business($user);

        $res = $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $this->plan()->id])
            ->assertCreated();

        $row = PaymentTransaction::findOrFail($res->json('transaction_id'));
        $this->assertNotNull($row->authority);
        $this->assertStringStartsWith('https://payment.zarinpal.com/pg/StartPay/', $res->json('redirect_url'));
    }

    public function test_sandbox_still_allows_local_http_app_url(): void
    {
        config([
            'zarinpal.env' => 'sandbox',
            'app.url' => 'http://localhost:8000',
        ]);
        $this->fakeGatewaySuccess();

        $user = $this->owner();
        $business = $this->business($user);

        $this->actingAs($user)->postJson("/api/businesses/{$business->id}/payments/init", ['plan_id' => $this->plan()->id])
            ->assertCreated();

        Http::assertSent(fn ($request) => str_contains($request->url(), 'sandbox.zarinpal.com'));
    }
}
