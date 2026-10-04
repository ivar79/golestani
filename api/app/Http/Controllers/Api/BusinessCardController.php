<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Business\BusinessCardRequest;
use App\Models\Business;
use App\Models\BusinessCard;
use App\Services\CardDesignValidator;
use App\Services\DesignEntitlements;
use App\Services\FeatureGate;
use App\Services\StudioAccess;
use App\Services\StudioTemplateApply;
use Illuminate\Http\BinaryFileResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Card editor endpoints — the backend is the SINGLE authority on what a
 * business may save/export/upload. The frontend mirrors capabilities for UX
 * only; every request here is re-checked server-side (direct API calls from
 * a "free" client are rejected with 403 + machine-readable entitlement_errors).
 *
 * POLICY snapshot_entitlements: entitlements come from the subscription's
 * frozen snapshot via FeatureGate — editing a plan never changes what an
 * active subscriber may do.
 *
 * Grandfathering (requirement 6 — designs must survive plan changes):
 *   - Reads always return the stored design verbatim (never mutated).
 *   - Re-saving a field with the SAME value already stored is allowed even
 *     without the entitlement (POLICY expired_card_access=readonly), so an
 *     expired premium design stays editable-as-is but cannot gain NEW
 *     premium features.
 */
class BusinessCardController extends Controller
{
    /** Card fields governed by list-type entitlements. */
    private const ENTITLED_LIST_FIELDS = [
        'template' => 'card_templates',
        'theme' => 'card_themes',
        'font_family' => 'card_fonts',
    ];

    /** All save-relevant scalar fields (client-suppliable). */
    private const SCALAR_FIELDS = ['theme', 'font_size', 'font_family', 'export_format', 'creation_type', 'template'];

    /** Export format belongs to this list capability. */
    private const EXPORT_CAPABILITY = 'card_exports';

    public function show(Request $request, Business $business): JsonResponse
    {
        $this->authorizeOwner($request, $business);
        $card = $business->cards()->latest()->first();

        // PHASE 4 (layered editor): a null design_json means the template
        // renderer governs this card — existing cards are returned verbatim
        // and stay renderable/exportable exactly as before.
        abort_unless((bool) $business->cards()->count() || $card === null || app(FeatureGate::class)->allows($business, 'card_editor'), 403);

        $created = false;
        if (! $card) {
            $card = new BusinessCard([
                'business_id' => $business->id,
                'template' => 'classic',
                'theme' => 'navy',
                'font_size' => 'medium',
                'font_family' => 'sans',
            ]);
            $created = true;
        }

        // Entitlement contract for the editor (UX only — never authoritative).
        $entitlements = app(FeatureGate::class)->payload($business);

        return response()->json(
            $card->toArray() + $card->printFileMeta() + [
                'entitlements' => $entitlements,
                'locked' => $this->lockedFields($card, $entitlements['capabilities']),
                // Studio gate decision (UX only — every Level B write is
                // re-checked server-side with the audited admin bypass).
                'studio' => app(StudioAccess::class)->payload($request->user(), $business),
            ]
        );
    }

