<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Business\BusinessCardRequest;
use App\Models\Business;
use App\Models\BusinessCard;
use App\Services\FeatureGate;
use Illuminate\Http\BinaryFileResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

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
     * Does the stored design use values the business is NO LONGER entitled
     * to (only reachable via grandfathering)? Such a design is "premium
     * locked" — export of it is governed by expired_card_access policy.
     */
    private function designHasLockedValues(Business $business, BusinessCard $card): bool
    {
        foreach (self::ENTITLED_LIST_FIELDS as $field => $capability) {
            $stored = $card->{$field};
            if ($stored !== null && ! app(FeatureGate::class)->allowsValue($business, $capability, (string) $stored)) {
                return true;
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
        $locked['grandfathered'] = [
            'template' => $card->exists ? $card->template : null,
            'theme' => $card->exists ? $card->theme : null,
            'font_family' => $card->exists ? $card->font_family : null,
        ];

        return $locked;
    }

    /** Full universe of values per list capability (editor catalogs). */
    private function knownValues(string $capability): array
    {
        return match ($capability) {
            'card_templates' => ['classic', 'midnight', 'emerald', 'local', 'creative'],
            'card_themes' => ['navy', 'emerald', 'warm'],
            'card_fonts' => ['sans', 'vazir', 'serif'],
            'card_exports' => ['png', 'jpg'],
            default => [],
        };
    }

    private function authorizeOwner(Request $request, Business $business): void
    {
        abort_unless($request->user()?->hasRole('admin') || (int) $business->user_id === (int) $request->user()?->id, 403);
    }
}
