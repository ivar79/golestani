<?php

namespace App\Services\Wallet;

use App\Models\DesignerBankAccount;
use App\Models\InternalNotification;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Models\WithdrawalRequest;
use App\Services\AuditTrail;
use App\Support\Sheba;
// (WalletSettings lives in this namespace.)
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Designer payouts with MANUAL settlement — the whole state machine.
 *
 * NOTHING here talks to a bank or a gateway: the admin transfers the money
 * outside the system and records the tracking number. The service's job is to
 * keep the ledger, the wallet balances and the request row consistent while
 * that happens.
 *
 *   pending ──approve──▶ approved ──pay (reference required)──▶ paid
 *      │                     │
 *      │                     └──reject (reason required)──▶ rejected
 *      └──cancel (designer, pending only)──▶ cancelled
 *
 * MONEY RULES (all under a wallet row lock inside one DB::transaction):
 *   - submitting a request HOLDS the money: balance −A, pending_balance +A
 *     (ledger `withdrawal_hold`);
 *   - cancelling or rejecting RELEASES it back: balance +A, pending −A
 *     (ledger `withdrawal_released`);
 *   - paying it clears the hold only (pending −A; the balance already lost the
 *     money at hold time) and stamps the manual payment reference.
 *
 * AT MOST ONE OPEN REQUEST per designer: the wallet row lock serializes two
 * simultaneous submissions, so the second one sees the first and is refused —
 * a designer can never hold the same money twice.
 */
class WithdrawalService
{
    public function __construct(private readonly WalletLedger $ledger)
    {
    }

    /* ------------------------------------------------------------------
     | Bank account (OTP-gated at the API layer)
     * ------------------------------------------------------------------ */

    /**
     * Register/change the payout account. The caller has ALREADY verified a
     * fresh OTP sent to the account's own phone (WalletController), because a
     * changed sheba plus a withdrawal is the highest-value attack here.
     */
    public function saveBankAccount(User $user, string $sheba, string $ownerName): DesignerBankAccount
    {
        $normalized = (string) Sheba::normalize($sheba);

        return DB::transaction(function () use ($user, $normalized, $ownerName): DesignerBankAccount {
            $account = DesignerBankAccount::query()->where('user_id', $user->id)->lockForUpdate()->first();

            if ($account === null) {
                $account = new DesignerBankAccount;
                $account->forceFill([
                    'user_id' => $user->id,
                    'sheba' => $normalized,
                    'owner_name' => $ownerName,
                    // First registration does NOT start the payout cooldown:
                    // it is OTP-gated already and an immediate first payout is
                    // the normal path for a new designer.
                    'bank_changed_at' => null,
                ])->save();

                return $account->refresh();
            }

            if ($account->sheba !== $normalized) {
                // Only a real ACCOUNT CHANGE starts the cooldown.
                $account->forceFill([
                    'sheba' => $normalized,
                    'owner_name' => $ownerName,
                    'bank_changed_at' => now(),
                ])->save();
            } else {
                $account->forceFill(['owner_name' => $ownerName])->save();
            }

            return $account->refresh();
        });
    }

    public function bankAccount(User $user): ?DesignerBankAccount
    {
        return DesignerBankAccount::query()->where('user_id', $user->id)->first();
    }

    /** When withdrawals unlock again after a bank-account change (null = open now). */
    public function bankCooldownUntil(User $user): ?Carbon
    {
        // The waiting window is an ADMIN setting (WalletSettings → the
        // `site_settings` table); config/wallet.php only supplies the default.
        $hours = WalletSettings::bankChangeCooldownHours();
        if ($hours <= 0) {
            return null;
        }

        $changedAt = $this->bankAccount($user)?->bank_changed_at;
        if ($changedAt === null) {
            return null;
        }

        $until = $changedAt->copy()->addHours($hours);

        return $until->isFuture() ? $until : null;
    }

    public function withdrawable(User $user): int
    {
        return Wallet::forUser($user->id)->withdrawable();
    }

    /* ------------------------------------------------------------------
     | Designer actions
     * ------------------------------------------------------------------ */