    public function save(BusinessCardRequest $request, Business $business): JsonResponse
    {
        $this->authorizeOwner($request, $business);

        $gate = app(FeatureGate::class);
        $data = $request->validated();
        $card = $this->resolveCardTarget($business, $data);

        // ---- Entitlement gate on every scalar field -----------------------
        $entitlementErrors = $this->entitlementViolations($business, $card, $data);
        if ($entitlementErrors !== []) {
            abort(response()->json([
                'message' => 'برای استفاده از این امکانات، اشتراک فعال لازم است.',
                'entitlement_errors' => $entitlementErrors,
                'entitlements' => $gate->payload($business),
            ], 403));
        }

        // ---- max_cards limit ----------------------------------------------
        // New distinct template row beyond the plan's quota is rejected.
        if (! $card->exists) {
            $limit = $gate->limit($business, 'max_cards');
            $existing = (int) $business->cards()->count();
            if ($limit !== null && $existing >= $limit) {
                abort(response()->json([
                    'message' => "سقف کارت برای پلن شما {$limit} عدد است.",
                    'entitlement_errors' => ['max_cards' => 'limit_reached'],
                    'entitlements' => $gate->payload($business),
                ], 403));
            }
        }

        // Studio gate decision for this request (only Level B actions record
        // one); the response echoes it so the client mirrors the server.
        $studio = null;

        // ---- Private print file --------------------------------------------
        if ($request->hasFile('print_file')) {
            if (! $gate->allows($business, 'print_file')) {
                abort(response()->json([
                    'message' => 'نگهداری فایل طرح چاپی نیازمند اشتراک فعال است.',
                    'entitlement_errors' => ['print_file' => 'locked'],
                    'entitlements' => $gate->payload($business),
                ], 403));
            }

            // STUDIO GATE (Level B): replacing the print file of an EXISTING
            // LAYERED card is a studio action — the layered document is the
            // studio artifact. A first print file on a non-layered card stays
            // LEVEL A and is never locked.
            if ($card->exists && is_array($card->design_json)) {
                $studio = app(StudioAccess::class)->assert($request, $business, 'print_file.replace', (int) $card->id);
            }

            if ($card->print_file_path) {
                // Replace: the previous private file is removed first so no
                // orphaned print designs accumulate on the private disk.
                Storage::disk('card_files')->delete($card->print_file_path);
            }
            $file = $request->file('print_file');
            $path = $file->store('cards/print_files', 'card_files');
            $card->print_file_path = $path;
            $card->print_file_name = $file->getClientOriginalName();
            $card->print_file_mime = $file->getMimeType();
        }

        if (! empty($data['delete_print_file']) && $card->print_file_path) {
            Storage::disk('card_files')->delete($card->print_file_path);
            $card->print_file_path = null;
            $card->print_file_name = null;
            $card->print_file_mime = null;
        }

        if ($request->hasFile('front_image')) {
            $card->front_image = $request->file('front_image')->store('cards/images', 'public');
        }
        if ($request->hasFile('back_image')) {
            $card->back_image = $request->file('back_image')->store('cards/images', 'public');
        }

        foreach (self::SCALAR_FIELDS as $field) {
            if (array_key_exists($field, $data)) {
                $card->{$field} = $data[$field];
            }
        }

        // PHASE 4 layered editor document: whitelist-validated, size-capped,
        // and gated behind the card_editor entitlement. Scalars remain the
        // columns of record (entitlement/grandfathering contract unchanged).
        if (array_key_exists('design_json', $data)) {
            if (! $gate->allows($business, 'card_editor')) {
                abort(response()->json([
                    'message' => 'ویرایشگر پیشرفته کارت نیازمند اشتراک فعال است.',
                    'entitlement_errors' => ['card_editor' => 'locked'],
                    'entitlements' => $gate->payload($business),
                ], 403));
            }

            // STUDIO GATE (Level B): once the `designer_studio` rollout switch
            // is on, a SEMANTIC mutation of the document requires studio
            // access. CANONICAL grandfathering: re-saving the stored document
            // — even with different key order / 40 vs 40.0 notation — is not a
            // mutation and stays allowed. Applies to the whole document, so
            // reshaping the layer array cannot smuggle a change past the gate.
            $isMutation = CardDesignValidator::fingerprint($data['design_json'])
                !== CardDesignValidator::fingerprint($card->exists ? $card->design_json : null);
            if ($isMutation) {
                $studio = app(StudioAccess::class)->assert($request, $business, 'design_json.save', $card->exists ? (int) $card->id : null);
            }

            // Phase 4 capability hardening: layer kinds / limits are
            // ENTITLEMENT-gated here (the validator stays purely structural —
            // it answers "is this a well-formed document", never "is this
            // plan allowed this"). The stored document is the grandfathering
            // baseline: re-saving it verbatim is always allowed; only GROWTH
            // beyond the current capability set is blocked.
            $designErrors = app(DesignEntitlements::class)->violations(
                $business,
                $card->exists && is_array($card->design_json) ? $card->design_json : null,
                $data['design_json'],
            );
            if ($designErrors !== []) {
                abort(response()->json([
                    'message' => 'سند کارت شامل عناصری است که پلن شما مجاز نمی‌داند.',
                    'entitlement_errors' => $designErrors,
                    'entitlements' => $gate->payload($business),
                ], 403));
            }

            $card->design_json = app(CardDesignValidator::class)->validate($data['design_json']);
        }

        if (! empty($data['export_format'])) {
            $card->exported_at = Carbon::now();
        }

        $card->save();

        $fresh = $card->fresh();
        $entitlements = $gate->payload($business);

        return response()->json($fresh->toArray() + $fresh->printFileMeta() + [
            'entitlements' => $entitlements,
            'locked' => $this->lockedFields($fresh, $entitlements['capabilities']),
            'studio' => $studio ?? app(StudioAccess::class)->payload($request->user(), $business),
        ]);
    }

