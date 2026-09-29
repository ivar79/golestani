<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\PaymentTransaction;
use App\Models\Plan;
use App\Services\Payments\PaymentGatewayException;
use App\Services\Payments\PaymentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class PaymentController extends Controller
{
    /* -----------------------------------------------------------------
     | POST /api/businesses/{business}/payments/init  (auth: owner/admin)
     * ----------------------------------------------------------------- */

    public function init(Request $request, Business $business): JsonResponse
    {
        $this->authorizeOwner($request, $business);

        $data = $request->validate([
            // THE only client-controlled commercial input. Amount/currency/
            // duration are resolved from this plan row server-side.
            'plan_id' => ['required', 'integer', 'exists:plans,id'],
        ]);

        $plan = Plan::findOrFail($data['plan_id']);

        $result = app(PaymentService::class)->init($request->user(), $business, $plan);

        return response()->json([
            'transaction_id' => $result['transaction']->id,
            'authority' => $result['transaction']->authority,
            'redirect_url' => $result['redirect_url'],
            // Echo the SERVER-computed money snapshot for display only:
            'amount' => (int) $result['transaction']->amount,
            'currency' => $result['transaction']->currency,
        ], 201);
    }

    /* -----------------------------------------------------------------
     | GET /api/payments/callback  (PUBLIC — ZarinPal redirects the browser)
     * ----------------------------------------------------------------- */

    /**
     * SECURITY: no session is available here and none is required — identity
     * and money facts come from the transaction row + server-side verify.
     * The browser is redirected to the SPA result page afterwards; SPA has
     * no API contract here beyond status codes.
     */
    public function callback(Request $request): JsonResponse|RedirectResponse
    {
        $authority = (string) $request->query('Authority', '');
        $status = (string) $request->query('Status', '');

        if ($authority === '') {
            return response()->json(['status' => 'failed', 'failure_reason' => 'missing_authority'], 400);
        }

        try {
            $result = app(PaymentService::class)->handleCallback($authority, $status);
        } catch (PaymentGatewayException $e) {
            // Provider unreachable/timeout → row deliberately stays PENDING.
            Log::warning('payment gateway exception during callback', ['reason' => $e->reason]);

            return response()->json(['status' => 'pending', 'failure_reason' => 'provider_unreachable'], 503);
        }

        $row = $result['transaction'];

        // Send the browser to the SPA result page (works for real flows).
        $frontend = rtrim((string) config('business.frontend_url', ''), '/');

        if ($frontend !== '') {
            return redirect()->away($frontend.'/payment/result?authority='.urlencode($authority));
        }

        return response()->json([
            'status' => $row->status,
            'already_final' => $result['already_final'],
            'failure_reason' => $row->failure_reason,
        ]);
    }

    /* -----------------------------------------------------------------
     | GET /api/payments/status?authority=...  (auth: owner/admin — read-only)
     * ----------------------------------------------------------------- */

    public function status(Request $request): JsonResponse
    {
        $data = $request->validate([
            'authority' => ['required', 'string', 'max:64'],
        ]);

        $row = PaymentTransaction::where('authority', $data['authority'])->first();

        if ($row === null) {
            return response()->json(['status' => 'failed', 'failure_reason' => 'unknown_authority'], 404);
        }

        // Owner or admin only: user A can NEVER poll user B's payment.
        abort_unless($request->user()?->hasRole('admin') || $row->user_id === $request->user()?->id, 403);

        return response()->json(app(PaymentService::class)->statusFor($row));
    }

    private function authorizeOwner(Request $request, Business $business): void
    {
        abort_unless($request->user()?->hasRole('admin') || $business->user_id === $request->user()?->id, 403);
    }
}
