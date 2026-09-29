<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Business\BusinessCardRequest;
use App\Models\Business;
use App\Models\BusinessCard;
use App\Services\CardDesignValidator;
use App\Services\FeatureGate;
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
                'locked' => $this->lockedFields($business, $card),
            ]
        );
    }

    public function save(BusinessCardRequest $request, Business $business): JsonResponse
    {
        $this->authorizeOwner($request, $business);

        $gate = app(FeatureGate::class);
        $data = $request->validated();
        $card = $business->cards()->firstOrNew(['template' => $data['template'] ?? 'classic']);

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

        // ---- Private print file --------------------------------------------
        if ($request->hasFile('print_file')) {
            if (! $gate->allows($business, 'print_file')) {
                abort(response()->json([
                    'message' => 'نگهداری فایل طرح چاپی نیازمند اشتراک فعال است.',
                    'entitlement_errors' => ['print_file' => 'locked'],
                    'entitlements' => $gate->payload($business),
                ], 403));
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

            // Phase 4 capability hardening: layer kinds / limits are
            // ENTITLEMENT-gated here (the validator stays purely structural —
            // it answers "is this a well-formed document", never "is this
            // plan allowed this"). The stored document is the grandfathering
            // baseline: re-saving it verbatim is always allowed; only GROWTH
            // beyond the current capability set is blocked.
            $designErrors = $this->designCapabilityViolations($business, $card, $data['design_json']);
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

        return response()->json($fresh->toArray() + $fresh->printFileMeta() + [
            'entitlements' => $gate->payload($business),
            'locked' => $this->lockedFields($business, $fresh),
        ]);
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
     * Phase 4 capability violations for a submitted design document.
     *
     * Three entitlements govern the LAYERED document (all from the same
     * capability map as every other gate — never plan names):
     *   card_layer_kinds       — list of allowed layer kinds
     *   max_layers             — int cap on total layers (null = unlimited)
     *   max_premium_elements   — int cap on premium-kind layers (null = unlimited)
     *   card_premium_layer_kinds — list of kinds COUNTED as premium elements
     *
     * GRANDFATHERING (same contract as ENTITLED_LIST_FIELDS): the STORED
     * document is the baseline. Re-saving it verbatim is always allowed;
     * each violation is computed on the GROWTH over the stored state, so a
     * design saved under a richer plan stays editable (POLICY
     * expired_card_access=readonly) while any increase is rejected.
     *
     * @param  array<string, mixed>  $design  raw client document (pre-validation)
     * @return array<string, string> machine-readable errors ([] = allowed)
     */
    private function designCapabilityViolations(Business $business, BusinessCard $card, array $design): array
    {
        $gate = app(FeatureGate::class);
        $caps = $gate->payload($business)['capabilities'];

        $allowedKinds = (array) ($caps['card_layer_kinds'] ?? []);
        $premiumKinds = (array) ($caps['card_premium_layer_kinds'] ?? []);
        $submitted = $this->summarizeDesign($design);

        // Baseline counts from the STORED document (may predate the current
        // capability configuration — that is exactly what grandfathering is).
        $baseline = $card->exists && is_array($card->design_json)
            ? $this->summarizeDesign($card->design_json)
            : ['counts' => [], 'total' => 0];

        $errors = [];

        // 1. Disallowed layer kinds — only NEW occurrences violate. A stored
        //    document that already contains a kind the plan no longer grants
        //    keeps it (re-save), but adding MORE of it is rejected.
        //    Structurally UNKNOWN kinds ("iframe"…) are skipped here — they
        //    are a whitelist question, not an entitlement question, and fall
        //    through to the validator's 422.
        foreach ($submitted['counts'] as $kind => $count) {
            if (! in_array($kind, $this->knownLayerKinds(), true)) {
                continue;
            }
            $storedCount = $baseline['counts'][$kind] ?? 0;
            if ($count > $storedCount && ! in_array($kind, $allowedKinds, true)) {
                $errors['design_layer_kinds'] = 'locked';
                break;
            }
        }

        // 2. Total layer cap — only growth over the stored total is measured.
        $maxLayers = array_key_exists('max_layers', $caps) ? $caps['max_layers'] : null;
        if (is_numeric($maxLayers)
            && $submitted['total'] > (int) $maxLayers
            && $submitted['total'] > $baseline['total']) {
            $errors['max_layers'] = 'limit_reached';
        }

        // 3. Premium element cap — growth in premium-kind occurrences.
        if ($premiumKinds !== [] && is_numeric($caps['max_premium_elements'] ?? null)) {
            $premiumOf = fn (array $s): int => array_sum(array_intersect_key($s['counts'], array_flip($premiumKinds))) + 0;
            if ($premiumOf($submitted) > (int) $caps['max_premium_elements']
                && $premiumOf($submitted) > $premiumOf($baseline)) {
                $errors['max_premium_elements'] = 'limit_reached';
            }
        }

        // 4. Typography — the document's font families are the SAME product
        //    capability as the template font (card_fonts), so a locked font is
        //    locked in the document too. Grandfathering applies per font: a
        //    family the STORED document already uses stays re-savable, while
        //    SWITCHING to a non-entitled one is refused (server-side, so
        //    flipping client state cannot unlock it).
        $allowedFonts = (array) ($caps['card_fonts'] ?? []);
        if ($allowedFonts !== []) {
            $storedFonts = $this->designFonts(is_array($card->design_json) ? $card->design_json : []);
            foreach ($this->designFonts($design) as $font) {
                if (! in_array($font, $allowedFonts, true) && ! in_array($font, $storedFonts, true)) {
                    $errors['design_fonts'] = 'locked';
                    break;
                }
            }
        }

        return $errors;
    }

    /**
     * Distinct text-layer font families used by a design document.
     * Applies the validator's own default (vazir) so omitting the field cannot
     * be used to slip past the card_fonts capability.
     *
     * @return list<string>
     */
    private function designFonts(array $design): array
    {
        $fonts = [];
        foreach ((array) ($design['layers'] ?? []) as $layer) {
            if (! is_array($layer) || ($layer['kind'] ?? null) !== 'text') {
                continue;
            }
            $font = (string) ($layer['fontFamily'] ?? 'vazir');
            if ($font !== '') {
                $fonts[$font] = true;
            }
        }

        return array_keys($fonts);
    }

    /**
     * Kind-occurrence summary of a design document used for capability
     * accounting. Accepts raw client input AND stored documents; unknown
     * kinds are counted as themselves (the structural validator will reject
     * them separately — counting must never crash here).
     *
     * @return array{counts: array<string, int>, total: int}
     */
    private function summarizeDesign(array $design): array
    {
        $counts = [];
        $total = 0;
        foreach ((array) ($design['layers'] ?? []) as $layer) {
            if (! is_array($layer)) {
                continue;
            }
            $kind = (string) ($layer['kind'] ?? '');
            if ($kind === '') {
                continue;
            }
            $counts[$kind] = ($counts[$kind] ?? 0) + 1;
            $total++;
        }

        return ['counts' => $counts, 'total' => $total];
    }

    /**
     * Does the stored design use values the business is NO LONGER entitled
     * to (only reachable via grandfathering)? Such a design is "premium
     * locked" — export of it is governed by expired_card_access policy.
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

        // The LAYERED document counts as well. Without this, a lapsed subscriber
        // whose design only uses premium layer kinds (or more premium elements
        // than the plan allows) would still be able to export it under POLICY
        // expired_card_access=readonly — the document is exactly what that
        // policy is meant to protect.
        if (is_array($card->design_json)) {
            $caps = $gate->payload($business)['capabilities'];
            $counts = $this->summarizeDesign($card->design_json)['counts'];
            $allowedKinds = (array) ($caps['card_layer_kinds'] ?? []);

            foreach (array_keys($counts) as $kind) {
                if (! in_array($kind, $this->knownLayerKinds(), true)) {
                    continue; // structural, not entitlement — the validator owns it
                }
                if (! in_array($kind, $allowedKinds, true)) {
                    return true;
                }
            }

            $premiumKinds = (array) ($caps['card_premium_layer_kinds'] ?? []);
            if ($premiumKinds !== [] && is_numeric($caps['max_premium_elements'] ?? null)) {
                $premium = array_sum(array_intersect_key($counts, array_flip($premiumKinds)));
                if ($premium > (int) $caps['max_premium_elements']) {
                    return true;
                }
            }

            $allowedFonts = (array) ($caps['card_fonts'] ?? []);
            if ($allowedFonts !== []) {
                foreach ($this->designFonts($card->design_json) as $font) {
                    if (! in_array($font, $allowedFonts, true)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * Which editor fields are currently LOCKED for this business (frontend
     * UX only). Computed from the entitlements — never from plan names.
     */
    private function lockedFields(Business $business, BusinessCard $card): array
    {
        $gate = app(FeatureGate::class);
        $caps = $gate->payload($business)['capabilities'];

        $locked = [];
        foreach (['card_templates' => 'template', 'card_themes' => 'theme', 'card_fonts' => 'font_family', 'card_exports' => 'export_format'] as $capability => $field) {
            $allowed = (array) ($caps[$capability] ?? []);
            $locked[$field] = array_values(array_diff(
                $this->knownValues($capability),
                $allowed
            ));
        }
        $locked['print_file'] = ! $gate->allows($business, 'print_file');
        $locked['max_cards'] = $gate->limit($business, 'max_cards');
        // Phase 4 layered-document capability mirrors (UX only).
        $locked['layer_kinds'] = array_values(array_intersect(
            $this->knownLayerKinds(),
            (array) ($caps['card_layer_kinds'] ?? [])
        ));
        $locked['max_layers'] = $gate->limit($business, 'max_layers');
        $locked['max_premium_elements'] = array_key_exists('max_premium_elements', $caps)
            ? (is_numeric($caps['max_premium_elements']) ? (int) $caps['max_premium_elements'] : null)
            : null;
        $locked['grandfathered'] = [
            'template' => $card->exists ? $card->template : null,
            'theme' => $card->exists ? $card->theme : null,
            'font_family' => $card->exists ? $card->font_family : null,
        ];

        return $locked;
    }

    /** Full universe of layer kinds (editor catalog). */
    private function knownLayerKinds(): array
    {
        return ['text', 'image', 'qr', 'badge', 'shape', 'path'];
    }

    /** Full universe of values per list capability (editor catalogs). */
    private function knownValues(string $capability): array
    {
        return match ($capability) {
            'card_templates' => ['classic', 'midnight', 'emerald', 'local', 'creative'],
            'card_themes' => ['navy', 'emerald', 'warm'],
            'card_fonts' => ['sans', 'vazir', 'serif'],
            'card_exports' => ['png', 'jpg', 'svg', 'pdf'],
            default => [],
        };
    }

    private function authorizeOwner(Request $request, Business $business): void
    {
        abort_unless($request->user()?->hasRole('admin') || (int) $business->user_id === (int) $request->user()?->id, 403);
    }
}