    /**
     * POST /businesses/{business}/card/template-apply — THE canonical studio
     * apply (amendment 4).
     *
     * The client names a SOURCE + a template; it never sends a document.
     * Resolution → entitlement → materialize (clone + fresh ids + placeholder
     * fill) → structural validation → entitlement accounting → persist happen
     * here, in one transaction.
     */
    public function applyTemplate(Request $request, Business $business): JsonResponse
    {
        $this->authorizeOwner($request, $business);

        $data = $request->validate([
            'source' => ['required', 'in:builtin,db,personal'],
            'template_id' => ['required'],
            // Optional explicit card target (unified selection contract).
            'card_id' => ['nullable', 'integer', 'min:1'],
        ]);

        $result = app(StudioTemplateApply::class)->apply(
            $request,
            $business,
            $data['source'],
            $data['template_id'],
            isset($data['card_id']) ? (int) $data['card_id'] : null,
        );

        return response()->json($result);
    }

    /**
     * Authorized download of the private print file. Owner/admin AND the
     * print_file entitlement (POLICY expired_print_file_download: after
     * expiry the file stays stored but is locked behind renewal).
     */
    public function download(Request $request, Business $business): StreamedResponse|BinaryFileResponse|RedirectResponse
    {
        $this->authorizeOwner($request, $business);

        $gate = app(FeatureGate::class);
        if (! $gate->allows($business, 'print_file')) {
            abort(response()->json([
                'message' => 'دانلود فایل طرح چاپی نیازمند اشتراک فعال است.',
                'entitlement_errors' => ['print_file' => 'locked'],
                'entitlements' => $gate->payload($business),
            ], 403));
        }

        $card = $business->cards()->latest()->first();
        abort_if($card === null || empty($card->print_file_path), 404);
        abort_unless(Storage::disk('card_files')->exists($card->print_file_path), 404);

        $downloadName = $card->print_file_name ?: basename($card->print_file_path);

        return Storage::disk('card_files')->download($card->print_file_path, $downloadName);
    }

    /**
     * Per-field entitlement violations for a save request.
     *
     * A field passes when ANY of:
     *   1. the business is entitled to the feature (snapshot-based), or
     *   2. GRANDFATHERING: the submitted value equals the value already
     *      stored on the card (re-saving an existing premium design without
     *      changing premium properties), or
     *   3. the field is not submitted at all (unchanged by this request).
     */
    private function entitlementViolations(Business $business, BusinessCard $card, array $data): array
    {
        $gate = app(FeatureGate::class);
        $errors = [];

        foreach (self::ENTITLED_LIST_FIELDS as $field => $capability) {
            if (! array_key_exists($field, $data)) {
                continue;
            }
            if ($gate->allowsValue($business, $capability, (string) $data[$field])) {
                continue;
            }
            $stored = $card->exists ? $card->{$field} : null;
            $isSameValue = $stored !== null && $data[$field] === $stored;

            if (! $isSameValue) {
                $errors[$field] = 'locked';
            }
        }

        // export_format IS the export action: no grandfathering. Every export
        // requires the format to be currently entitled (a stored "jpg" from
        // a lapsed subscription must not leak the premium format back).
        if (array_key_exists('export_format', $data)
            && ! $gate->allowsValue($business, self::EXPORT_CAPABILITY, (string) $data['export_format'])) {
            $errors['export_format'] = 'locked';
        }

        // POLICY expired_card_access (default 'readonly'): exporting a design
        // whose PREMIUM properties the business can no longer claim is
        // blocked. TODO(business): confirm — 'allow_export' would permit
        // exporting an already-designed premium card after expiry.
        if (array_key_exists('export_format', $data)
            && FeatureGate::policy('expired_card_access', 'readonly') === 'readonly'
            && $card->exists
            && $this->designHasLockedValues($business, $card)) {
            $errors['export_design'] = 'locked';
        }

        return $errors;
    }

