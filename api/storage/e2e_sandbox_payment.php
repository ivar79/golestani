<?php

/**
 * E2E REAL SANDBOX PAYMENT (ZarinPal sandbox — NO Http::fake).
 *
 * Run inside the api container / dev server:
 *     php artisan tinker --execute="require 'storage/e2e_sandbox_payment.php';"
 *     php artisan tinker --execute="require 'storage/e2e_sandbox_payment.php';" -- ;  with env SANDBOX_COMPLETE=1
 *     SANDBOX_COMPLETE=<authority> php artisan tinker ...   (after paying at the StartPay URL)
 *
 * Phase 1 (default): creates a REAL sandbox payment session for the
 *   «حرفه‌ای» professional plan (249,000 TOMAN) and asserts:
 *     - payment_transactions.amount === 2,490,000 RIAL (the gateway unit)
 *     - the authority + StartPay URL are printed for a human/browser to pay
 *
 * Phase 2 (SANDBOX_COMPLETE=<authority>): after the browser payment, calls
 *   the REAL callback → REAL verify → activation, then prints the full
 *   audit trail (user → plan → amount → authority → ref_id → subscription).
 *
 * NOTE: the sandbox completes the payment with any (made-up) mobile number
 * on the sandbox gateway page. This script NEVER touches production
 * (ZARINPAL_ENV must remain sandbox here).
 */

use App\Models\Business;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Models\Subscription;

if (config('zarinpal.env') !== 'sandbox') {
    echo "REFUSED: ZARINPAL_ENV must be 'sandbox' for this E2E script.".PHP_EOL;
    exit(1);
}

// Local dev trust-store fix: use the PEM bundle shipped next to this script
// (NOT a config change — scoped to this E2E session only).
if (is_file(__DIR__.'/cacert.pem')) {
    config(['zarinpal.cacert' => __DIR__.'/cacert.pem']);
}

$plan = Plan::where('slug', 'professional')->where('is_active', true)->first();
if (! $plan) {
    echo "MISSING: professional plan row (run the seeder).".PHP_EOL;
    exit(1);
}

// The E2E owner identity comes from the environment (never a literal in
// source — see the SECURITY RULES in storage/e2e_setup.php). Failing closed
// also prevents "pick any business owner" from targeting an unrelated,
// real account on a shared database.
$ownerPhone = trim((string) getenv('E2E_OWNER_PHONE'));
if (preg_match('/^09[0-9]{9}$/', $ownerPhone) !== 1) {
    echo "REFUSED: set E2E_OWNER_PHONE (09xxxxxxxxx) for the E2E owner.".PHP_EOL;
    exit(1);
}

$owner = User::where('phone', $ownerPhone)->first();
if (! $owner) {
    echo "MISSING: E2E owner (run storage/e2e_setup.php first).".PHP_EOL;
    exit(1);
}
$business = Business::where('user_id', $owner->id)->orderBy('id')->first();

echo "=== E2E SANDBOX PAYMENT ===".PHP_EOL;
echo "plan: {$plan->name} (id={$plan->id}) price={$plan->price} (TOMAN display)".PHP_EOL;
echo "expected gateway amount: {$plan->priceRial()} RIAL".PHP_EOL;

$completeAuthority = getenv('SANDBOX_COMPLETE') ?: null;

if ($completeAuthority) {
    // ---------- Phase 2: real callback + verify + activation ----------
    echo PHP_EOL."--- Phase 2: callback for authority {$completeAuthority} ---".PHP_EOL;

    $result = app(App\Services\Payments\PaymentService::class)->handleCallback($completeAuthority, 'OK');
    $row = $result['transaction']->refresh();

    echo "status: {$row->status}".PHP_EOL;
    echo "amount: {$row->amount} RIAL".PHP_EOL;
    echo "ref_id: {$row->ref_id}".PHP_EOL;
    echo "paid_at: {$row->paid_at}".PHP_EOL;
    echo "verified_at: {$row->verified_at}".PHP_EOL;

    if ($row->subscription_id) {
        $sub = Subscription::findOrFail($row->subscription_id);
        echo PHP_EOL."--- ACTIVATED SUBSCRIPTION ---".PHP_EOL;
        echo "subscription id: {$sub->id} (business {$sub->business_id}, plan {$sub->plan_id})".PHP_EOL;
        echo "started_at: {$sub->started_at}".PHP_EOL;
        echo "expires_at: {$sub->expires_at}".PHP_EOL;
        echo "effective_status: {$sub->effective_status}".PHP_EOL;
        echo "remaining_seconds: {$sub->remaining_seconds}".PHP_EOL;
        echo "price snapshot: {$sub->price_amount} (TOMAN)".PHP_EOL;
        echo PHP_EOL."EXACTLY-ONE check: active subscriptions for this business = ".
            Subscription::where('business_id', $sub->business_id)->where('status', 'active')->count().PHP_EOL;
        echo "E2E COMPLETE ✅".PHP_EOL;
    } else {
        echo "NO subscription activated (status={$row->status}, reason={$row->failure_reason})".PHP_EOL;
        exit(1);
    }
} else {
    // ---------- Phase 1: real init against sandbox ----------
    $service = app(App\Services\Payments\PaymentService::class);
    $result = $service->init($owner, $business, $plan);
    $row = $result['transaction']->refresh();

    echo "transaction id: {$row->id}".PHP_EOL;
    echo "row amount: {$row->amount} RIAL".PHP_EOL;
    if ((int) $row->amount !== $plan->priceRial()) {
        echo "❌ AMOUNT MISMATCH — the rial conversion is broken!".PHP_EOL;
        exit(1);
    }
    echo "✅ row amount === expected gateway amount (2,490,000 RIAL for 249,000 TOMAN)".PHP_EOL;
    echo "authority: {$row->authority}".PHP_EOL;
    echo PHP_EOL."PAY HERE (sandbox, any mobile number):".PHP_EOL;
    echo $result['redirect_url'].PHP_EOL;
    echo PHP_EOL."After paying, run phase 2:".PHP_EOL;
    echo "  SANDBOX_COMPLETE={$row->authority} php artisan tinker --execute=\"require 'storage/e2e_sandbox_payment.php';\"".PHP_EOL;
}
