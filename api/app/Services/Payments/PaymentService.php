<?php

namespace App\Services\Payments;

use App\Models\Business;
use App\Models\InternalNotification;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Services\FeatureGate;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * The ONE online-payment service. Init, callback/verify, activation.
 *
 * SECURITY:
 *  - Clients supply ONLY plan_id + business_id on init. Amount, currency,
 *    duration and entitlements are resolved SERVER-side from the DB plan.
 *  - Verify amounts come exclusively from the stored transaction row; the
 *    callback's only client-controlled inputs are Authority + Status, which
 *    are never used as money/identity facts.
 *  - Every state mutation happens under a row lock inside a DB transaction
 *    (PaymentTransaction::claimPaid / claimTerminal) → replay/concurrency safe.
 *
 * REBUY / UPGRADE / DOWNGRADE (the subscription model):
 *
 *      Business
 *        └── ONE active Subscription  ← extended in place by renewals
 *               ├── Payment #1 (paid)
 *               ├── Payment #2 (paid)      all link subscription_id → row
 *               └── Payment #3 (paid)
 *
 *      + optional ONE scheduled Subscription (downgrade, starts at the
 *        active subscription's expires_at; promoted lazily the moment the
 *        active lifetime ends — no cron required for correctness).
 *
 *  - RENEWAL (same tier — the admin may expose one plan per duration, e.g.
 *    monthly/quarterly/yearly SKUs of the SAME tier): NO parallel
 *    subscription — the existing row's expires_at is EXTENDED by the
 *    purchased duration (timestamp arithmetic — never a counter). The
 *    payment row links to the same subscription; when the purchased plan
 *    row differs (another duration of the same tier) the money snapshot
 *    follows the newest purchase. Buying the exact scheduled plan extends
 *    the SCHEDULED row instead (it is that plan's active lifecycle).
 *  - UPGRADE (higher tier): activates immediately; the remaining lifetime of
 *    the superseded lower plan CARRIES OVER (added to the new expires_at) so
 *    the user never loses paid time. Old row → expired, never deleted.
 *  - DOWNGRADE (lower tier): stored as `scheduled`, starting EXACTLY at the
 *    current expires_at. Current entitlements are untouched until then.
 *  - EXPIRED baseline: a purchase on a lapsed (or absent) subscription
 *    starts FRESH from now — never appended to an expired lifetime.
 *
 * Concurrency: the whole activation runs inside one DB transaction that
 * first takes a row lock on the BUSINESS — two simultaneous same-plan
 * payments serialize, so both +30d extensions compose (Oct20+30+30), never
 * overwrite each other.
 */
class PaymentService
{
    /* -----------------------------------------------------------------
     | Init: create the transaction row and get the StartPay URL.
     * ----------------------------------------------------------------- */

    /**
     * @return array{transaction: PaymentTransaction, redirect_url: string}
     */
    public function init(User $user, Business $business, Plan $plan): array
    {
        // Only ACTIVE plans can be purchased (same rule as the manual flow).
        abort_unless($plan->is_active, 404, 'پلن در دسترس نیست.');
        abort_unless($plan->is_public, 404, 'پلن در دسترس نیست.');

        $gateway = ZarinPalGateway::fromConfig();

        // MONEY UNITS (locked by PaymentZarinPalAmountTest): plans.price is
        // TOMAN (the display unit — UI shows «۲۴۹٬۰۰۰ تومان»), ZarinPal
        // charges RIAL. The transaction row stores the GATEWAY amount
        // (priceRial = price × 10, e.g. 2,490,000 for the professional plan)
        // and that exact value is what createPayment/verify send. The single
        // ×10 conversion lives in Plan::priceRial() — nowhere else.
        $gatewayAmountRial = $plan->priceRial();

        $transaction = (new PaymentTransaction)->forceFill([
            'user_id' => $user->id,
            'business_id' => $business->id,
            'plan_id' => $plan->id,
            'provider' => 'zarinpal',
            // Money snapshot frozen from the DB plan — client cannot influence:
            'amount' => $gatewayAmountRial,
            'currency' => (string) $plan->currency,
            'status' => PaymentTransaction::STATUS_PENDING,
        ]);
        $transaction->save();

        // HTTPS REQUIREMENT (production): ZarinPal's production gateway
        // requires an https callback. Fail SAFE — refuse to create an
        // insecure payment BEFORE the provider call (fail-safety: no payment
        // session exists that could bypass server verification).
        $callbackUrl = $this->enforceProductionHttps(rtrim((string) config('app.url'), '/').'/api/payments/callback', 'APP_URL');

        try {
            $result = $gateway->createPayment($gatewayAmountRial, $callbackUrl, [
                'mobile' => $user->phone ?? null,
                'email' => $user->email ?? null,
                'description' => "خرید پلن {$plan->name} برای {$business->name}",
            ]);
        } catch (PaymentGatewayException $e) {
            // Provider unreachable → keep the row for support/recovery, mark failed.
            $transaction->forceFill([
                'status' => PaymentTransaction::STATUS_FAILED,
                'failure_reason' => substr($e->reason, 0, 120),
            ])->save();

            throw $e;
        }

        $transaction->forceFill(['authority' => $result['authority']])->save();

        return ['transaction' => $transaction->refresh(), 'redirect_url' => $result['redirect_url']];
    }

    /**
     * HTTPS enforcement for gateway-facing URLs. Production payments may
     * only ever point at https:// origins (ZarinPal production requirement);
     * sandbox/local development on localhost http stays allowed. Anything
     * else aborts BEFORE any provider interaction.
     */
    private function enforceProductionHttps(string $url, string $label): string
    {
        $isProduction = ZarinPalGateway::fromConfig()->isSandbox() === false;
        if (! $isProduction) {
            return $url; // sandbox/local: http localhost is legitimate
        }

        abort_if(! str_starts_with(strtolower($url), 'https://'), 500,
            "{$label} must start with https:// in the ZarinPal production environment (ZARINPAL_ENV=production).");

        return $url;
    }

    /* -----------------------------------------------------------------
     | Callback: provider redirects the user's browser here.
     * ----------------------------------------------------------------- */

    /**
     * Handle GET /api/payments/callback?Authority=...&Status=...
     *
     * Expected outcomes (mapped 1:1 from the threat model):
     *  - Status != OK                       → canceled (no verify, no activation)
     *  - authority unknown                  → failed:unknown_authority (no activation)
     *  - provider unreachable               → row stays PENDING (recoverable) + exception message
     *  - verify says OK + amount matches    → paid + activate once (idempotent afterwards)
     *  - verify says amount mismatch        → failed:amount_mismatch (no activation)
     *  - verify refuses                     → failed:verify_failed_<code>
     *  - row already paid                   → idempotent status (NO re-activation)
     *
     * @return array{transaction: PaymentTransaction, already_final: bool}
     */
    public function handleCallback(string $authority, string $status): array
    {
        $row = PaymentTransaction::query()->where('authority', $authority)->first();

        if ($row === null) {
            // Forged/unknown authority: nothing exists to mutate. Fail safely.
            $ghost = (new PaymentTransaction)->forceFill(['status' => PaymentTransaction::STATUS_FAILED, 'failure_reason' => 'unknown_authority']);

            return ['transaction' => $ghost, 'already_final' => false];
        }

        // NOK: the user canceled at the gateway. Terminal, no verify call.
        if (strtoupper($status) !== 'OK') {
            ['row' => $row] = PaymentTransaction::claimTerminal($authority, PaymentTransaction::STATUS_CANCELED, 'canceled_at_gateway');

            return ['transaction' => $row, 'already_final' => false];
        }

        // Row in a non-pending terminal state → REPLAY. Idempotent refusal:
        // never re-verify, never re-activate, never touch the subscription.
        if (! $row->isPending()) {
            return ['transaction' => $row->refresh(), 'already_final' => true];
        }

        // ---- Pending row + OK status: real verification path ----
        $gateway = ZarinPalGateway::fromConfig();

        // THE amount is the row's own amount — client input is never consulted.
        try {
            $verification = $gateway->verifyPayment($authority, (int) $row->amount);
        } catch (PaymentGatewayException $e) {
            // Timeout / network / provider 5xx: the row stays PENDING so the
            // outcome can still be resolved later (retry, admin reconcile,
            // or prune). Never activates; never guesses success.
            throw $e;
        }

        if (! $verification['ok']) {
            $reason = 'verify_failed'.($verification['code'] !== null ? '_'.$verification['code'] : '');
            ['row' => $row] = PaymentTransaction::claimTerminal($authority, PaymentTransaction::STATUS_FAILED, $reason);

            return ['transaction' => $row, 'already_final' => false];
        }

        // The renewal/upgrade/downgrade rules are DECLARED config, and this is
        // the single place they are resolved. Assert before money moves: a
        // misconfiguration must fail loudly here, not after the payment row has
        // been consumed (a consumed row can never be replayed into activation).
        $this->assertPlanChangePolicy();

        // Claim pending→paid atomically. If a concurrent callback won the
        // race, claimed=false and we MUST NOT activate again.
        ['row' => $row, 'claimed' => $claimed] = PaymentTransaction::claimPaid($authority, [
            'ref_id' => $verification['ref_id'],
            'card_pan_masked' => $verification['card_pan_masked'],
            'payload' => ['code' => $verification['code'], 'message' => $verification['message']],
        ]);

        if (! $claimed) {
            return ['transaction' => $row->refresh(), 'already_final' => true];
        }

        // Amount re-check happens with the row locked (claimPaid returned the
        // winner): the provider charged exactly `row->amount` because verify
        // was CALLED with row->amount. Record the expected amount explicitly.
        $row->forceFill(['verification_payload' => array_merge($row->verification_payload ?? [], ['expected_amount' => $row->amount])])->save();

        $this->activateSubscription($row);

        return ['transaction' => $row->refresh(), 'already_final' => false];
    }

    /* -----------------------------------------------------------------
     | Activation — the ONLY path from `paid` to a subscription change.
     * ----------------------------------------------------------------- */

    /**
     * Classify the purchase against the business's CURRENT state and apply
     * exactly one of: renewal / upgrade / downgrade-schedule / fresh start.
     * Runs under the business row lock — concurrent same-plan payments
     * serialize and their durations COMPOSE (never overwrite).
     */
    private function activateSubscription(PaymentTransaction $row): Subscription
    {
        return DB::transaction(function () use ($row): Subscription {
            // Also guarded here so direct/queued callers can never apply a
            // change the declared policy does not describe.
            $this->assertPlanChangePolicy();

            /** @var PaymentTransaction $locked */
            $locked = PaymentTransaction::whereKey($row->id)->lockForUpdate()->firstOrFail();

            // Already consumed (double activation guard — a payment may bind
            // to at most one subscription outcome, enforced by the service
            // itself: the write below happens only when subscription_id IS
            // still null, inside this locked transaction).
            if ($locked->subscription_id !== null) {
                return Subscription::findOrFail($locked->subscription_id);
            }

            $plan = $locked->plan()->firstOrFail();

            // Re-check the plan is still active at activation time.
            abort_if(! $plan->is_active, 422, 'پلن این تراکنش غیرفعال است.');

            $business = $locked->business()->firstOrFail();

            // CONCURRENCY SERIALIZATION: lock the business row for the whole
            // classification + mutation. Two simultaneous paid callbacks for
            // the same business queue here, so every one of them reads the
            // post-previous state and durations compose.
            Business::whereKey($business->id)->lockForUpdate()->firstOrFail();

            $now = now();

            // Snapshot of the current state BEFORE any change (for notes).
            $currentActive = $this->currentActiveSubscription($business, $now);
            $scheduled = $this->pendingScheduledSubscription($business);

            $outcome = $this->classify($plan, $currentActive?->plan, $scheduled?->plan);

            $subscription = match ($outcome) {
                'scheduled_renewal' => $this->applyScheduledRenewal($business, $scheduled, $plan, $locked),
                'renewal' => $this->applyRenewal($business, $currentActive, $scheduled, $plan, $locked, $now),
                'upgrade' => $this->applyUpgrade($business, $currentActive, $scheduled, $plan, $locked, $now),
                'downgrade' => $this->applyScheduledDowngrade($business, $currentActive, $scheduled, $plan, $locked, $now),
                default => $this->applyFreshStart($business, $plan, $locked, $now),
            };

            // Consume the transaction: the service guarantees each paid row
            // binds exactly once (guarded write under the business lock).
            if ($locked->subscription_id === null) {
                $locked->forceFill(['subscription_id' => $subscription->id])->save();
            }

            return $subscription;
        });
    }

    /**
     * What the payment service ACTUALLY implements for each plan change.
     * The declared policy in config/entitlements.php must match this exactly —
     * it is the contract, not a suggestion.
     */
    private const PLAN_CHANGE_CONTRACT = [
        'renewal' => 'extend',
        'upgrade' => 'immediate_carry_over',
        'downgrade' => 'scheduled_at_expiry',
        'proration' => 'none',
    ];

    /**
     * The declared plan-change policy (ONE source of truth for the business
     * rules). Read through FeatureGate so it comes from the same config root as
     * every other policy.
     *
     * @return array<string, string>
     */
    public static function planChangePolicy(): array
    {
        $policy = FeatureGate::policy('plan_change');

        if (! is_array($policy)) {
            throw new RuntimeException(
                'entitlements.policies.plan_change must be the structured policy array '
                .'(see config/entitlements.php); the scalar form is stale and unsupported.'
            );
        }

        return $policy + self::PLAN_CHANGE_CONTRACT;
    }

    /**
     * Fail loudly when the declared policy does not describe the implemented
     * behaviour. Silent divergence between a config knob and the code is how a
     * "documented" rule ends up contradicting the real product — so an
     * unsupported value throws instead of being ignored.
     */
    private function assertPlanChangePolicy(): void
    {
        $policy = self::planChangePolicy();

        foreach (self::PLAN_CHANGE_CONTRACT as $key => $implemented) {
            $declared = $policy[$key] ?? null;
            if ($declared !== $implemented) {
                throw new RuntimeException(
                    "entitlements.policies.plan_change.{$key} declares '".(is_scalar($declared) ? (string) $declared : '(invalid)').
                    "' but the payment service implements '{$implemented}'."
                );
            }
        }
    }

    /**
     * The active, still-valid subscription evaluated against the SERVER
     * clock (`expires_at > now`). Same boundary FeatureGate uses.
     */
    private function currentActiveSubscription(Business $business, $now): ?Subscription
    {
        return $business->subscriptions()
            ->where('status', 'active')
            ->whereNotNull('expires_at')
            ->where('expires_at', '>', $now)
            ->orderByDesc('id')
            ->first();
    }

    /** The not-yet-started scheduled row, if any (there is at most ONE). */
    private function pendingScheduledSubscription(Business $business): ?Subscription
    {
        return $business->subscriptions()
            ->where('status', 'scheduled')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Upgrade / downgrade / renewal / switch classification.
     *
     * TIER SEMANTICS: tier identifies the DIFFICULTY LEVEL, not the billing
     * period. An admin may expose one plan ROW per duration of the same
     * level (monthly/quarterly/yearly SKUs) — those share a tier, so buying
     * any of them while that tier is active is a RENEWAL (the durations
     * compose into one lifetime), never a parallel upgrade.
     *
     * Order:
     *   1. no valid active subscription            → fresh
     *   2. scheduled row of the SAME plan          → scheduled_renewal
     *   3. same plan id                            → renewal
     *   4. same tier (different plan rows)         → renewal
     *   5. purchased tier lower than active        → downgrade (scheduled)
     *   6. purchased tier higher / equal-price     → upgrade (immediate)
     *
     * Tier resolution when tiers are null: compare price; equal prices make
     * different ids a switch, which follows the upgrade behaviour.
     *
     * @return 'renewal'|'upgrade'|'downgrade'|'fresh'|'scheduled_renewal'
     */
    private function classify(Plan $purchased, ?Plan $current, ?Plan $scheduledPlan = null): string
    {
        if ($current === null) {
            return 'fresh';
        }

        if ($current->id === $purchased->id) {
            return 'renewal';
        }

        // Same tier (different plan row / another duration of the level) is a
        // renewal — durations compose into the ONE active lifetime.
        if ($purchased->tier !== null && $current->tier !== null && $purchased->tier === $current->tier) {
            return 'renewal';
        }

        if ($purchased->tier !== null && $current->tier !== null && $purchased->tier !== $current->tier) {
            return $purchased->tier > $current->tier ? 'upgrade' : 'downgrade';
        }

        if ((int) $purchased->price !== (int) $current->price) {
            return (int) $purchased->price > (int) $current->price ? 'upgrade' : 'downgrade';
        }

        // A paid scheduled change of THIS plan already exists → extend it.
        if ($scheduledPlan !== null && $scheduledPlan->id === $purchased->id) {
            return 'scheduled_renewal';
        }

        return 'upgrade'; // switch between same-level plans
    }

    /* ----------------------------------------------------- renewal ---- */

    /**
     * The active tier bought again: EXTEND the existing active subscription.
     * expires_at += purchased duration (pure timestamp arithmetic). The
     * money snapshot moves to the newest paid price/duration and the
     * entitlement snapshot re-freezes from the purchased plan's CURRENT
     * features (a new payment is a new agreement — later plan edits never
     * rewrite it afterwards). started_at is NEVER touched.
     *
     * A waiting scheduled change is REBASED to the new expiry (it must start
     * exactly when the extended lifetime ends — one scheduled invariant).
     */
    private function applyRenewal(Business $business, Subscription $active, ?Subscription $scheduled, Plan $plan, PaymentTransaction $locked, $now): Subscription
    {
        $durationSeconds = ((int) $plan->duration_days) * 86400;
        $expiresAt = $active->expires_at->copy()->addSeconds($durationSeconds);

        $active->forceFill([
            'expires_at' => $expiresAt,
            // Day-granular display mirror follows the extended lifetime.
            'end_date' => $expiresAt->copy()->toDateString(),
            // Money snapshot: the subscriber's LATEST paid terms.
            'plan_name' => $plan->name,
            'price_amount' => $locked->amountToman(),
            'price_currency' => (string) $locked->currency,
            'duration_days' => (int) $plan->duration_days,
            // POLICY snapshot_entitlements — re-freeze purchased plan features
            // on every renewal payment.
            'entitlements' => FeatureGate::normalize($plan->features),
        ])->save();

        // Keep the ONE scheduled change anchored to the (new) end of the
        // active lifetime.
        if ($scheduled !== null) {
            $scheduled->forceFill([
                'started_at' => $expiresAt->copy(),
                'expires_at' => $expiresAt->copy()->addDays((int) $scheduled->plan?->duration_days),
                'end_date' => $expiresAt->copy()->addDays((int) $scheduled->plan?->duration_days)->toDateString(),
                'start_date' => $expiresAt->copy()->toDateString(),
            ])->save();
        }

        $this->notePayment($locked, "تمدید اشتراک {$plan->name} — انقضای جدید: {$expiresAt->format('Y-m-d H:i')}");

        if ($business->user_id) {
            InternalNotification::create([
                'user_id' => $business->user_id,
                'type' => 'subscription_renewed',
                'title' => 'اشتراک تمدید شد',
                'message' => "پرداخت شما تأیید شد و {$plan->duration_days} روز به اشتراک {$plan->name} اضافه گردید.",
                'related_type' => Subscription::class,
                'related_id' => $active->id,
            ]);
        }

        return $active;
    }

    /* --------------------------------------------- scheduled renewal -- */

    /**
     * The EXACT scheduled plan bought again: extend the scheduled row's own
     * lifetime (the future lifecycle grows — the active plan is untouched).
     */
    private function applyScheduledRenewal(Business $business, Subscription $scheduled, Plan $plan, PaymentTransaction $locked): Subscription
    {
        $durationSeconds = ((int) $plan->duration_days) * 86400;
        $expiresAt = $scheduled->expires_at->copy()->addSeconds($durationSeconds);

        $scheduled->forceFill([
            'expires_at' => $expiresAt,
            'end_date' => $expiresAt->copy()->toDateString(),
            'plan_name' => $plan->name,
            'price_amount' => $locked->amountToman(),
            'price_currency' => (string) $locked->currency,
            'duration_days' => (int) $plan->duration_days,
            'entitlements' => FeatureGate::normalize($plan->features),
        ])->save();

        $this->notePayment($locked, "تمدید پلن زمان‌بندی‌شده {$plan->name}");

        return $scheduled;
    }

    /* ----------------------------------------------------- upgrade ---- */

    /**
     * Higher plan: active IMMEDIATELY, remaining lifetime of the superseded
     * plan carries over (never lost): expires_at = now + duration +
     * remaining(current). The previous row is expired (kept for history) —
     * no payment or subscription is ever deleted. A pre-existing scheduled
     * downgrade is superseded (the new active plan defines the timeline).
     */
    private function applyUpgrade(Business $business, ?Subscription $active, ?Subscription $scheduled, Plan $plan, PaymentTransaction $locked, $now): Subscription
    {
        $durationSeconds = ((int) $plan->duration_days) * 86400;
        $remainingSeconds = ($active !== null && $active->expires_at !== null)
            ? max(0, $active->expires_at->getTimestamp() - $now->getTimestamp())
            : 0;

        $subscription = $this->createSubscription($business, $plan, $locked, $now, $now->copy()->addSeconds($durationSeconds + $remainingSeconds), 'active');

        $this->expireSuperseded($business, $active, "ارتقا به {$plan->name} — زمان باقی‌مانده منتقل شد.");
        $this->expireSuperseded($business, $scheduled, "به دلیل ارتقا به {$plan->name} لغو شد.");

        if ($business->user_id) {
            InternalNotification::create([
                'user_id' => $business->user_id,
                'type' => 'subscription_activated',
                'title' => 'اشتراک ارتقا یافت',
                'message' => "پلن {$plan->name} فعال شد".($remainingSeconds > 0 ? ' و زمان باقی‌مانده پلن قبلی به آن اضافه گردید.' : '.'),
                'related_type' => Subscription::class,
                'related_id' => $subscription->id,
            ]);
        }

        return $subscription;
    }

    /* --------------------------------------------------- downgrade ---- */

    /**
     * Lower plan bought while a HIGHER plan is still active: stored as
     * `scheduled`, starting EXACTLY at the current expires_at. Nothing about
     * the current entitlements changes until then. A pre-existing scheduled
     * row is superseded (ONE scheduled change at a time).
     */
    private function applyScheduledDowngrade(Business $business, ?Subscription $active, ?Subscription $scheduled, Plan $plan, PaymentTransaction $locked, $now): Subscription
    {
        $startsAt = ($active !== null && $active->expires_at !== null)
            ? $active->expires_at->copy()
            : $now->copy();

        $durationSeconds = ((int) $plan->duration_days) * 86400;

        $subscription = $this->createSubscription($business, $plan, $locked, $startsAt, $startsAt->copy()->addSeconds($durationSeconds), 'scheduled');

        // Supersede any earlier scheduled change (single scheduled invariant).
        if ($scheduled !== null && $scheduled->id !== $subscription->id) {
            $this->expireSuperseded($business, $scheduled, "تغییر زمان‌بندی‌شده قبلی — با خرید {$plan->name} جایگزین شد.");
        }

        $this->notePayment($locked, "تغییر پلن به {$plan->name} زمان‌بندی شد — شروع: {$startsAt->format('Y-m-d H:i')}");

        if ($business->user_id) {
            InternalNotification::create([
                'user_id' => $business->user_id,
                'type' => 'subscription_scheduled',
                'title' => 'تغییر پلن زمان‌بندی شد',
                'message' => "پلن {$plan->name} پس از پایان اشتراک فعلی ({$startsAt->format('Y-m-d H:i')}) فعال خواهد شد.",
                'related_type' => Subscription::class,
                'related_id' => $subscription->id,
            ]);
        }

        return $subscription;
    }

    /* ------------------------------------------------------ fresh ----- */

    /**
     * No valid active subscription (absent OR lapsed): the purchase starts
     * FRESH from now — never appended to an expired lifetime. Every stale
     * still-flagged active row and any stray scheduled row is closed (the
     * single-active invariant is restored by this very payment).
     */
    private function applyFreshStart(Business $business, Plan $plan, PaymentTransaction $locked, $now): Subscription
    {
        $subscription = $this->createSubscription($business, $plan, $locked, $now, $now->copy()->addDays((int) $plan->duration_days), 'active');

        $business->subscriptions()
            ->where('status', 'active')
            ->where('id', '!=', $subscription->id)
            ->update(['status' => 'expired', 'admin_note' => 'با فعال‌سازی اشتراک جدید جایگزین شد.']);
        $business->subscriptions()
            ->where('status', 'scheduled')
            ->update(['status' => 'expired', 'admin_note' => 'با فعال‌سازی اشتراک جدید لغو شد.']);

        if ($business->user_id) {
            InternalNotification::create([
                'user_id' => $business->user_id,
                'type' => 'subscription_active',
                'title' => 'اشتراک فعال شد',
                'message' => 'پرداخت شما تأیید شد و اشتراک '.$plan->name.' فعال گردید.',
                'related_type' => Subscription::class,
                'related_id' => $subscription->id,
            ]);
        }

        return $subscription;
    }

    /* ------------------------------------------------------ shared ---- */

    /** Create the subscription row with frozen money + entitlement snapshots. */
    private function createSubscription(Business $business, Plan $plan, PaymentTransaction $locked, $startedAt, $expiresAt, string $status): Subscription
    {
        $subscription = new Subscription([
            'business_id' => $business->id,
            'plan_id' => $plan->id,
            'status' => $status,
            // Day-granular mirror (reports/legacy display) — the
            // authoritative lifecycle is the timestamp pair.
            'start_date' => $startedAt->toDateString(),
            'end_date' => $expiresAt->copy()->toDateString(),
            'admin_note' => 'فعال‌سازی خودکار پس از پرداخت آنلاین ('.$locked->provider.' #'.$locked->id.')',
        ]);
        $subscription->save();

        // TIME LIFECYCLE — source of truth is the timestamp pair; remaining
        // time is ALWAYS derived (expires_at − now), never a stored counter.
        $subscription->forceFill([
            'started_at' => $startedAt,
            'expires_at' => $expiresAt,
        ])->save();

        // Money snapshot: derived from the CHARGED transaction amount
        // (amountToman = the frozen rial ÷ 10), NOT the current plan price —
        // a plan reprice between init and activation can never rewrite what
        // the subscriber actually paid.
        $subscription->forceFill([
            'plan_name' => $plan->name,
            'price_amount' => $locked->amountToman(),
            'price_currency' => (string) $locked->currency,
            'duration_days' => (int) $plan->duration_days,
        ])->save();

        // POLICY snapshot_entitlements — freeze current plan config (also on
        // scheduled rows: the entitlements they will grant are fixed NOW).
        $subscription->forceFill([
            'entitlements' => FeatureGate::normalize($plan->features),
        ])->save();

        return $subscription;
    }

    /** Expire a superseded row (never delete — history is money history). */
    private function expireSuperseded(Business $business, ?Subscription $subscription, string $reason): void
    {
        if ($subscription === null || $subscription->status === 'expired') {
            return;
        }

        $subscription->forceFill(['status' => 'expired', 'admin_note' => $reason])->save();
    }

    private function notePayment(PaymentTransaction $locked, string $note): void
    {
        $locked->forceFill([
            'verification_payload' => array_merge($locked->verification_payload ?? [], ['activation_note' => $note]),
        ])->save();
    }

    /* -----------------------------------------------------------------
     | Scheduled promotion — shared with FeatureGate (lazy) and the
     | nightly sweep. MUST be called inside a transaction that already
     | holds the business row lock.
     * ----------------------------------------------------------------- */

    /**
     * Promote a due scheduled subscription to active (and expire the
     * superseded active row). Returns the promoted row or null.
     */
    public function promoteDueScheduled(Business $business, $now): ?Subscription
    {
        $scheduled = $business->subscriptions()
            ->where('status', 'scheduled')
            ->orderBy('id')
            ->first();

        if ($scheduled === null) {
            return null;
        }

        $startsAt = $scheduled->started_at ?? $scheduled->lifetimeStartedAt();
        if ($startsAt === null || $startsAt->gt($now)) {
            return null; // not due yet
        }

        // Expire every still-flagged active row the scheduled one replaces.
        $business->subscriptions()
            ->where('status', 'active')
            ->where('id', '!=', $scheduled->id)
            ->update(['status' => 'expired', 'admin_note' => "پایان دوره — فعال‌سازی پلن زمان‌بندی‌شده {$scheduled->plan_name}"]);

        $scheduled->forceFill(['status' => 'active'])->save();

        return $scheduled;
    }

    /* -----------------------------------------------------------------
     | Read-only status (used by the result page + refresh safety).
     * ----------------------------------------------------------------- */

    /**
     * Owner-readable status. Authorization lives at the controller; this
     * method NEVER mutates anything — a page refresh cannot re-activate.
     *
     * @return array{status: string, ref_id: ?string, plan_name: ?string, business_id: int, subscription: ?array, created_at: ?string}
     */
    public function statusFor(PaymentTransaction $row): array
    {
        $subscription = $row->subscription;

        return [
            'status' => $row->status,
            'ref_id' => $row->ref_id,
            'plan_name' => $row->plan?->name ?? null,
            'business_id' => (int) $row->business_id,
            'amount' => (int) $row->amount,
            'currency' => $row->currency,
            'failure_reason' => $row->failure_reason,
            'paid_at' => $row->paid_at?->toISOString(),
            'subscription' => $subscription ? [
                'id' => $subscription->id,
                'status' => $subscription->status,
                'effective_status' => $subscription->effective_status,
                'start_date' => $subscription->start_date?->toDateString(),
                'end_date' => $subscription->end_date?->toDateString(),
                'started_at' => $subscription->lifetimeStartedAt()?->toISOString(),
                'expires_at' => $subscription->lifetimeEndsAt()?->toISOString(),
                'remaining_seconds' => $subscription->remaining_seconds,
                'plan_name' => $subscription->moneySnapshot()['plan_name'],
            ] : null,
            'created_at' => $row->created_at?->toISOString(),
        ];
    }
}
