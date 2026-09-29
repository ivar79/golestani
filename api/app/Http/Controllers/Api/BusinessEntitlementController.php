<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\Subscription;
use App\Services\FeatureGate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/businesses/{business}/entitlements — the STANDARD Dashboard
 * entitlement contract (owner/admin only).
 *
 * WHY A DEDICATED ENDPOINT: /businesses/{id}/card embeds the payload only
 * because the card controller needed it — it is card-shaped, not a contract.
 * This endpoint exposes exactly one source: FeatureGate::payload() plus the
 * active subscription's time lifecycle, so the frontend never has to infer
 * plan/permissions from any other data.
 *
 * SECURITY: ownership-scoped like every other business resource; the payload
 * is computed SERVER-side from the subscription entitlement snapshot — no
 * client input participates in any access decision. Authorization stays
 * entirely on the backend; the frontend mirrors this for UX only.
 */
class BusinessEntitlementController extends Controller
{
    public function show(Request $request, Business $business): JsonResponse
    {
        $this->authorizeOwner($request, $business);

        $gate = app(FeatureGate::class);

        /** @var Subscription|null $subscription */
        // activeSubscription() also lazily promotes a due scheduled row, so
        // this read is the exact moment a scheduled downgrade becomes real.
        $subscription = $gate->activeSubscription($business)
            // After expiry the granting lookup is (correctly) empty — the
            // UI still needs the LAST subscription to show its derived
            // expired state, but it MUST NOT re-grant anything.
            ?? $business->subscriptions()->latest('expires_at')->first();

        return response()->json([
            // payload() includes plan + source + capabilities + `scheduled`
            // (the paid plan change waiting for the current lifetime to end).
            'entitlements' => app(FeatureGate::class)->payload($business),
            'subscription' => $subscription ? [
                'id' => $subscription->id,
                'plan_id' => (int) $subscription->plan_id,
                'plan_name' => $subscription->plan_name ?? $subscription->plan?->name,
                // Stored status may lag reality until the nightly sweep — the
                // derived status is what the UI must show.
                'status' => $subscription->status,
                'effective_status' => $subscription->effective_status,
                'started_at' => $subscription->lifetimeStartedAt()?->toIso8601String(),
                'expires_at' => $subscription->lifetimeEndsAt()?->toIso8601String(),
                'remaining_seconds' => $subscription->remaining_seconds,
                'price_amount' => $subscription->moneySnapshot()['price_amount'],
                'price_currency' => $subscription->moneySnapshot()['price_currency'],
                'duration_days' => $subscription->moneySnapshot()['duration_days'],
            ] : null,
        ]);
    }

    private function authorizeOwner(Request $request, Business $business): void
    {
        abort_unless($request->user()?->hasRole('admin') || $business->user_id === $request->user()?->id, 403);
    }
}
