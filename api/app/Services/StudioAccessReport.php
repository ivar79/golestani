<?php

namespace App\Services;

use App\Models\Business;
use App\Models\Subscription;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The studio rollout board (read-only): gate switch state, designer-status
 * distribution, businesses whose plan grants the studio, bypass audit trail
 * and — critically — the DIVERGENCE between the two designer concepts
 * (`users.designer_status` canonical vs legacy `designers.status`).
 *
 * Shared by `php artisan studio:access-report` and the admin panel so the
 * numbers an operator sees are always the same numbers.
 */
class StudioAccessReport
{
    public function build(): array
    {
        $gate = app(FeatureGate::class);

        $statusCounts = User::query()
            ->selectRaw('designer_status, count(*) as total')
            ->groupBy('designer_status')
            ->pluck('total', 'designer_status')
            ->all();

        $divergent = [];
        $candidates = [];
        $roleOnly = [];
        $approvedWithoutBusiness = 0;
        $approvedWithoutStudio = 0;
        $approved = 0;

        foreach (User::query()->with(['roles:id,name', 'designer:id,user_id,status'])->get() as $user) {
            $status = (string) ($user->designer_status ?? 'none');
            $legacy = $user->designer?->status;

            // ONE shared classification with studio:backfill-designers:
            //   candidate = canonical is unset ('none') + a legacy row exists
            //               → the backfill MAY copy the legacy status;
            //   divergent = canonical is ALREADY set (not 'none') and disagrees
            //               with legacy → report only, an admin decides.
            if ($legacy !== null && $status === 'none') {
                $candidates[] = [
                    'user_id' => $user->id,
                    'designer_status' => $status,
                    'legacy_status' => $legacy,
                    'has_designer_role' => $user->hasRole('designer'),
                ];
            } elseif ($legacy !== null && $legacy !== $status) {
                $divergent[] = [
                    'user_id' => $user->id,
                    'designer_status' => $status,
                    'legacy_status' => $legacy,
                ];
            }

            if ($status !== 'approved' && $user->hasRole('designer')) {
                $roleOnly[] = [
                    'user_id' => $user->id,
                    'designer_status' => $status,
                    'legacy_status' => $legacy,
                ];
            }

            if ($status !== 'approved') {
                continue;
            }

            $approved++;
            $businesses = $user->businesses()->get();
            if ($businesses->isEmpty()) {
                $approvedWithoutBusiness++;

                continue;
            }
            if (! $businesses->contains(fn (Business $business): bool => $gate->allows($business, StudioAccess::CAPABILITY))) {
                $approvedWithoutStudio++;
            }
        }

        $withStudio = 0;
        $withEditor = 0;
        $businessTotal = 0;
        foreach (Business::query()->get() as $business) {
            $businessTotal++;
            if ($gate->allows($business, 'card_editor')) {
                $withEditor++;
            }
            if ($gate->allows($business, StudioAccess::CAPABILITY)) {
                $withStudio++;
            }
        }

        $bypasses = DB::table('audit_events')->where('event', StudioAccess::BYPASS_EVENT);
        $recentBypasses = (clone $bypasses)->orderByDesc('id')->limit(20)->get([
            'id', 'actor_id', 'subject_type', 'subject_id', 'metadata', 'created_at',
        ]);

        return [
            'generated_at' => now()->toIso8601String(),
            'gate' => [
                'enforced' => StudioAccess::enforced(),
                'setting' => StudioAccess::SETTING_KEY,
                'capability' => StudioAccess::CAPABILITY,
            ],
            'users' => [
                'total' => array_sum($statusCounts),
                'by_designer_status' => $statusCounts,
                'approved' => $approved,
                'approved_without_business' => $approvedWithoutBusiness,
                'approved_without_studio_business' => $approvedWithoutStudio,
                'divergent' => $divergent,
                'backfill_candidates' => $candidates,
                'role_without_approval' => $roleOnly,
            ],
            'businesses' => [
                'total' => $businessTotal,
                'with_card_editor' => $withEditor,
                'with_designer_studio' => $withStudio,
            ],
            'subscriptions' => [
                'active' => Subscription::query()->where('status', 'active')->count(),
            ],
            'admin_bypasses' => [
                'total' => (clone $bypasses)->count(),
                'recent' => $recentBypasses,
            ],
        ];
    }
}
