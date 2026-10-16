<?php

namespace App\Http\Controllers\Api\Designer;

use App\Http\Controllers\Controller;
use App\Http\Requests\Wallet\StoreBankAccountRequest;
use App\Http\Requests\Wallet\StoreWithdrawalRequest;
use App\Models\DesignerBankAccount;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Models\WithdrawalRequest;
use App\Services\Auth\OtpService;
use App\Services\Sms\Contracts\SmsServiceInterface;
use App\Services\Wallet\WalletSettings;
use App\Services\Wallet\WithdrawalService;
use App\Support\Sheba;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

/**
 * The DESIGNER'S OWN wallet. Every endpoint resolves the actor from the token
 * (`$request->user()`) and never accepts a user id, so there is no way to read
 * or move somebody else's money through this controller.
 *
 * Settlements are MANUAL: nothing here contacts a bank or a gateway — the
 * designer requests a payout and an admin pays it outside the system.
 */
class WalletController extends Controller
{
    /** OTP purpose namespace — a login code can never satisfy it. */
    private const OTP_PURPOSE = 'bank_account';

    public function __construct(
        private readonly WithdrawalService $withdrawals,
        private readonly OtpService $otp,
        private readonly SmsServiceInterface $sms,
    ) {
    }

    /** GET /api/designer/wallet — balances, payout account and open request. */
    public function show(Request $request): JsonResponse
    {
        $user = $request->user();
        $wallet = Wallet::forUser($user->id);

        return response()->json([
            'wallet' => [
                'balance' => (int) $wallet->balance,
                'pending_balance' => (int) $wallet->pending_balance,
                'withdrawable' => $wallet->withdrawable(),
                'currency' => 'IRR',
            ],
            'min_amount_rial' => WalletSettings::minWithdrawalRial(),
            // The admin-configured payout contract: what "تسویه" means, how long
            // it takes, and whether new requests are currently accepted. The
            // designer page renders this verbatim (never hardcoded copy).
            'settlement' => WalletSettings::settlementPayload(),
            'bank_account' => $this->bankAccountPayload($user, $this->withdrawals->bankAccount($user)),
            'open_request' => $this->openRequestPayload($user),
        ]);
    }