    /**
     * Submit a payout request. Holds the money immediately (ledger) and
     * snapshots the sheba/owner exactly as submitted.
     */
    public function submit(User $user, int $amountRial): WithdrawalRequest
    {
        return DB::transaction(function () use ($user, $amountRial): WithdrawalRequest {
            $wallet = Wallet::forUser($user->id);
            /** @var Wallet $wallet */
            $wallet = Wallet::query()->whereKey($wallet->id)->lockForUpdate()->firstOrFail();

            // Master switch: the admin can freeze SUBMISSIONS (bank problems,
            // fraud review). Open requests keep flowing through the admin
            // workflow — this only stops new ones.
            abort_unless(
                WalletSettings::withdrawalsEnabled(),
                422,
                'ثبت درخواست برداشت توسط مدیر موقتاً غیرفعال شده است؛ لطفاً بعداً تلاش کنید.',
            );

            $account = DesignerBankAccount::query()->where('user_id', $user->id)->first();
            abort_if($account === null, 422, 'ابتدا شماره شبای خود را در بخش کیف پول ثبت کنید.');

            // Written as an if (not abort_if with a sprintf argument) so the
            // message is only formatted when there IS a cooldown: sprintf
            // arguments are evaluated eagerly, which used to call faMoment(null)
            // on every ordinary request.
            $cooldownUntil = $this->bankCooldownUntil($user);
            if ($cooldownUntil !== null) {
                abort(422, sprintf(
                    'شماره شبای شما به‌تازگی تغییر کرده است؛ ثبت درخواست برداشت از %s امکان‌پذیر است.',
                    $this->faMoment($cooldownUntil),
                ));
            }

            // The minimum is an ADMIN setting (RIAL, like the ledger).
            $minimum = WalletSettings::minWithdrawalRial();
            abort_if($amountRial < $minimum, 422, sprintf(
                'حداقل مبلغ برداشت %s تومان است.',
                number_format(intdiv($minimum, 10)),
            ));

            $open = WithdrawalRequest::query()
                ->where('user_id', $user->id)
                ->whereIn('status', WithdrawalRequest::OPEN_STATUSES)
                ->exists();
            abort_if($open, 422, 'شما یک درخواست برداشت باز دارید؛ تا بررسی آن، درخواست جدیدی ثبت نمی‌شود.');

            $available = $wallet->withdrawable();
            abort_if($available <= 0 || $amountRial > $available, 422, sprintf(
                'مبلغ درخواستی از موجودی قابل برداشت (%s ریال) بیشتر است.',
                number_format(max(0, $available)),
            ));

            $request = new WithdrawalRequest;
            $request->forceFill([
                'user_id' => $user->id,
                'amount' => $amountRial,
                'sheba' => (string) $account->sheba,
                'owner_name' => (string) $account->owner_name,
                'status' => WithdrawalRequest::STATUS_PENDING,
                'requested_at' => now(),
            ]);
            $request->save();

            $this->ledger->hold(
                $user->id,
                "withdrawal:{$request->id}:hold",
                $amountRial,
                [
                    'reference_type' => WithdrawalRequest::class,
                    'reference_id' => $request->id,
                    'description' => 'نگه‌داشتن مبلغ درخواست برداشت #'.$request->id,
                ],
            );

            return $request->refresh();
        });
    }

    /** The designer changes their mind before an admin reviews it. */
    public function cancel(User $user, WithdrawalRequest $request): WithdrawalRequest
    {
        return DB::transaction(function () use ($user, $request): WithdrawalRequest {
            /** @var WithdrawalRequest $locked */
            $locked = WithdrawalRequest::query()->whereKey($request->id)->lockForUpdate()->firstOrFail();

            abort_unless((int) $locked->user_id === (int) $user->id, 403);
            abort_unless($locked->status === WithdrawalRequest::STATUS_PENDING, 422, 'تنها درخواست «در انتظار بررسی» قابل لغو است.');

            $locked->forceFill(['status' => WithdrawalRequest::STATUS_CANCELLED, 'reviewed_at' => now()])->save();

            $this->ledger->release($user->id, "withdrawal:{$locked->id}:release", (int) $locked->amount, [
                'reference_type' => WithdrawalRequest::class,
                'reference_id' => $locked->id,
                'description' => 'لغو درخواست برداشت #'.$locked->id.' توسط طراح',
            ]);

            return $locked->refresh();
        });
    }

