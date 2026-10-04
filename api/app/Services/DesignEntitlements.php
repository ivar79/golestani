<?php

namespace App\Services;

use App\Models\Business;

/**
 * Entitlement accounting for the LAYERED design document — the logic behind
 * card_layer_kinds / max_layers / card_premium_layer_kinds /
 * max_premium_elements and the document side of card_fonts.
 *
 * Extracted from BusinessCardController so EVERY write path shares ONE
 * implementation: the card save endpoint AND the unified studio
 * template-apply pipeline. (Structural whitelisting stays in
 * CardDesignValidator — this service answers "is this plan allowed this",
 * never "is this well-formed".)
 *
 * GRANDFATHERING contract (unchanged): the STORED document is the baseline.
 * Re-saving it verbatim is always allowed; each violation is computed on the
 * GROWTH over the stored state, so a design saved under a richer plan stays
 * editable (POLICY expired_card_access=readonly) while any increase is
 * rejected.
 */
class DesignEntitlements
{
    /** Full universe of layer kinds (editor catalog). */
    public function knownLayerKinds(): array
    {
        return ['text', 'image', 'qr', 'badge', 'shape', 'path'];
    }

    /**
     * Entitlement violations for a submitted design document.
     *
     * @param  array<string, mixed>|null  $storedDesign  the grandfathering baseline
     * @param  array<string, mixed>  $submittedDesign  raw client/template document (pre-validation)
     * @return array<string, string> machine-readable errors ([] = allowed)
     */
    public function violations(Business $business, ?array $storedDesign, array $submittedDesign): array
    {
        $gate = app(FeatureGate::class);
        $caps = $gate->payload($business)['capabilities'];

        $allowedKinds = (array) ($caps['card_layer_kinds'] ?? []);
        $premiumKinds = (array) ($caps['card_premium_layer_kinds'] ?? []);
        $submitted = $this->summarize($submittedDesign);

        // Baseline counts from the STORED document (may predate the current
        // capability configuration — that is exactly what grandfathering is).
        $baseline = is_array($storedDesign)
            ? $this->summarize($storedDesign)
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
            $storedFonts = $this->fonts($storedDesign ?? []);
            foreach ($this->fonts($submittedDesign) as $font) {
                if (! in_array($font, $allowedFonts, true) && ! in_array($font, $storedFonts, true)) {
                    $errors['design_fonts'] = 'locked';
                    break;
                }
            }
        }

        return $errors;
    }

    /**
     * Does the stored design use values the business is NO LONGER entitled to
     * (only reachable via grandfathering)? Such a design is "premium locked" —
     * export of it is governed by POLICY expired_card_access.
     *
     * The LAYERED document counts as well. Without this, a lapsed subscriber
     * whose design only uses premium layer kinds (or more premium elements
     * than the plan allows) would still be able to export it under POLICY
     * expired_card_access=readonly — the document is exactly what that policy
     * is meant to protect.
     */
    public function hasLockedValues(Business $business, ?array $design): bool
    {
        if (! is_array($design)) {
            return false;
        }

        $gate = app(FeatureGate::class);
        $caps = $gate->payload($business)['capabilities'];
        $counts = $this->summarize($design)['counts'];
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
            foreach ($this->fonts($design) as $font) {
                if (! in_array($font, $allowedFonts, true)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Distinct text-layer font families used by a design document.
     * Applies the validator's own default (vazir) so omitting the field cannot
     * be used to slip past the card_fonts capability.
     *
     * @return list<string>
     */
    public function fonts(array $design): array
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
    public function summarize(array $design): array
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
}
