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

    public function store(Request $request, Business $business): JsonResponse
    {
        abort_unless($business->status === 'approved', 404);
        $data = $request->validate([
            'type' => ['required', Rule::in(self::TYPES)],
            'message' => ['required', 'string', 'min:5', 'max:2000'],
        ]);
        $report = $business->reports()->create($data + ['reporter_id' => $request->user()?->id]);
        return response()->json($report, 201);
    }

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', Rule::in(['open', 'reviewing', 'resolved', 'rejected'])],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = BusinessReport::with(['business:id,name,slug', 'reporter:id,phone'])->latest();
        if (! empty($data['status'])) $query->where('status', $data['status']);
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
