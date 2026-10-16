<?php

namespace App\Services\Wallet;

use App\Models\Designer;
use App\Models\InternalNotification;
use App\Models\PaymentTransaction;
use App\Models\Subscription;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * THE central designer-commission service — the only place a commission is
 * accrued or reversed. It is called from exactly two confirmation points:
 *
 *   1. ONLINE  — PaymentService::handleCallback, right after the gateway
 *      transaction is claimed `paid` (the payment confirmation).
 *   2. MANUAL  — SubscriptionController::moderate, when an admin sets
 *      `active` (the receipt confirmation).
 *
 * It is DELIBERATELY NOT called from PaymentService::promoteDueScheduled or
 * from FeatureGate's lazy promotion: promoting a `scheduled` row is a
 * lifecycle event long after the money was confirmed, and the online accrual
 * for that purchase already happened at payment time. Anything else would pay
 * for the same purchase twice.
 *
 * MONEY: the base is the subscription's OWN money snapshot — `price_amount`,
 * which is TOMAN (`Plan::priceRial()` is the single ×10 that turns it into the
 * RIAL unit stored in the ledger). No discount/coupon flow exists in the
 * project, so that snapshot is the amount the buyer actually paid: for online
 * purchases PaymentService derives it from the CHARGED gateway amount
 * (`amountToman()`), for manual ones the admin confirmed it.
 *
 * ELIGIBILITY (a commission is skipped, never guessed):
 *   - the business has no attributed designer            → no_designer
 *   - the designer IS the business owner (self-referral) → self_referral
 *   - the plan's commission_percent is 0                 → no_percent
 *   - the purchase has no money snapshot                 → no_price
 *   - `commission.on_renewal` is off and this
 *     subscription already earned something              → first_purchase_only
 *
 * IDEMPOTENCY: the ledger key is derived from the PURCHASE EVENT
 * (`commission:payment:{id}` / `commission:order:{id}`), so a replayed
 * callback, a repeated admin approval or a re-run of the backfill command can
 * never pay twice. Accrual for an ONLINE purchase is keyed on the gateway
 * transaction (that is the row that exists once per payment — a renewal
 * extends the SAME subscription row, so keying on the subscription would
 * silently skip every renewal).
 *
 * FAILURE POLICY: callers use `accrueQuietly()`/`reverseQuietly()`, which log
 * and swallow. A commission problem must never roll back (or 500) the
 * subscription activation it accompanies — the ledger is rebuildable with
 * `php artisan commissions:backfill`, the subscription state is not.
 */
class CommissionService
{
    public function __construct(private readonly WalletLedger $ledger)
    {
    }

    public const REASON_ELIGIBLE = 'eligible';

    public const REASON_NO_DESIGNER = 'no_designer';

    public const REASON_SELF_REFERRAL = 'self_referral';

    public const REASON_NO_PERCENT = 'no_percent';

    public const REASON_NO_PRICE = 'no_price';

    public const REASON_FIRST_PURCHASE_ONLY = 'first_purchase_only';

    public const REASON_ONLINE_PAYMENT = 'paid_online_payment';

