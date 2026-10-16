<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WithdrawalRequest;
use App\Services\Wallet\WalletAdminReport;
use App\Services\Wallet\WalletSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The ADMIN's money console: the settlement knobs (which used to live in
 * config/wallet.php), every designer's wallet, and the sales/attribution report
 * the commission percentages are tuned against.
 *
 * READ-ONLY EXCEPT SETTINGS: nothing here moves money. Balances change only
 * through WalletLedger (commission accrual, withdrawal hold/pay, and the single
 * audited adjustment endpoint in AdminWithdrawalController).
 *
 * SETTINGS ARE AUDITED: each changed key writes its own `audit_events` row with
 * old → new, so «چه کسی حداقل برداشت را عوض کرد» has an answer.
 */
class AdminWalletController extends Controller
{
    public function __construct(private readonly WalletAdminReport $report)
    {
    }

    /** GET /api/admin/wallet/settings — the editable settlement contract. */
    public function settings(): JsonResponse
    {
        return response()->json($this->settingsPayload());
    }

    /**
     * PUT /api/admin/wallet/settings — save the knobs.
     *
     * The money field arrives in TOMAN (the unit the admin thinks in) and is
     * stored in RIAL (the unit the ledger uses) — the ×10 lives here and
     * nowhere else on this path.
     */
    public function saveSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'values' => ['required', 'array'],
            'values.settlement_note' => ['nullable', 'string', 'max:500'],
            'values.settlement_days' => ['required', 'integer', 'min:0', 'max:90'],
            'values.min_amount_toman' => ['required', 'integer', 'min:0', 'max:99999999999'],
            'values.bank_change_cooldown_hours' => ['required', 'integer', 'min:0', 'max:720'],
            'values.withdrawals_enabled' => ['required', 'boolean'],
        ], [
            'values.settlement_days.required' => 'زمان پیش‌فرض تسویه را وارد کنید.',
            'values.settlement_days.integer' => 'زمان تسویه باید یک عدد صحیح (روز) باشد.',
            'values.settlement_days.max' => 'زمان تسویه نمی‌تواند بیش از ۹۰ روز باشد.',
            'values.min_amount_toman.required' => 'حداقل مبلغ برداشت را وارد کنید.',
            'values.min_amount_toman.integer' => 'حداقل مبلغ برداشت باید یک عدد صحیح (تومان) باشد.',
            'values.bank_change_cooldown_hours.required' => 'مدت انتظار پس از تغییر شبا را وارد کنید.',
            'values.bank_change_cooldown_hours.max' => 'مدت انتظار نمی‌تواند بیش از ۷۲۰ ساعت (۳۰ روز) باشد.',
            'values.withdrawals_enabled.required' => 'وضعیت فعال‌بودن ثبت درخواست برداشت را مشخص کنید.',
        ]);

        $values = $data['values'];

        $changed = WalletSettings::save([
            WalletSettings::KEY_SETTLEMENT_NOTE => $values['settlement_note'] ?? '',
            WalletSettings::KEY_SETTLEMENT_DAYS => (int) $values['settlement_days'],
            // toman (input) → rial (ledger/config unit)
            WalletSettings::KEY_MIN_WITHDRAWAL_RIAL => (int) $values['min_amount_toman'] * 10,
            WalletSettings::KEY_BANK_CHANGE_COOLDOWN_HOURS => (int) $values['bank_change_cooldown_hours'],
            WalletSettings::KEY_WITHDRAWALS_ENABLED => (bool) $values['withdrawals_enabled'],
        ], $request->user());

        return response()->json($this->settingsPayload() + [
            'changed' => $changed,
            'saved' => $changed !== [],
        ]);
    }

    /**
     * GET /api/admin/wallet/designers — sales/attribution report + wallets.
     *
     * Rows are users who are designers, have a wallet or have registered a
     * payout account: exactly the people who can appear in the payout queue.
     */
    public function designers(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:60'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $base = User::query()
            ->with(['designer:id,user_id,display_name,status,referral_code'])
            ->where(function ($query): void {
                $query->whereHas('roles', fn ($roles) => $roles->where('name', 'designer'))
                    ->orWhereHas('wallet')
                    ->orWhereHas('bankAccount');
            })
            ->when(isset($filters['q']) && trim($filters['q']) !== '', function ($query) use ($filters): void {
                $term = '%'.trim($filters['q']).'%';
                $query->where(fn ($user) => $user
                    ->where('name', 'like', $term)
                    ->orWhere('phone', 'like', $term)
                    ->orWhere('username', 'like', $term));
            });

        $rows = (clone $base)
            ->orderBy('id')
            ->paginate((int) ($filters['per_page'] ?? 25))
            ->through(fn (User $user): array => $this->designerRow($user));

        // Page-level totals over the SAME filter — the panel shows the money at
        // stake without summing rows client-side (which would only sum one page).
        $walletTotals = Wallet::query()
            ->whereIn('user_id', (clone $base)->select('id'))
            ->selectRaw('coalesce(sum(balance), 0) as balance, coalesce(sum(pending_balance), 0) as pending_balance')
            ->first();

        $openRequests = WithdrawalRequest::query()
            ->whereIn('user_id', (clone $base)->select('id'))
            ->whereIn('status', WithdrawalRequest::OPEN_STATUSES)
            ->selectRaw('count(*) as aggregate, coalesce(sum(amount), 0) as amount')
            ->first();

        return response()->json($rows->toArray() + [
            'totals' => [
                'balance_rial' => (int) ($walletTotals->balance ?? 0),
                'pending_balance_rial' => (int) ($walletTotals->pending_balance ?? 0),
                'open_requests' => (int) ($openRequests->aggregate ?? 0),
                'open_requests_rial' => (int) ($openRequests->amount ?? 0),
            ],
        ]);
    }

    /** GET /api/admin/wallet/designers/{user} — one designer's full money page. */
    public function designer(Request $request, User $user): JsonResponse
    {
        $request->validate(['ledger_limit' => ['nullable', 'integer', 'min:5', 'max:200']]);
        $limit = (int) $request->input('ledger_limit', 50);

        return response()->json([
            'designer' => $this->report->designerPayload($user),
            'wallet' => $this->report->walletPayload($user->id),
            'commissions' => $this->report->commissionPayload($user->id),
            'ledger' => $this->report->ledgerPayload($user->id, $limit),
            'withdrawals' => WithdrawalRequest::query()
                ->where('user_id', $user->id)
                ->orderByDesc('id')
                ->limit(20)
                ->get()
                ->map(fn (WithdrawalRequest $row): array => $this->report->requestPayload($row))
                ->all(),
            'businesses' => Business::query()
                ->where('user_id', $user->id)
                ->orWhereIn('designer_id', function ($query) use ($user): void {
                    $query->select('id')->from('designers')->where('user_id', $user->id);
                })
                ->orderByDesc('id')
                ->limit(20)
                ->get(['id', 'name', 'status', 'designer_id', 'user_id'])
                ->map(fn (Business $business): array => [
                    'id' => $business->id,
                    'name' => $business->name,
                    'status' => $business->status,
                    'role' => (int) $business->user_id === (int) $user->id ? 'owner' : 'designer',
                ])->all(),
            'settlement' => WalletSettings::settlementPayload(),
        ]);
    }

    /** @return array<string, mixed> */
    private function designerRow(User $user): array
    {
        $commissions = $this->report->commissionPayload($user->id);

        return [
            'id' => $user->id,
            'name' => $user->name,
            'phone' => $user->phone,
            'username' => $user->username,
            'designer_status' => $user->designer_status,
            'display_name' => $user->designer?->display_name,
            'referral_code' => $user->designer?->referral_code,
            'wallet' => $this->report->walletPayload($user->id),
            'commissions' => $commissions,
            'attributed_businesses' => $user->designer === null
                ? 0
                : Business::query()->where('designer_id', $user->designer->id)->count(),
            'owned_businesses' => Business::query()->where('user_id', $user->id)->count(),
            'open_requests' => WithdrawalRequest::query()
                ->where('user_id', $user->id)
                ->whereIn('status', WithdrawalRequest::OPEN_STATUSES)
                ->count(),
        ];
    }

    /** @return array<string, mixed> */
    private function settingsPayload(): array
    {
        $panel = array_map(function (array $row): array {
            if ($row['key'] === WalletSettings::KEY_MIN_WITHDRAWAL_RIAL) {
                // The panel edits TOMAN; the stored value stays RIAL.
                $row['value_toman'] = intdiv((int) $row['value'], 10);
                $row['default_toman'] = intdiv((int) $row['default'], 10);
            }

            return $row;
        }, WalletSettings::panel());

        return [
            'settings' => $panel,
            'settlement' => WalletSettings::settlementPayload(),
            'updated_by' => null,
        ];
    }
}