    /** GET /api/designer/wallet/transactions — the append-only ledger. */
    public function transactions(Request $request): JsonResponse
    {
        $data = $request->validate([
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $wallet = Wallet::forUser($request->user()->id);

        return response()->json(
            WalletTransaction::query()
                ->where('wallet_id', $wallet->id)
                ->orderByDesc('id')
                ->paginate(25)
                ->through(fn (WalletTransaction $row): array => [
                    'id' => $row->id,
                    'type' => $row->type,
                    'amount' => (int) $row->amount,
                    'balance_after' => (int) $row->balance_after,
                    'description' => $row->description,
                    'subscription_id' => $row->subscription_id,
                    'created_at' => $row->created_at?->toISOString(),
                ]),
        );
    }

    /**
     * POST /api/designer/wallet/bank-account/otp — send a code to the
     * designer's OWN phone before a sheba is registered or changed.
     */
    public function requestBankAccountOtp(Request $request): JsonResponse
    {
        $user = $request->user();
        $phone = (string) $user->phone;
        abort_if($phone === '', 422, 'شماره موبایل شما ثبت نشده است؛ با پشتیبانی تماس بگیرید.');

        if (! $this->otp->canSendFor(self::OTP_PURPOSE, (string) $user->id)) {
            return response()->json([
                'message' => 'تعداد درخواست‌های ارسال کد بیش از حد مجاز است. لطفاً ۱۰ دقیقه دیگر تلاش کنید.',
            ], 429);
        }

        $code = $this->otp->generateCode();
        $this->otp->storeCodeFor(self::OTP_PURPOSE, (string) $user->id, $code);
        $this->otp->incrementSendCountFor(self::OTP_PURPOSE, (string) $user->id);

        try {
            $this->sms->send($phone, "کد تأیید ثبت شبا: {$code}");
        } catch (Throwable $e) {
            // Delivery failed: never leave a usable code behind, and refund the
            // send slot (same policy as the login OTP flow).
            $this->otp->discardFailedSendFor(self::OTP_PURPOSE, (string) $user->id);
            report($e);

            return response()->json([
                'message' => 'ارسال پیامک موقتاً ممکن نیست. لطفاً چند لحظه دیگر دوباره تلاش کنید.',
            ], 503);
        }

        return response()->json([
            'message' => 'کد تأیید به شماره موبایل شما ارسال شد',
            'expires_in' => OtpService::TTL_SECONDS,
        ]);
    }

    /** PUT /api/designer/wallet/bank-account — register or change the payout sheba. */
    public function saveBankAccount(StoreBankAccountRequest $request): JsonResponse
    {
        $user = $request->user();
        $subject = (string) $user->id;

        if (! $this->otp->canVerifyFor(self::OTP_PURPOSE, $subject)) {
            return response()->json([
                'message' => 'تعداد تلاش‌های ناموفق زیاد بوده است؛ ۱۵ دقیقه دیگر دوباره تلاش کنید.',
            ], 429);
        }

        if (! $this->otp->verifyCodeFor(self::OTP_PURPOSE, $subject, (string) $request->validated('code'))) {
            $this->otp->incrementAttemptsFor(self::OTP_PURPOSE, $subject);

            return response()->json(['message' => 'کد تأیید نامعتبر یا منقضی شده است.'], 422);
        }

        $this->otp->clearAttemptsFor(self::OTP_PURPOSE, $subject);

        $account = $this->withdrawals->saveBankAccount(
            $user,
            (string) $request->validated('sheba'),
            (string) $request->validated('owner_name'),
        );

        return response()->json($this->bankAccountPayload($user, $account));
    }

    /** GET /api/designer/wallet/withdrawals — own payout history. */
    public function withdrawalHistory(Request $request): JsonResponse
    {
        $request->validate(['status' => ['nullable', 'in:pending,approved,paid,rejected,cancelled']]);
        $status = $request->input('status');

        return response()->json(
            WithdrawalRequest::query()
                ->where('user_id', $request->user()->id)
                ->when($status !== null, fn ($q) => $q->where('status', $status))
                ->orderByDesc('id')
                ->paginate(25)
                ->through(fn (WithdrawalRequest $row): array => $this->withdrawalPayload($row)),
        );
    }

    /**
     * POST /api/designer/wallet/withdrawals — request a payout. The amount is
     * held immediately; only the OWN registered sheba is ever used.
     */
    public function storeWithdrawal(StoreWithdrawalRequest $request): JsonResponse
    {
        $withdrawal = $this->withdrawals->submit($request->user(), (int) $request->validated('amount'));

        return response()->json($this->withdrawalPayload($withdrawal), 201);
    }

    /** DELETE /api/designer/wallet/withdrawals/{withdrawal} — cancel while pending. */
    public function cancelWithdrawal(Request $request, WithdrawalRequest $withdrawal): JsonResponse
    {
        return response()->json($this->withdrawalPayload($this->withdrawals->cancel($request->user(), $withdrawal)));
    }

    private function bankAccountPayload(User $user, ?DesignerBankAccount $account): ?array
    {
        if ($account === null) {
            return null;
        }

        $cooldownUntil = $this->withdrawals->bankCooldownUntil($user);

        return [
            // The owner sees their own full sheba (it is their money address).
            'sheba' => (string) $account->sheba,
            'sheba_masked' => (string) Sheba::mask($account->sheba),
            'owner_name' => (string) $account->owner_name,
            'bank_changed_at' => $account->bank_changed_at?->toISOString(),
            'withdrawable_from' => $cooldownUntil?->toISOString(),
        ];
    }

    private function openRequestPayload(User $user): ?array
    {
        $open = WithdrawalRequest::query()
            ->where('user_id', $user->id)
            ->whereIn('status', WithdrawalRequest::OPEN_STATUSES)
            ->latest('id')
            ->first();

        return $open === null ? null : $this->withdrawalPayload($open);
    }

    private function withdrawalPayload(WithdrawalRequest $row): array
    {
        return [
            'id' => $row->id,
            'amount' => (int) $row->amount,
            'status' => $row->status,
            'sheba' => (string) $row->sheba,
            'sheba_masked' => $row->maskedSheba(),
            'owner_name' => (string) $row->owner_name,
            'admin_note' => $row->admin_note,
            'payment_reference' => $row->payment_reference,
            'requested_at' => $row->requested_at?->toISOString(),
            'reviewed_at' => $row->reviewed_at?->toISOString(),
            'paid_at' => $row->paid_at?->toISOString(),
            // The admin's estimate of the manual transfer (approval time + the
            // configured settlement window) — shown on the designer's page and
            // announced in the approval notification.
            'expected_paid_at' => $row->expected_paid_at?->toISOString(),
            'expected_paid_at_jalali' => $row->expectedPaidJalali(),
        ];
    }
}
