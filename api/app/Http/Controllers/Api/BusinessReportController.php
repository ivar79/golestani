<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\BusinessReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class BusinessReportController extends Controller
{
    private const TYPES = ['incorrect_data', 'duplicate', 'closed', 'abuse', 'other'];

    /**
     * Statuses that mean the report is STILL in the queue. `open` is the
     * creation default and `reviewing` is what admin moderation sets while it
     * is being worked on — both are "active". `resolved` and `rejected` are
     * terminal, so reporting the same issue again afterwards is legitimate.
     */
    private const ACTIVE_STATUSES = ['open', 'reviewing'];

    /** How long an identical active report blocks a duplicate. */
    private const DUPLICATE_WINDOW_HOURS = 24;

    public function store(Request $request, Business $business): JsonResponse
    {
        abort_unless($business->status === 'approved', 404);
        $data = $request->validate([
            'type' => ['required', Rule::in(self::TYPES)],
            'message' => ['required', 'string', 'min:5', 'max:2000'],
        ]);

        $userId = (int) $request->user()->id;

        // Anti-abuse (audit finding `reports-endpoint-unbounded-writes`): the
        // SAME reporter cannot stack identical reports on the same business
        // while an earlier one is still active. This is NOT a silent drop —
        // the response names the existing report so the client can point at
        // it, and no row is created. The route-level throttle (5/hour per
        // user, api/routes/api.php) bounds the total write volume; this guard
        // bounds duplicate queue noise. Neither weakens validation: the
        // payload is validated BEFORE any of this runs.
        $existing = $business->reports()
            ->where('reporter_id', $userId)
            ->where('type', $data['type'])
            ->whereIn('status', self::ACTIVE_STATUSES)
            ->where('created_at', '>=', now()->subHours(self::DUPLICATE_WINDOW_HOURS))
            ->first();

        if ($existing !== null) {
            return response()->json([
                'message' => 'گزارش شما برای این کسب‌وکار در حال بررسی است؛ ارسال دوباره لازم نیست.',
                'report_id' => $existing->id,
                'report' => $existing,
            ], 409);
        }

        $report = $business->reports()->create($data + ['reporter_id' => $userId]);

        return response()->json($report, 201);
    }

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(['open', 'reviewing', 'resolved', 'rejected'])],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = BusinessReport::with(['business:id,name,slug', 'reporter:id,phone'])->latest();
        if (! empty($data['status'])) {
            $query->where('status', $data['status']);
        }

        return response()->json($query->paginate(30));
    }

    public function moderate(Request $request, BusinessReport $report): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(['reviewing', 'resolved', 'rejected'])],
            'admin_note' => ['nullable', 'string', 'max:1000'],
        ]);
        $report->update($data);

        return response()->json($report->fresh(['business:id,name,slug', 'reporter:id,phone']));
    }
}
