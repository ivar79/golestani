<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Wallet\AdjustWalletRequest;
use App\Http\Requests\Wallet\ModerateWithdrawalRequest;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WithdrawalRequest;
use App\Services\Wallet\WalletAdminReport;
use App\Services\Wallet\WalletSettings;
use App\Services\Wallet\WithdrawalService;
use App\Support\Jalali;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * ADMIN side of the manual settlement: review the payout queue, record the
 * manual bank transfer, and correct a balance through the ledger.
 *
 * Two rules this controller exists to enforce:
 *   1. money is declared settled ONLY with a `payment_reference` (proof the
 *      transfer happened outside the system), and paid/rejected are final;
 *   2. an admin can never edit a balance — the single write path is an
 *      `adjustment` ledger row with a mandatory reason.
 *
 * THE ESTIMATE: approving a request also records «تاریخ پیش‌بینی‌شدهٔ واریز»
 * (`expected_paid_at`). It defaults to the settlement window the admin
 * configured (App\Services\Wallet\WalletSettings), and it is NEVER the
 * settlement itself — `paid_at` + `payment_reference` are.
 *
 * CONCURRENCY: every state change happens inside the service under a row lock,
 * which is what makes "the other admin already paid/rejected this" a clear 422
 * (with the live status in the body) instead of a silently overwritten row.
 */
class AdminWithdrawalController extends Controller
{
    public function __construct(
        private readonly WithdrawalService $withdrawals,
        private readonly WalletAdminReport $report,
    ) {
    }

    /**
     * GET /api/admin/withdrawals — the payout queue.
     *
     * Filters: status, date range (from/to on `requested_at`), and a
     * name/phone/username search across the designer account.
     */
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', 'in:pending,approved,paid,rejected,cancelled'],
            'q' => ['nullable', 'string', 'max:60'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $page = WithdrawalRequest::query()
            ->with(['user:id,name,phone,username', 'admin:id,name'])
            ->when(isset($filters['status']), fn ($query) => $query->where('status', $filters['status']))
            ->when(isset($filters['q']) && trim($filters['q']) !== '', function ($query) use ($filters): void {
                $term = '%'.trim($filters['q']).'%';
                $query->whereHas('user', fn ($user) => $user
                    ->where('name', 'like', $term)
                    ->orWhere('phone', 'like', $term)
                    ->orWhere('username', 'like', $term));
            })
            ->when(isset($filters['from']), fn ($query) => $query->where('requested_at', '>=', Carbon::parse($filters['from'])->startOfDay()))
            // Inclusive end date: `to=2026-10-15` must include that whole day,
            // otherwise the filter silently drops the newest requests.
            ->when(isset($filters['to']), fn ($query) => $query->where('requested_at', '<=', Carbon::parse($filters['to'])->endOfDay()))
            ->orderByRaw("case when status = 'pending' then 0 when status = 'approved' then 1 else 2 end")
            ->orderByDesc('id')
            ->paginate((int) ($filters['per_page'] ?? 25));

        // One wallet query for the whole page: the queue shows each designer's
        // balance/debt/hold, and doing that per row would be N+1.
        $wallets = Wallet::query()
            ->whereIn('user_id', $page->getCollection()->pluck('user_id')->unique()->all())
            ->get()
            ->keyBy('user_id');

        return response()->json(
            $page->through(fn (WithdrawalRequest $row): array => $this->report->requestPayload($row, $wallets->get($row->user_id))),
        );
    }

    /** GET /api/admin/withdrawals/summary — the numbers behind the menu badge. */
    public function summary(): JsonResponse
    {
        $counts = WithdrawalRequest::query()
            ->selectRaw('status, count(*) as aggregate, coalesce(sum(amount), 0) as amount')
            ->groupBy('status')
            ->get()
            ->keyBy('status');

        $payload = [];
        foreach ([...WithdrawalRequest::OPEN_STATUSES, ...WithdrawalRequest::TERMINAL_STATUSES] as $status) {
            $row = $counts->get($status);

            $payload[$status] = [
                'count' => (int) ($row->aggregate ?? 0),
                'amount' => (int) ($row->amount ?? 0),
            ];
        }

        return response()->json([
            'statuses' => $payload,
            'pending' => $payload[WithdrawalRequest::STATUS_PENDING]['count'],
            'approved' => $payload[WithdrawalRequest::STATUS_APPROVED]['count'],
            'approved_amount' => $payload[WithdrawalRequest::STATUS_APPROVED]['amount'],
            // Enough for a batch payout run without a second round-trip.
            'awaiting_payment_amount' => $payload[WithdrawalRequest::STATUS_PENDING]['amount']
                + $payload[WithdrawalRequest::STATUS_APPROVED]['amount'],
            'settlement' => WalletSettings::settlementPayload(),
        ]);
    }