    /* ------------------------------------------------------------------
     | Admin actions (manual settlement)
     * ------------------------------------------------------------------ */

    /**
     * Approve: the request enters the manual payout queue. The admin MAY name
     * an «تاریخ پیش‌بینی‌شدهٔ واریز»; when they do not, the estimate defaults to
     * now + the admin-configured settlement window, so the designer always sees
     * a date rather than an open-ended promise.
     */
    public function approve(
        User $admin,
        WithdrawalRequest $request,
        ?string $note = null,
        ?Carbon $expectedPaidAt = null,
    ): WithdrawalRequest {
        $estimate = $expectedPaidAt ?? WalletSettings::expectedPayoutAt();

        $updated = DB::transaction(function () use ($admin, $request, $note, $estimate): WithdrawalRequest {
            /** @var WithdrawalRequest $locked */
            $locked = WithdrawalRequest::query()->whereKey($request->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->status === WithdrawalRequest::STATUS_PENDING, 422, 'این درخواست در وضعیت «در انتظار بررسی» نیست.');

            $locked->forceFill([
                'status' => WithdrawalRequest::STATUS_APPROVED,
                'admin_id' => $admin->id,
                'admin_note' => $note,
                'expected_paid_at' => $estimate,
                'reviewed_at' => now(),
            ])->save();

            return $locked->refresh();
        });

        AuditTrail::record($admin->id, 'wallet.withdrawal_approved', WithdrawalRequest::class, $updated->id, [
            'amount_rial' => (int) $updated->amount,
            'expected_paid_at' => $updated->expected_paid_at?->toIso8601String(),
        ]);
        $this->notify(
            $updated,
            'درخواست برداشت تأیید شد',
            trim('درخواست برداشت شما تأیید شد و در صف پرداخت دستی قرار گرفت.'.(
                $updated->expected_paid_at === null
                    ? ''
                    : ' تاریخ پیش‌بینی‌شدهٔ واریز: '.$updated->expectedPaidJalali().'.'
            ).($note !== null && trim($note) !== '' ? ' یادداشت مدیر: '.trim($note) : '')),
        );

        return $updated;
    }

    /** Rejected (reason required): the held money returns to the balance. */
    public function reject(User $admin, WithdrawalRequest $request, string $reason): WithdrawalRequest
    {
        $updated = DB::transaction(function () use ($admin, $request, $reason): WithdrawalRequest {
            /** @var WithdrawalRequest $locked */
            $locked = WithdrawalRequest::query()->whereKey($request->id)->lockForUpdate()->firstOrFail();
            abort_if($locked->isTerminal(), 422, 'این درخواست در وضعیت پایانی است و تغییر نمی‌کند.');
            abort_unless(
                in_array($locked->status, WithdrawalRequest::OPEN_STATUSES, true),
                422,
                'این درخواست قابل رد کردن نیست.',
            );

            $locked->forceFill([
                'status' => WithdrawalRequest::STATUS_REJECTED,
                'admin_id' => $admin->id,
                'admin_note' => $reason,
                'reviewed_at' => now(),
            ])->save();

            $this->ledger->release((int) $locked->user_id, "withdrawal:{$locked->id}:release", (int) $locked->amount, [
                'reference_type' => WithdrawalRequest::class,
                'reference_id' => $locked->id,
                'description' => 'رد درخواست برداشت #'.$locked->id.' — بازگشت مبلغ',
                'created_by' => $admin->id,
            ]);

            return $locked->refresh();
        });

        AuditTrail::record($admin->id, 'wallet.withdrawal_rejected', WithdrawalRequest::class, $updated->id, [
            'amount_rial' => (int) $updated->amount,
            'has_reason' => false, // the reason itself stays on the row, never in the audit payload
        ]);
        $this->notify($updated, 'درخواست برداشت رد شد', 'درخواست برداشت شما رد شد و مبلغ آن به موجودی قابل برداشت بازگشت. دلیل: '.$reason);

        return $updated;
    }

