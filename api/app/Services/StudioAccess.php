<?php

namespace App\Services;

use App\Models\Business;
use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * The Card STUDIO access gate — the single authority on who may mutate the
 * layered design document (Level B).
 *
 * Contract (approved plan, amendments 1/2/5/7/8):
 *   - Studio access = user.designer_status === 'approved' AND the business
 *     holds the `designer_studio` capability (per BUSINESS — a capability is
 *     never inherited from another business of the same user).
 *   - LEVEL A (reading the card, scalar fields, template/theme/font/export,
 *     front/back images, print file on a non-layered card) is NEVER locked.
 *   - LEVEL B (design_json mutation, personal templates, gallery submission,
 *     print-file replacement on a layered card) is gated.
 *   - ADMIN BYPASS is explicit, limited to this capability gate (never
 *     ownership, validation, throttling or security checks), acts as the
 *     admin themselves, and writes `admin.studio_bypass` with actor,
 *     business/card, action and the bypassed capability.
 *   - ROLLOUT: the gate is enforced only while the site setting
 *     `studio_designer_only` is '1'. Default '0' keeps the legacy behaviour
 *     (any business with card_editor) so the feature can be staged: add the
 *     capability to plans → refresh snapshots → flip the switch.
 */
class StudioAccess
{
    /** Site setting that turns ENFORCEMENT on (staged rollout switch). */
    public const SETTING_KEY = 'studio_designer_only';

    /** The capability key that grants studio access on a business plan. */
    public const CAPABILITY = 'designer_studio';

    /** Audit event written for every ADMIN BYPASS of the gate. */
    public const BYPASS_EVENT = 'admin.studio_bypass';

    public const REASON_STAGE_OFF = 'stage_off';
    public const REASON_DESIGNER = 'designer';
    public const REASON_ADMIN_BYPASS = 'admin_bypass';
    public const REASON_NOT_APPROVED = 'not_approved';
    public const REASON_NO_CAPABILITY = 'no_capability';
    public const REASON_NOT_OWNER = 'not_owner';

    /** Is the gate currently enforced? ('0'/missing = staged off). */
    public static function enforced(): bool
    {
        // Tolerate the values an admin UI / seeder may realistically store
        // ('1', 'true', 'on', boolean true cast to '1'); a strict === '1'
        // silently left the designer-only gate OFF for any other spelling.
        $value = SiteSetting::query()->where('key', self::SETTING_KEY)->value('value');

        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'on', 'yes'], true);
    }

    /**
     * Pure decision — no side effects, no audit.
     *
     * @return array{allowed: bool, bypass: bool, reason: string, enforced: bool, designer_status: string, capability: bool}
     */
    public function resolve(?User $user, Business $business): array
    {
        $enforced = self::enforced();
        $designerStatus = (string) ($user?->designer_status ?? 'none');
        $capability = app(FeatureGate::class)->allows($business, self::CAPABILITY);
        $ownsBusiness = $user !== null && (int) $business->user_id === (int) $user->id;

        $decision = [
            'allowed' => $ownsBusiness,
            'bypass' => false,
            'reason' => $ownsBusiness ? self::REASON_STAGE_OFF : self::REASON_NOT_OWNER,
            'enforced' => $enforced,
            'designer_status' => $designerStatus,
            'capability' => $capability,
        ];

        if (! $ownsBusiness) {
            return $decision;
        }

        if (! $enforced) {
            return $decision;
        }

        if ($user !== null && $user->hasApprovedDesignerStatus() && $capability) {
            $decision['reason'] = self::REASON_DESIGNER;

            return $decision;
        }

        // Explicit, audited admin exception — the capability map only.
        if ($user?->hasRole('admin')) {
            $decision['reason'] = self::REASON_ADMIN_BYPASS;
            $decision['bypass'] = true;

            return $decision;
        }

        $decision['allowed'] = false;
        $decision['reason'] = ($user !== null && $user->hasApprovedDesignerStatus())
            ? self::REASON_NO_CAPABILITY
            : self::REASON_NOT_APPROVED;

        return $decision;
    }

    /**
     * Assert studio access for a Level B action. Aborts 403 with a
     * machine-readable body when denied; records the admin bypass audit row
     * exactly when a bypass actually happened (admin allowed while the
     * normal rule would deny).
     *
     * @return array{allowed: bool, bypass: bool, reason: string, enforced: bool, designer_status: string, capability: bool}
     */
    public function assert(Request $request, Business $business, string $action, ?int $cardId = null): array
    {
        $user = $request->user();
        abort_unless(
            $user !== null && (int) $business->user_id === (int) $user->id,
            403,
            'دسترسی به این کسب‌وکار مجاز نیست.'
        );
        $decision = $this->resolve($user, $business);

        if (! $decision['allowed']) {
            abort(response()->json([
                'message' => 'استودیوی طراحی فقط برای طراحان تأییدشده‌ای فعال است که پلن کسب‌وکارشان امکان «استودیو طراحی» را داشته باشد.',
                'studio_errors' => ['studio' => $decision['reason']],
                'studio' => $decision,
            ], 403));
        }

        if ($decision['bypass']) {
            AuditTrail::record($user?->id, self::BYPASS_EVENT, 'business', $business->id, [
                'action' => $action,
                'capability' => self::CAPABILITY,
                'card_id' => $cardId,
                'designer_status' => $decision['designer_status'],
                'reason' => $decision['reason'],
                'enforced' => $decision['enforced'],
            ]);
        }

        return $decision;
    }

    /** Client-facing studio block (UX only — every write re-checks server-side). */
    public function payload(?User $user, Business $business): array
    {
        return $this->resolve($user, $business);
    }

    /**
     * Resolve the business a NON-scoped studio endpoint acts on (personal
     * templates, gallery submissions). An explicit business_id must be owned;
     * otherwise a business that actually PASSES the gate is selected — the
     * capability is never inherited from an unrelated business, and a user
     * with no business gets a 403 (amendment 8).
     */
    public function businessFor(User $user, ?int $requestedId, ?string $capability = null): Business
    {
        $businesses = $user->businesses()->get();

        if ($requestedId !== null && $requestedId > 0) {
            $business = $businesses->firstWhere('id', $requestedId);
            abort_if($business === null, 403, 'دسترسی به این کسب‌وکار مجاز نیست.');

            return $business;
        }

        $gate = app(FeatureGate::class);
        $allowed = $businesses->first(function (Business $business) use ($gate, $capability, $user): bool {
            if ($capability !== null && ! $gate->allows($business, $capability)) {
                return false;
            }

            return $this->resolve($user, $business)['allowed'];
        });

        // Fall back to the first owned business so the caller's own check
        // produces the precise error (custom_templates vs studio). A business
        // that does NOT pass the gate can never be inherited: assert() runs on
        // whatever business is returned.
        return $allowed ?? $businesses->first() ?? abort(403, 'برای این عملیات باید کسب‌وکار داشته باشید.');
    }
}
