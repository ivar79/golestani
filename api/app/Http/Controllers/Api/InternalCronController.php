<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SubscriptionSweep;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * EXTERNAL SCHEDULER TRIGGER (Phase 5 finding A).
 *
 * The API runs on Render's FREE web-service plan, which has no scheduler:
 * Laravel's `withSchedule()` registration is inert unless a process runs
 * `schedule:run`/`schedule:work`. Render Cron Job services start at $1/month
 * (render.com/docs/cronjobs) and the blueprint deliberately stays on free
 * compute, so the deployed environment needs an OUTSIDE trigger that can call
 * the real sweep over HTTP.
 *
 * This endpoint is that trigger. It runs the exact code the artisan command
 * runs (SubscriptionSweep) and is the ONLY internal entry point, so there is
 * no second expiry implementation to drift.
 *
 * Guard rails:
 *  - Fail closed: if CRON_TOKEN is not configured the route answers 404 — an
 *    unconfigured deployment exposes no unauthenticated write endpoint.
 *  - Shared secret compared with hash_equals (constant time), sent as the
 *    `X-Cron-Token` header. A wrong or missing token is a 403.
 *  - POST only (a read-only GET can never trigger a write), throttled.
 *  - Never returns business names, user ids or any customer data — only the
 *    count of rows this run transitioned.
 *  - Idempotent by construction (see SubscriptionLifecycle::markExpired), so a
 *    retry, an overlapping trigger, or a scheduler racing a user request is
 *    harmless.
 */
class InternalCronController extends Controller
{
    public function expireSubscriptions(Request $request, SubscriptionSweep $sweep): JsonResponse
    {
        $expected = trim((string) config('app.cron_token'));

        // Unconfigured => the endpoint does not exist as far as the outside
        // world is concerned (and never becomes an open write path).
        if ($expected === '') {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $provided = (string) $request->header('X-Cron-Token', '');

        if ($provided === '' || ! hash_equals($expected, $provided)) {
            // Deliberately vague: a probing client learns nothing about
            // whether the token was absent, empty or simply wrong.
            Log::warning('internal_cron.rejected', ['ip' => $request->ip()]);

            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $expired = $sweep->run();

        return response()->json([
            'ok' => true,
            'expired' => $expired,
        ]);
    }
}