    /**
     * The admin has paid MANUALLY (پایا / اینترنت‌بانک) and records the
     * tracking number. This is the only place money is declared settled, and
     * it is final.
     */
    public function markPaid(User $admin, WithdrawalRequest $request, string $reference): WithdrawalRequest
    {
        $updated = DB::transaction(function () use ($admin, $request, $reference): WithdrawalRequest {
            /** @var WithdrawalRequest $locked */
            $locked = WithdrawalRequest::query()->whereKey($request->id)->lockForUpdate()->firstOrFail();
            abort_if($locked->isTerminal(), 422, 'این درخواست در وضعیت پایانی است و تغییر نمی‌کند.');
            abort_unless(
                in_array($locked->status, WithdrawalRequest::OPEN_STATUSES, true),
                422,
                'این درخواست قابل پرداخت نیست.',
            );

            $locked->forceFill([
                'status' => WithdrawalRequest::STATUS_PAID,
                'admin_id' => $admin->id,
                'payment_reference' => $reference,
                'reviewed_at' => $locked->reviewed_at ?? now(),
                'paid_at' => now(),
            ])->save();

            $this->ledger->confirmPayout(
                (int) $locked->user_id,
                "withdrawal:{$locked->id}:paid",
                (int) $locked->amount,
                [
                    'reference_type' => WithdrawalRequest::class,
                    'reference_id' => $locked->id,
                    'description' => 'پرداخت دستی درخواست برداشت #'.$locked->id.' — پیگیری: '.$reference,
                    'created_by' => $admin->id,
                ],
            );

            return $locked->refresh();
        });

        AuditTrail::record($admin->id, 'wallet.withdrawal_paid', WithdrawalRequest::class, $updated->id, [
            'amount_rial' => (int) $updated->amount,
            'has_reference' => true,
        ]);
        $this->notify($updated, 'برداشت پرداخت شد', 'مبلغ درخواست برداشت شما به حساب ثبت‌شده واریز شد (شماره پیگیری: '.$reference.').');

        return $updated;
    }

    /**
     * Admin-only correction. The balance is NEVER edited directly: every
     * correction is an `adjustment` ledger row with a mandatory reason, so the
     * history explains itself.
     */
    public function adjust(User $admin, User $designer, int $amountRial, string $reason): ?WalletTransaction
    {
        $row = $this->ledger->adjust($designer->id, 'adjust:'.Str::uuid()->toString(), $amountRial, [
            'reference_type' => User::class,
            'reference_id' => $designer->id,
            'description' => 'اصلاح دستی کیف پول — '.$reason,
            'created_by' => $admin->id,
        ]);

        AuditTrail::record($admin->id, 'wallet.balance_adjusted', User::class, $designer->id, [
            'amount_rial' => $amountRial,
        ]);

        if ($row !== null) {
            $this->notifyFor(
                $designer->id,
                'کیف پول شما توسط پشتیبانی اصلاح شد',
                ($amountRial > 0 ? 'مبلغ ' : 'کسر ').number_format(abs($amountRial)).' ریال اعمال شد. دلیل: '.$reason,
                $row->id,
            );
        }

        return $row;
    }

    /* ------------------------------------------------------------------
     | Shared
     * ------------------------------------------------------------------ */

    private function notify(WithdrawalRequest $request, string $title, string $message): void
    {
        $this->notifyFor((int) $request->user_id, $title, $message, $request->id);
    }

    private function notifyFor(int $userId, string $title, string $message, int $relatedId): void
    {
        InternalNotification::create([
            'user_id' => $userId,
            'type' => 'wallet_withdrawal',
            'title' => $title,
            'message' => $message,
            'related_type' => WithdrawalRequest::class,
            'related_id' => $relatedId,
        ]);
    }

    /** Persian, human-readable moment for the cooldown message. */
    private function faMoment(Carbon $moment): string
    {
        $minutes = max(1, (int) ceil(now()->diffInMinutes($moment, false)));

        if ($minutes < 60) {
            return "{$minutes} دقیقه دیگر";
        }

        return max(1, (int) ceil($minutes / 60)).' ساعت دیگر';
    }
}