    /**
     * PURE planner: decides (without writing anything) whether this purchase
     * earns a commission and how much. Used by the accrual itself, by the
     * backfill command for reporting, and by tests — one rule set, one place.
     *
     * @return array{eligible: bool, reason: string, amount_rial: int, designer_user_id: ?int, key: string, description: string}
     */
    public function quote(Subscription $subscription, ?PaymentTransaction $payment = null): array
    {
        $key = $payment !== null
            ? WalletTransaction::commissionKeyForPayment((int) $payment->id)
            : WalletTransaction::commissionKeyForOrder((int) $subscription->id);

        $plan = $subscription->plan;
        $percent = (int) ($plan?->commission_percent ?? 0);
        $priceToman = (int) ($subscription->price_amount ?? $plan?->price ?? 0);

        $result = fn (string $reason, int $amount = 0, ?int $designerUserId = null): array => [
            'eligible' => $reason === self::REASON_ELIGIBLE,
            'reason' => $reason,
            'amount_rial' => $amount,
            'designer_user_id' => $designerUserId,
            'key' => $key,
            'description' => '',
        ];

        if ($priceToman <= 0) {
            return $result(self::REASON_NO_PRICE);
        }

        if ($percent <= 0) {
            return $result(self::REASON_NO_PERCENT);
        }

        // A subscription that was paid ONLINE is only ever accrued for through
        // its gateway transaction. Without this guard an admin re-save of
        // `active` (or a backfill pass over every activated subscription) would
        // pay a SECOND commission for the same purchase, under the order key.
        if ($payment === null && $this->hasPaidOnlinePayment($subscription)) {
            return $result(self::REASON_ONLINE_PAYMENT);
        }

        $designer = $this->designerFor($subscription);
        if ($designer === null) {
            return $result(self::REASON_NO_DESIGNER);
        }

        $business = $subscription->business;
        // SELF-REFERRAL: referring your own business must never pay you a
        // commission (that would be a 15%-off purchase, not a referral).
        if ((int) $designer->user_id === (int) $business?->user_id) {
            return $result(self::REASON_SELF_REFERRAL);
        }

        if (! (bool) config('wallet.commission.on_renewal', true) && $this->hasAnyAccrual($subscription)) {
            return $result(self::REASON_FIRST_PURCHASE_ONLY);
        }

        $amount = $this->percentOf($priceToman, $percent);

        if ($amount <= 0) {
            return $result(self::REASON_NO_PERCENT);
        }

        $snapshot = $subscription->moneySnapshot();

        return [
            'eligible' => true,
            'reason' => self::REASON_ELIGIBLE,
            'amount_rial' => $amount,
            'designer_user_id' => (int) $designer->user_id,
            'key' => $key,
            'description' => sprintf(
                'پورسانت %d%% از خرید پلن «%s» برای کسب‌وکار «%s»',
                $percent,
                (string) ($snapshot['plan_name'] ?? $plan?->name ?? '-'),
                (string) ($business?->name ?? '-'),
            ),
        ];
    }

    /**
     * Accrue the commission of one confirmed purchase. Returns the created
     * ledger row, or NULL when nothing was written (ineligible, or already
     * accrued — see quote() for the reason).
     */
    public function accrueForSubscription(Subscription $subscription, ?PaymentTransaction $payment = null, ?User $actor = null): ?WalletTransaction
    {
        $quote = $this->quote($subscription, $payment);

        if (! $quote['eligible']) {
            return null;
        }

        $row = $this->ledger->accrue(
            (int) $quote['designer_user_id'],
            $quote['key'],
            $quote['amount_rial'],
            [
                'subscription_id' => $subscription->id,
                'payment_transaction_id' => $payment?->id,
                'reference_type' => $payment !== null ? PaymentTransaction::class : Subscription::class,
                'reference_id' => $payment?->id ?? $subscription->id,
                'description' => $quote['description'],
                'created_by' => $actor?->id,
            ],
        );

        if ($row !== null) {
            $this->notify(
                (int) $quote['designer_user_id'],
                'wallet_commission_accrued',
                'پورسانت جدید ثبت شد',
                $quote['description'].' به کیف پول شما اضافه شد.',
                $row->id,
            );
        }

        return $row;
    }