    /**
     * GET /api/admin/withdrawals/{withdrawal} — one request in full: identity,
     * the complete sheba, the designer's money (balance, debt, commissions) and
     * the ledger history the decision has to be based on.
     */
    public function show(WithdrawalRequest $withdrawal): JsonResponse
    {
        $withdrawal->loadMissing(['user:id,name,phone,username', 'admin:id,name']);

        return response()->json([
            'request' => $this->report->requestPayload($withdrawal),
            'designer' => $this->report->designerPayload($withdrawal->user),
            'wallet' => $this->report->walletPayload((int) $withdrawal->user_id),
            'commissions' => $this->report->commissionPayload((int) $withdrawal->user_id),
            'ledger' => $this->report->ledgerPayload((int) $withdrawal->user_id, 25),
            'other_requests' => WithdrawalRequest::query()
                ->where('user_id', $withdrawal->user_id)
                ->whereKeyNot($withdrawal->id)
                ->orderByDesc('id')
                ->limit(5)
                ->get()
                ->map(fn (WithdrawalRequest $row): array => [
                    'id' => $row->id,
                    'amount' => (int) $row->amount,
                    'status' => $row->status,
                    'status_label' => $this->report->statusLabel((string) $row->status),
                    'requested_at' => $row->requested_at?->toISOString(),
                ])->all(),
            'settlement' => WalletSettings::settlementPayload(),
        ]);
    }

    /** PATCH /api/admin/withdrawals/{withdrawal} — approve / reject / mark paid. */
    public function moderate(ModerateWithdrawalRequest $request, WithdrawalRequest $withdrawal): JsonResponse
    {
        $admin = $request->user();
        $action = (string) $request->validated('action');

        $expected = $request->validated('expected_paid_at');
        $expectedAt = is_string($expected) && trim($expected) !== '' ? Carbon::parse($expected) : null;
        abort_if($expectedAt !== null && $expectedAt->isBefore(now()->startOfDay()), 422, 'تاریخ پیش‌بینی‌شدهٔ واریز نمی‌تواند در گذشته باشد.');

        $updated = match ($action) {
            'approve' => $this->withdrawals->approve($admin, $withdrawal, $request->validated('admin_note'), $expectedAt),
            'reject' => $this->withdrawals->reject($admin, $withdrawal, (string) $request->validated('admin_note')),
            'pay' => $this->withdrawals->markPaid($admin, $withdrawal, (string) $request->validated('payment_reference')),
        };

        // The response carries the FRESH row FLATTENED at the top level (the
        // historical client contract — `status` is read directly) plus the
        // enriched money context the detail screen re-renders from, so two
        // admins acting on the same request both end up on the winning state
        // (the loser gets the service's 422 with the live status in it).
        return response()->json(
            $this->report->requestPayload($updated->loadMissing(['user:id,name,phone,username', 'admin:id,name'])) + [
                'wallet' => $this->report->walletPayload((int) $updated->user_id),
                'commissions' => $this->report->commissionPayload((int) $updated->user_id),
                'ledger' => $this->report->ledgerPayload((int) $updated->user_id, 25),
            ],
        );
    }

    /**
     * GET /api/admin/withdrawals/export — the batch-payment CSV (approved
     * requests by default): holder name, full sheba and the amount, which is
     * exactly what an admin pasting a payout run into اینترنت‌بانک needs.
     *
     * The file is UTF-8 WITH a BOM so Excel does not mangle Persian names, and
     * every cell is prefixed with a tab where needed to keep long sheba values
     * from being read as numbers in scientific notation.
     */
    public function export(Request $request): StreamedResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', 'in:pending,approved,paid,rejected,cancelled'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);
        $status = $filters['status'] ?? WithdrawalRequest::STATUS_APPROVED;

        $rows = WithdrawalRequest::query()
            ->with('user:id,name,phone,username')
            ->where('status', $status)
            ->when(isset($filters['from']), fn ($query) => $query->where('requested_at', '>=', Carbon::parse($filters['from'])->startOfDay()))
            ->when(isset($filters['to']), fn ($query) => $query->where('requested_at', '<=', Carbon::parse($filters['to'])->endOfDay()))
            ->orderBy('id')
            ->get();

        $filename = sprintf('withdrawals-%s-%s.csv', $status, Jalali::compact(now()));
        $generatedAt = now();

        return response()->streamDownload(function () use ($rows, $generatedAt): void {
            $out = fopen('php://output', 'w');

            fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM for Excel

            fputcsv($out, ['ردیف', 'نام صاحب حساب', 'شماره شبا', 'مبلغ (ریال)', 'مبلغ (تومان)', 'شناسه درخواست', 'تاریخ درخواست', 'موبایل طراح', 'وضعیت']);
            fputcsv($out, ['گزارش تسویه', '', '', '', '', '', Jalali::format($generatedAt), '', (string) count($rows).' درخواست']);

            foreach ($rows as $index => $row) {
                fputcsv($out, [
                    $index + 1,
                    (string) $row->owner_name,
                    (string) $row->sheba,
                    (int) $row->amount,
                    intdiv((int) $row->amount, 10),
                    (int) $row->id,
                    Jalali::format($row->requested_at ?? $row->created_at) ?? '',
                    (string) ($row->user?->phone ?? ''),
                    $this->report->statusLabel((string) $row->status),
                ]);
            }

            fclose($out);
        }, $filename, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'no-store, no-cache, must-revalidate',
        ]);
    }

    /**
     * POST /api/admin/wallets/{user}/adjust — the ONLY way an admin moves a
     * balance, always through the ledger with a mandatory reason.
     */
    public function adjust(AdjustWalletRequest $request, User $user): JsonResponse
    {
        $row = $this->withdrawals->adjust(
            $request->user(),
            $user,
            (int) $request->validated('amount'),
            (string) $request->validated('reason'),
        );

        return response()->json([
            'transaction_id' => $row?->id,
            'created' => $row !== null,
            'wallet' => $this->report->walletPayload($user->id),
            'ledger' => $this->report->ledgerPayload($user->id, 25),
        ], $row === null ? 200 : 201);
    }
}
