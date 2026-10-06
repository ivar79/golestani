<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Subscription\SubscriptionRequest;
use App\Models\Business;
use App\Models\InternalNotification;
use App\Models\Plan;
use App\Models\Subscription;
use App\Services\FeatureGate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class SubscriptionController extends Controller
{
    /* -----------------------------------------------------------------
     | Public pricing data — everything rendered comes from the DB or
     | config, never from frontend constants (price hardcode ban).
     * ----------------------------------------------------------------- */

    /** GET /api/plans — public pricing page payload. */
    public function plans(): JsonResponse
    {
        $freeTier = FeatureGate::freeTier();

        return response()->json([
            'free_tier' => $freeTier,
            'labels' => collect(FeatureGate::catalog())
                ->map(fn (array $entry) => ['label' => $entry[1], 'type' => $entry[0], 'group' => $entry[2]]),
            'plans' => Plan::public()->get(),
        ]);
    }

    /* -----------------------------------------------------------------
     | Admin plan management — Plan as product configuration.
     * ----------------------------------------------------------------- */

    public function adminPlans(): JsonResponse
    {
        return response()->json(Plan::orderBy('sort_order')->orderBy('price')->get());
    }

    /**
     * Validate a features/limits payload against the entitlement catalog:
     * unknown keys and wrong types are REJECTED (never silently stored), so
     * a typo in admin UI can never accidentally grant or revoke anything.
     */
    private function validatedFeatures($features): array
    {
        if ($features === null) {
            return [];
        }
        if (! is_array($features)) {
            abort(422, 'فرمت امکانات نامعتبر است.');
        }

        $clean = [];
        foreach ($features as $key => $value) {
            $entry = FeatureGate::catalog()[$key] ?? null;
            if ($entry === null) {
                abort(422, "قابلیت ناشناخته: {$key}");
            }
            [$type] = $entry;
            $clean[$key] = match ($type) {
                'bool' => (bool) $value,
                'int' => $value === null ? null : max(0, (int) $value),
                'list' => is_array($value)
                    ? array_values(array_filter($value, 'is_scalar'))
                    : abort(422, "مقدار قابلیت {$key} باید آرایه باشد."),
                default => abort(422, "نوع قابلیت {$key} پشتیبانی نمی‌شود."),
            };
        }

        return $clean;
    }

    public function storePlan(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:100'],
            'slug' => ['nullable', 'string', 'max:120', 'regex:/^[a-z0-9-]+$/i', 'unique:plans,slug'],
            'description' => ['nullable', 'string', 'max:1000'],
            'price' => ['required', 'integer', 'min:0'],
            'currency' => ['nullable', 'string', 'max:10'],
            'duration_days' => ['required', 'integer', 'min:1'],
            'features' => ['nullable', 'array'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:65535'],
            // Upgrade/downgrade order (payment era). Null = fall back to price.
            'tier' => ['nullable', 'integer', 'min:0', 'max:65535'],
            'is_featured' => ['sometimes', 'boolean'],
            'is_public' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        $data['features'] = $this->validatedFeatures($data['features'] ?? null);
        $data['currency'] = strtoupper($data['currency'] ?? 'IRR');
        $data['slug'] = $data['slug'] ?? $this->uniqueSlug($data['name']);

        return response()->json(Plan::create($data), 201);
    }

    public function updatePlan(Request $request, Plan $plan): JsonResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'max:100'],
            'slug' => ['prohibited'], // identity is immutable after creation
            'description' => ['nullable', 'string', 'max:1000'],
            'price' => ['sometimes', 'integer', 'min:0'],
            'currency' => ['sometimes', 'string', 'max:10'],
            'duration_days' => ['sometimes', 'integer', 'min:1'],
            'features' => ['sometimes', 'nullable', 'array'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:65535'],
            'tier' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:65535'],
            'is_featured' => ['sometimes', 'boolean'],
            'is_public' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        unset($data['slug']);

        if (array_key_exists('features', $data)) {
            // IMPORTANT: editing a plan's features applies to NEW purchases
            // only — active subscriptions keep their snapshot
            // (POLICY snapshot_entitlements).
            $data['features'] = $this->validatedFeatures($data['features'] ?? []);
        }
        if (isset($data['currency'])) {
            $data['currency'] = strtoupper($data['currency']);
        }

        $plan->update($data);

        return response()->json($plan->fresh());
    }

    public function destroyPlan(Plan $plan): JsonResponse
    {
        abort_if($plan->subscriptions()->exists(), 422, 'پلنی که سابقه اشتراک دارد قابل حذف نیست؛ آن را غیرفعال کنید.');
        $plan->delete();

        return response()->json(['message' => 'پلن حذف شد.']);
    }

    /** GET /admin/entitlements/catalog — drives the admin entitlement editor. */
    public function catalog(): JsonResponse
    {
        $catalog = collect(FeatureGate::catalog())->map(fn (array $entry, string $key) => [
            'key' => $key,
            'type' => $entry[0],
            'label' => $entry[1],
            'group' => $entry[2],
            'free_value' => $entry[3],
        ])->values();

        return response()->json([
            'catalog' => $catalog,
            'free_tier' => FeatureGate::freeTier(),
            'policies' => Config('entitlements.policies'),
        ]);
    }

    /* -----------------------------------------------------------------
     | Subscription lifecycle (manual receipt flow — payment gateway
     | connects later at exactly this boundary).
     * ----------------------------------------------------------------- */

    public function index(Request $request, Business $business): JsonResponse
    {
        $this->authorizeOwner($request, $business);

        return response()->json($business->subscriptions()->with('plan')->latest()->get());
    }

    /**
     * Owner submits a purchase request for a plan. SECURITY: the client
     * sends ONLY a plan id — price/currency/duration/name are copied from
     * the DB plan into a snapshot so later plan edits never rewrite
     * history, and no client value can influence what will be charged.
     */
    public function store(SubscriptionRequest $request, Business $business): JsonResponse
    {
        $this->authorizeOwner($request, $business);

        // Purchase requires an ACTIVE plan (deactivation blocks new
        // purchases but never invalidates existing subscriptions).
        $plan = Plan::where('id', $request->validated('plan_id'))->where('is_active', true)->firstOrFail();
        abort_unless(
            ! ($plan->features['designer_studio'] ?? false)
                || $request->user()?->hasApprovedDesignerStatus(),
            403,
            'خرید پلن استودیو فقط برای طراحان تأییدشده مجاز است.'
        );

        $data = [
            'plan_id' => $plan->id,
            'status' => 'pending_receipt',
            'receipt_reference' => $request->validated('receipt_reference'),
            // Money snapshot (frozen at request time):
            'plan_name' => $plan->name,
            'price_amount' => $plan->price,
            'price_currency' => $plan->currency,
            'duration_days' => $plan->duration_days,
        ];

        if ($request->hasFile('receipt')) {
            $file = $request->file('receipt');
            // PHASE 5 security: receipts are confidential financial documents —
            // they live on the PRIVATE receipts disk (outside the public disk
            // and outside any storage:link) and are served ONLY through the
            // authorized download endpoint below. No public URL ever exists.
            $data['receipt_path'] = $file->store('receipts', 'receipts');
            $data['receipt_name'] = $file->getClientOriginalName();
            $data['receipt_mime'] = $file->getMimeType();
        }

        $subscription = $business->subscriptions()->create($data);
        // Snapshot fields are deliberately non-fillable (never client-assignable)
        // and are set server-side from the DB plan.
        $subscription->forceFill([
            'plan_name' => $plan->name,
            'price_amount' => $plan->price,
            'price_currency' => $plan->currency,
            'duration_days' => $plan->duration_days,
        ])->save();

        return response()->json($subscription->refresh()->load('plan'), 201);
    }

    /**
     * Admin activation/rejection/expiry. On activation:
     *  - dates are computed server-side from the plan;
     *  - POLICY snapshot_entitlements: the plan's CURRENT features are
     *    normalized and frozen onto the subscription;
     *  - supersede: any other active subscription of this business is
     *    expired (single-active invariant — two concurrent actives would
     *    make entitlement resolution ambiguous). This is what makes
     *    upgrade/downgrade work in the manual flow.
     */
    public function moderate(Request $request, Subscription $subscription): JsonResponse
    {
        abort_unless($request->user()?->hasRole('admin'), 403);

        $data = $request->validate([
            'status' => ['required', 'in:active,rejected,expired'],
            'admin_note' => ['nullable', 'string', 'max:1000'],
        ]);

        if ($data['status'] === 'active') {
            $plan = $subscription->plan;
            abort_if($plan === null || ! $plan->is_active, 422, 'پلن این اشتراک غیرفعال است؛ ابتدا پلن را فعال کنید.');

            // Backfill money snapshot for requests created before the
            // snapshot columns existed (legacy rows).
            $subscription->forceFill([
                'plan_name' => $subscription->plan_name ?? $plan->name,
                'price_amount' => $subscription->price_amount ?? $plan->price,
                'price_currency' => $subscription->price_currency ?? $plan->currency,
                'duration_days' => $subscription->duration_days ?? $plan->duration_days,
                // POLICY snapshot_entitlements — freeze current plan config.
                'entitlements' => FeatureGate::normalize($plan->features),
            ])->save();

            $data['start_date'] = Carbon::today();
            $data['end_date'] = Carbon::today()->addDays($plan->duration_days);

            // TIME LIFECYCLE — timestamp source of truth (same contract as
            // the online-payment activation). started_at = the exact
            // activation moment; expires_at = started_at + plan duration.
            // Remaining time is always derived (expires_at − now) — FeatureGate
            // checks expires_at, never a stale `active` flag alone.
            $now = Carbon::now();
            $subscription->forceFill([
                'started_at' => $now,
                'expires_at' => $now->copy()->addDays((int) $plan->duration_days),
            ])->save();

            // Single-active invariant: supersede other active subscriptions.
            if (FeatureGate::policy('supersede_on_activation', true)) {
                $subscription->business->subscriptions()
                    ->where('status', 'active')
                    ->where('id', '!=', $subscription->id)
                    ->update(['status' => 'expired', 'admin_note' => 'با فعال‌سازی اشتراک جدید جایگزین شد.']);
            }
        }

        $subscription->update($data);

        if ($subscription->business?->user_id) {
            InternalNotification::create([
                'user_id' => $subscription->business->user_id,
                'type' => 'subscription_'.$data['status'],
                'title' => $data['status'] === 'active' ? 'اشتراک فعال شد' : 'وضعیت اشتراک تغییر کرد',
                'message' => $data['admin_note'] ?? 'وضعیت درخواست اشتراک شما به‌روزرسانی شد.',
                'related_type' => Subscription::class,
                'related_id' => $subscription->id,
            ]);
        }

        return response()->json($subscription->fresh('plan'));
    }

    public function notifications(Request $request): JsonResponse
    {
        return response()->json(InternalNotification::where('user_id', $request->user()->id)->latest()->limit(50)->get());
    }

    public function readNotification(Request $request, InternalNotification $notification): JsonResponse
    {
        abort_unless($notification->user_id === $request->user()->id, 403);
        $notification->update(['read_at' => now()]);

        return response()->json($notification->fresh());
    }

    /**
     * Authorized receipt download. Receipts live on the PRIVATE receipts
     * disk: the legacy public path (and any stale public file left behind
     * by a failed transfer) can NEVER satisfy this download — both disks are
     * checked so a partially migrated row cannot silently leak the file.
     * Missing files fail gracefully with 404 (never a 500).
     */
    public function receipt(Request $request, Subscription $subscription)
    {
        abort_unless($request->user()?->hasRole('admin') || $subscription->business?->user_id === $request->user()?->id, 403);
        abort_unless((bool) $subscription->receipt_path, 404);

        // A migrated row stores a receipts/… path; a not-yet-migrated legacy
        // row may still point at the public disk. Either way the OTHER disk
        // must not hold the file anymore (the transfer command deletes the
        // public copy after a verified copy).
        if (str_starts_with((string) $subscription->receipt_path, 'receipts/')) {
            abort_if(Storage::disk('public')->exists($subscription->receipt_path), 403, 'فایل رسید در وضعیت انتقال ناقص است.');
            abort_unless(Storage::disk('receipts')->exists($subscription->receipt_path), 404);

            return Storage::disk('receipts')->download($subscription->receipt_path, $subscription->receipt_name ?: 'receipt');
        }

        // Legacy pre-migration path: still served until `receipts:move-to-private` runs.
        abort_unless(Storage::disk('public')->exists($subscription->receipt_path), 404);

        return Storage::disk('public')->download($subscription->receipt_path, $subscription->receipt_name ?: 'receipt');
    }

    /**
     * PHASE 6: admin subscription management. Filterable, paginated list
     * with the plan + business context the moderation UI needs (including
     * whether a receipt file exists so admins know what to review).
     */
    public function adminIndex(Request $request): JsonResponse
    {
        abort_unless($request->user()?->hasRole('admin'), 403);

        $data = $request->validate([
            'status' => ['nullable', 'in:pending_receipt,active,rejected,expired,scheduled'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $query = Subscription::with(['plan:id,name,price,currency', 'business:id,name,slug'])
            ->latest();
        if (! empty($data['status'])) {
            $query->where('status', $data['status']);
        }

        return response()->json($query->paginate(25)->through(fn (Subscription $s) => $s->toArray() + [
            'has_receipt' => (bool) $s->receipt_path,
        ]));
    }

    /** Revenue reads the money SNAPSHOT — plan price edits never rewrite history. */
    public function reports(): JsonResponse
    {
        return response()->json([
            'subscriptions' => [
                'total' => Subscription::count(),
                'pending' => Subscription::where('status', 'pending_receipt')->count(),
                'active' => Subscription::where('status', 'active')->count(),
                'revenue' => Subscription::where('status', 'active')->sum('price_amount'),
            ],
            'designer_attribution' => Business::whereNotNull('designer_id')
                ->selectRaw('designer_id, count(*) as businesses_count')
                ->groupBy('designer_id')
                ->with('designer:id,display_name,referral_code')
                ->get(),
        ]);
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'plan';
        $slug = $base;
        $attempt = 1;
        while (Plan::where('slug', $slug)->exists()) {
            $slug = $base.'-'.(++$attempt);
        }

        return $slug;
    }

    private function authorizeOwner(Request $request, Business $business): void
    {
        abort_unless($request->user()?->hasRole('admin') || $business->user_id === $request->user()?->id, 403);
    }
}