    /**
     * The activation-path wrapper: a commission failure is logged and NEVER
     * breaks the subscription activation it accompanies (the ledger can be
     * rebuilt with `commissions:backfill`; a half-activated subscription
     * cannot be un-broken).
     */
    public function accrueQuietly(Subscription $subscription, ?PaymentTransaction $payment = null, ?User $actor = null): ?WalletTransaction
    {
        try {
            return $this->accrueForSubscription($subscription, $payment, $actor);
        } catch (Throwable $e) {
            Log::error('wallet.commission.accrual_failed', [
                'subscription_id' => $subscription->id,
                'payment_transaction_id' => $payment?->id,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /** Same contract as accrueQuietly(), for the reversal path. */
    public function reverseQuietly(Subscription $subscription, string $reason, ?User $actor = null): array
    {
        try {
            return $this->reverseForSubscription($subscription, $reason, $actor);
        } catch (Throwable $e) {
            Log::error('wallet.commission.reversal_failed', [
                'subscription_id' => $subscription->id,
                'error' => $e->getMessage(),
            ]);

            return [];
        }
    }

    /**
     * Reverse every accrual of this subscription (a rejected/reverted
     * purchase). Each accrual gets at most ONE reversal ledger row (the
     * reversal key embeds the accrual key), and the money always goes back to
     * the wallet that RECEIVED it — not to whoever is the business' designer
     * today, which may have changed since.
     *
     * @return list<WalletTransaction>
     */
    public function reverseForSubscription(Subscription $subscription, string $reason, ?User $actor = null): array
    {
        $accruals = WalletTransaction::query()
            ->where('type', WalletTransaction::TYPE_COMMISSION_ACCRUED)
            ->where('subscription_id', $subscription->id)
            ->orderBy('id')
            ->get();

        $reversed = [];

        foreach ($accruals as $accrual) {
            $key = WalletTransaction::reversalKeyFor((string) $accrual->idempotency_key);

            $row = $this->ledger->reverse(
                (int) $accrual->wallet?->user_id,
                $key,
                -(int) $accrual->amount,
                [
                    'subscription_id' => $subscription->id,
                    'payment_transaction_id' => $accrual->payment_transaction_id,
                    'reference_type' => $accrual->reference_type,
                    'reference_id' => $accrual->reference_id,
                    'description' => "برگشت پورسانت — {$reason}",
                    'created_by' => $actor?->id,
                ],
            );

            if ($row !== null) {
                $reversed[] = $row;
                $this->notify(
                    (int) $accrual->wallet->user_id,
                    'wallet_commission_reversed',
                    'برگشت پورسانت',
                    'مبلغ پورسانت یک خرید ثبت‌شده معکوس شد: '.$reason,
                    $row->id,
                );
            }
        }

        return $reversed;
    }

    /** Designer of the business that owns this subscription (null when unattributed). */
    private function designerFor(Subscription $subscription): ?Designer
    {
        return $subscription->business?->designer;
    }

    /** Was this subscription bought through the gateway (its money is a payment event)? */
    private function hasPaidOnlinePayment(Subscription $subscription): bool
    {
        return PaymentTransaction::query()
            ->where('subscription_id', $subscription->id)
            ->where('status', PaymentTransaction::STATUS_PAID)
            ->exists();
    }

    private function hasAnyAccrual(Subscription $subscription): bool
    {
        return WalletTransaction::query()
            ->where('type', WalletTransaction::TYPE_COMMISSION_ACCRUED)
            ->where('subscription_id', $subscription->id)
            ->exists();
    }

    /**
     * percentage of a TOMAN amount, expressed in RIAL — the ×10 lives in
     * Plan::priceRial()'s contract, so it is spelled out here once and not
     * scattered: price_amount is TOMAN, the ledger is RIAL.
     */
    private function percentOf(int $priceToman, int $percent): int
    {
        $rial = $priceToman * 10;
        $raw = $rial * $percent / 100;

        return (string) config('wallet.commission.rounding', 'round_half_up') === 'floor'
            ? (int) floor($raw)
            : (int) round($raw, 0, PHP_ROUND_HALF_UP);
    }

    private function notify(int $userId, string $type, string $title, string $message, int $transactionId): void
    {
        InternalNotification::create([
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'message' => $message,
            'related_type' => WalletTransaction::class,
            'related_id' => $transactionId,
        ]);
    }
}