    /**
     * Does the stored design use values the business is NO LONGER entitled
     * to (only reachable via grandfathering)? Such a design is "premium
     * locked" — export of it is governed by expired_card_access policy.
     *
     * The DOCUMENT-side accounting lives in DesignEntitlements (shared with
     * the studio template-apply pipeline); this method adds the scalar fields.
     */
    private function designHasLockedValues(Business $business, BusinessCard $card): bool
    {
        $gate = app(FeatureGate::class);

        foreach (self::ENTITLED_LIST_FIELDS as $field => $capability) {
            $stored = $card->{$field};
            if ($stored !== null && ! $gate->allowsValue($business, $capability, (string) $stored)) {
                return true;
            }
        }

        return app(DesignEntitlements::class)->hasLockedValues(
            $business,
            is_array($card->design_json) ? $card->design_json : null,
        );
    }

    /**
     * Which editor fields are currently LOCKED for this business (frontend
     * UX only). Computed from the entitlements — never from plan names.
     */
    private function lockedFields(BusinessCard $card, array $capabilities): array
    {
        $locked = [];
        foreach (['card_templates' => 'template', 'card_themes' => 'theme', 'card_fonts' => 'font_family', 'card_exports' => 'export_format'] as $capability => $field) {
            $allowed = (array) ($capabilities[$capability] ?? []);
            $locked[$field] = array_values(array_diff(
                $this->knownValues($capability),
                $allowed
            ));
        }
        $locked['print_file'] = ! FeatureGate::allowsFromCapabilities($capabilities, 'print_file');
        $locked['max_cards'] = FeatureGate::limitFromCapabilities($capabilities, 'max_cards');
        // Phase 4 layered-document capability mirrors (UX only).
        $locked['layer_kinds'] = array_values(array_intersect(
            app(DesignEntitlements::class)->knownLayerKinds(),
            (array) ($capabilities['card_layer_kinds'] ?? [])
        ));
        $locked['max_layers'] = FeatureGate::limitFromCapabilities($capabilities, 'max_layers');
        $locked['max_premium_elements'] = array_key_exists('max_premium_elements', $capabilities)
            ? (is_numeric($capabilities['max_premium_elements']) ? (int) $capabilities['max_premium_elements'] : null)
            : null;
        $locked['grandfathered'] = [
            'template' => $card->exists ? $card->template : null,
            'theme' => $card->exists ? $card->theme : null,
            'font_family' => $card->exists ? $card->font_family : null,
        ];

        return $locked;
    }

    /** Full universe of values per list capability (editor catalogs). The
     * card_templates universe now comes from the canonical SERVER-SIDE
     * builtin catalog (generated from templatesCatalog.ts), so it can never
     * drift from the real gallery again — previously a hand-list of 5 ids
     * silently desynced from the 15-template TS catalog. */
    private function knownValues(string $capability): array
    {
        return match ($capability) {
            // The universe = LEGACY constrained-editor keys ∪ the layered
            // builtin catalog ids. Both are real values of cards.template /
            // the gallery, so `locked` must know both to stay truthful.
            'card_templates' => array_values(array_unique(array_merge(
                ['classic', 'midnight', 'emerald', 'local', 'creative'],
                app(\App\Services\TemplateService::class)->builtinIds()
            ))),
            'card_themes' => ['navy', 'emerald', 'warm'],
            'card_fonts' => ['sans', 'vazir', 'serif'],
            'card_exports' => ['png', 'jpg', 'svg', 'pdf'],
            default => [],
        };
    }

    /**
     * UNIFIED card selection contract.
     *
     * An explicit `card_id` (if provided) MUST belong to the business and is
     * the target; otherwise the legacy template-keyed lookup is preserved
     * verbatim so existing clients (and multi-card businesses) keep their
     * exact previous behavior. No card is ever deleted or reassigned here.
     */
    private function resolveCardTarget(Business $business, array $data): BusinessCard
    {
        $cardId = isset($data['card_id']) ? (int) $data['card_id'] : 0;
        if ($cardId > 0) {
            $card = $business->cards()->whereKey($cardId)->first();
            abort_if($card === null, 403, 'این کارت متعلق به این کسب‌وکار نیست.');

            return $card;
        }

        return $business->cards()->firstOrNew(['template' => $data['template'] ?? 'classic']);
    }

    private function authorizeOwner(Request $request, Business $business): void
    {
        abort_unless($request->user()?->hasRole('admin') || (int) $business->user_id === (int) $request->user()?->id, 403);
    }
}
