<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Structural whitelist validator for the layered card editor document
 * (`business_cards.design_json`).
 *
 * SECURITY/ROBUSTNESS CONTRACT:
 *   - Unknown layer kinds, unknown fields, non-scalar garbage, nested
 *     objects we don't understand and oversized payloads are REJECTED —
 *     never stored blindly.
 *   - Limits are enforced here (server-side authority): max layers, max
 *     string lengths, max image sources (URLs must point at our own storage
 *     path — remote URLs and data: URIs are rejected to prevent stored XSS
 *     and SSRF-style payloads).
 *   - This is an editor document, not a trust boundary: rendering escapes
 *     everything as React children anyway.
 */
class CardDesignValidator
{
    private const MAX_BYTES = 100_000;          // ~100KB serialized cap

    // Structural SECURITY cap (not a plan quota — plan caps live in
    // entitlements and are enforced per-business in the controller). Raised
    // from 60 so an unlimited tier can genuinely exceed the old free cap
    // while hostile payloads still cannot balloon the document.
    private const MAX_LAYERS = 120;

    private const MAX_STRING = 2_000;

    /** Max length of a serialized CSS gradient background. */
    private const MAX_GRADIENT = 1_200;

    private const LAYER_KINDS = ['text', 'image', 'qr', 'badge', 'shape', 'path'];

    private const SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'line', 'arrow', 'star', 'polygon'];

    /** Vector stroke decorations — shared by shape and path layers. */
    private const STROKE_STYLES = ['solid', 'dashed', 'dotted'];

    private const LINE_CAPS = ['butt', 'round', 'square'];

    private const LINE_JOINS = ['miter', 'round', 'bevel'];

    /** Luxury material effects (applyLuxuryMaterial) — closed enum so the
     * whitelist carries the visual style instead of silently DROPPING it
     * (the previous partial-save bug: gold/glass/neon vanished on reload). */
    private const EFFECTS = ['glass', 'velvet', 'gold', 'silver', 'neon', 'none'];

    private const FONT_FAMILIES = ['vazir', 'sans', 'serif', 'monospace'];

    private const MAX_PATH_POINTS = 500;

    /** Default editable node count (domain/curveGeometry.ts CURVE_NODE_COUNT_DEFAULT). */
    private const CURVE_NODE_DEFAULT = 9;

    /** Cap for a serialized raw SVG path (`rawD`). The whole document is
     * already capped at MAX_BYTES; this bounds a single path so a hostile or
     * runaway stroke cannot consume the entire budget. Sized to hold the
     * Q→C-expanded form of a large perfect-freehand ribbon (the frontend's
     * structural rawD budget mirrors this number). */
    private const MAX_RAW_D = 60_000;

    private const IMAGE_PREFIXES = ['storage/', '/storage/'];

    /** Live-Paint region paint (document level). */
    private const MAX_REGIONS = 200;

    private const REGION_FILLS = ['solid', 'linear', 'radial'];

    private const FILL_RULES = ['nonzero', 'evenodd'];

    /** Parametric Curve tool families (§4). `custom` = anchors are the geometry. */
    private const CURVE_KINDS = ['arc', 'sine', 'sine-asymmetric', 's', 'wave', 'custom'];

    /** Explicit dash pattern limits (§14): at most 8 segments of ≤ 400px. */
    private const MAX_DASH_SEGMENTS = 8;
    private const MAX_DASH_SEGMENT = 400;

    /**
     * READ-SIDE variant used by public rendering: never aborts.
     *
     * `validate()` is the WRITE boundary — it answers a request and must fail
     * loudly with a 422. Public rendering is different: a stored document that
     * can no longer be validated (an old version, a hand-edited row) must
     * degrade to the legacy renderer instead of taking a public page down.
     * The reason is logged for audit/debugging and the caller gets null.
     */
    public function validateForDisplay(mixed $design): ?array
    {
        if ($design === null) {
            return null;
        }

        try {
            return $this->validate($design);
        } catch (Throwable $e) {
            Log::warning('card.design_unrenderable', [
                'reason' => $e->getMessage(),
                'exception' => $e::class,
            ]);

            return null;
        }
    }

    public function validate(mixed $design): ?array
    {
        if ($design === null) {
            return null;
        }

        if (! is_array($design) || array_is_list($design)) {
            abort(422, 'ساختار سند کارت نامعتبر است.');
        }

        if (strlen(json_encode($design, JSON_UNESCAPED_UNICODE) ?: '') > self::MAX_BYTES) {
            abort(422, 'حجم سند کارت بیش از حد مجاز است.');
        }

        $version = $design['version'] ?? null;
        if ($version !== 1) {
            abort(422, 'نسخه سند کارت پشتیبانی نمی‌شود.');
        }

        $artboard = $design['artboard'] ?? null;
        if (! is_array($artboard)
            || ! isset($artboard['width'], $artboard['height'])
            || ! is_int($artboard['width']) || ! is_int($artboard['height'])
            || $artboard['width'] < 100 || $artboard['width'] > 4000
            || $artboard['height'] < 60 || $artboard['height'] > 4000) {
            abort(422, 'ابعاد سند کارت نامعتبر است.');
        }

        $background = $design['background'] ?? null;
        if ($background !== null && ! is_string($background)) {
            abort(422, 'پس‌زمینه سند نامعتبر است.');
        }
        $cleanBackground = null;
        if (is_string($background)) {
            // A background is EITHER a solid color OR a CSS gradient built by
            // the editor's gradient domain (linear/radial with hex+alpha stops).
            // Gradient is probed FIRST because cleanColor(strict) aborts on
            // anything that is not a plain color.
            $cleanBackground = $this->cleanGradient($background)
                ?? $this->cleanColor($background, true);
        }

        $layers = $design['layers'] ?? null;
        if (! is_array($layers) || ! array_is_list($layers) || count($layers) > self::MAX_LAYERS) {
            abort(422, 'لایه‌های سند کارت نامعتبر است.');
        }

        $cleanLayers = array_map(fn ($layer) => $this->validateLayer($layer), $layers);

        // Region paint is OPTIONAL and only echoed back when the document
        // actually carries it, so documents saved before the region system are
        // rebuilt byte-identically (same reason `pathMode` is optional).
        $regions = $design['regions'] ?? null;
        $cleanRegions = null;
        if ($regions !== null) {
            if (! is_array($regions) || ! array_is_list($regions) || count($regions) > self::MAX_REGIONS) {
                abort(422, 'ناحیه‌های رنگی سند کارت نامعتبر است.');
            }
            $cleanRegions = array_map(fn ($region) => $this->cleanRegion($region), $regions);
        }

        $regionSettings = $design['regionSettings'] ?? null;
        $cleanRegionSettings = null;
        if (is_array($regionSettings) && ! array_is_list($regionSettings)) {
            $cleanRegionSettings = [
                'gapTolerance' => $this->cleanNumber($regionSettings['gapTolerance'] ?? 0, 0, 64),
                'fillRule' => $this->cleanEnum($regionSettings['fillRule'] ?? null, self::FILL_RULES, 'nonzero'),
            ];
        }

        $clean = [
            'version' => 1,
            'artboard' => ['width' => $artboard['width'], 'height' => $artboard['height']],
            'background' => $cleanBackground,
            'layers' => $cleanLayers,
        ];

        if ($cleanRegions !== null) {
            $clean['regions'] = $cleanRegions;
        }
        if ($cleanRegionSettings !== null) {
            $clean['regionSettings'] = $cleanRegionSettings;
        }

        return $clean;
    }

    // ------------------------------------------------------------------
    // Canonical fingerprint (studio grandfathering / mutation detection)
    // ------------------------------------------------------------------

    /**
     * Deterministic canonical form of a design document.
     *
     * The STUDIO GATE needs one answer: "does this submission change the
     * document SEMANTICALLY?" Serialization differences — key order, integer
     * vs float notation, omitted-but-defaulted fields — are NOT mutations.
     * The comparison therefore applies, on BOTH sides:
     *
     *   1. strict normalization through validate() when possible (the same
     *      whitelist + defaults as the write path),
     *   2. a recursive key sort,
     *   3. numeric normalization (40.0 ≡ 40, rounded to 6 decimals),
     *   4. a deterministic JSON encode (see fingerprint()).
     *
     * A document that cannot be validated (legacy/foreign shape) falls back to
     * structural sorting only — the comparison stays conservative: any real
     * difference still counts as a mutation and hits the gate.
     */
    public static function canonical(mixed $design): mixed
    {
        if ($design === null) {
            return null;
        }

        if (is_array($design)) {
            try {
                $design = app(self::class)->validate($design);
            } catch (\Throwable) {
                // Legacy/unvalidatable document — sort it structurally instead.
            }
        }

        return self::canonicalize($design);
    }

    /** Canonical JSON fingerprint of a design document ("null" when absent). */
    public static function fingerprint(mixed $design): string
    {
        return json_encode(
            self::canonical($design),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        );
    }

    /**
     * Recursive canonicalization: associative keys sorted, list order kept,
     * whole-valued floats collapsed to ints (JSON 40.0 ≠ 40 otherwise).
     */
    private static function canonicalize(mixed $value): mixed
    {
        if (is_array($value)) {
            if (! array_is_list($value)) {
                ksort($value);
            }

            return array_map(static fn (mixed $item): mixed => self::canonicalize($item), $value);
        }

        if (is_float($value)) {
            $rounded = round($value, 6);
            if (floor($rounded) === $rounded && abs($rounded) < 1.0e15) {
                return (int) $rounded;
            }

            return $rounded;
        }

        return $value;
    }

    /**
     * One painted region/face.
     *
     * The `key` is the topology key the engine computed (bounding path ids +
     * a quantised interior point). A malformed colour ABORTS rather than being
     * dropped: silently losing paint is the partial-save failure this
     * validator exists to prevent.
     */
    private function cleanRegion(mixed $region): array
    {
        if (! is_array($region) || array_is_list($region)) {
            abort(422, 'ناحیه رنگی نامعتبر است.');
        }

        $key = $region['key'] ?? null;
        if (! is_string($key) || $key === '' || strlen($key) > 200) {
            abort(422, 'شناسه ناحیه رنگی نامعتبر است.');
        }

        $color = $this->cleanColor($region['color'] ?? null);
        if ($color === null) {
            abort(422, 'رنگ ناحیه رنگی نامعتبر است.');
        }

        $clean = [
            'key' => $key,
            'fill' => $this->cleanEnum($region['fill'] ?? null, self::REGION_FILLS, 'solid'),
            'color' => $color,
        ];

        if (array_key_exists('color2', $region)) {
            $color2 = $this->cleanColor($region['color2']);
            if ($color2 !== null) {
                $clean['color2'] = $color2;
            }
        }
        if (array_key_exists('angle', $region)) {
            $clean['angle'] = $this->cleanNumber($region['angle'], -360, 360);
        }
        if (array_key_exists('opacity', $region)) {
            $clean['opacity'] = $this->cleanNumber($region['opacity'], 0, 1);
        }

        return $clean;
    }

    private function validateLayer(mixed $layer): array
    {
        if (! is_array($layer)) {
            abort(422, 'لایه نامعتبر است.');
        }

        $kind = $layer['kind'] ?? null;
        if (! in_array($kind, self::LAYER_KINDS, true)) {
            abort(422, "نوع لایه پشتیبانی نمی‌شود: {$kind}");
        }

        $clean = [
            'id' => $this->cleanString($layer['id'] ?? '', 64),
            'kind' => $kind,
            'x' => $this->cleanNumber($layer['x'] ?? 0, -4000, 8000),
            'y' => $this->cleanNumber($layer['y'] ?? 0, -4000, 8000),
            'width' => $this->cleanNumber($layer['width'] ?? 0, 1, 8000),
            'height' => $this->cleanNumber($layer['height'] ?? 0, 1, 8000),
            'angle' => $this->cleanNumber($layer['angle'] ?? 0, -360, 360),
            'opacity' => $this->cleanNumber($layer['opacity'] ?? 1, 0, 1),
            'locked' => (bool) ($layer['locked'] ?? false),
            'hidden' => (bool) ($layer['hidden'] ?? false),
            'z' => $this->cleanNumber($layer['z'] ?? 0, 0, 10000),
            'color' => $this->cleanColor($layer['color'] ?? null, true),
            // Layer backgrounds may be a solid color OR an editor gradient
            // (shape fills); gradient is probed first because the strict
            // color check aborts on anything that is not a plain color.
            'background' => $this->cleanGradient($layer['background'] ?? null)
                ?? $this->cleanColor($layer['background'] ?? null, true),
        ];

        if ($clean['id'] === '' || preg_match('/^[A-Za-z0-9_-]+$/', $clean['id']) !== 1) {
            abort(422, 'شناسه لایه نامعتبر است.');
        }

        // Optional user label (layers panel). Emitted ONLY when the input
        // carries one, so stored documents stay byte-identical when a layer
        // never had a name.
        if (isset($layer['name']) && is_string($layer['name'])) {
            $clean['name'] = $this->cleanString($layer['name'], 120);
        }

        // Luxury material effect — same "emit only when present" contract as
        // `name`: documents stored without effects round-trip byte-identically,
        // while a materialized style survives the whitelist instead of being
        // silently dropped (partial save).
        if (array_key_exists('effect', $layer)
            && is_string($layer['effect'])
            && in_array($layer['effect'], self::EFFECTS, true)) {
            $clean['effect'] = $layer['effect'];
        }

        // Mirror flags are LAYER-LEVEL (every kind), exactly like `effect`:
        // the canvas frame and the SVG/PDF export both mirror about the layer's
        // own centre, so a text/shape/path/QR/badge layer must round-trip them
        // too. Emitted only when the input carries them, so documents stored
        // before the upgrade stay byte-identical.
        if (array_key_exists('flipX', $layer)) {
            $clean['flipX'] = (bool) $layer['flipX'];
        }
        if (array_key_exists('flipY', $layer)) {
            $clean['flipY'] = (bool) $layer['flipY'];
        }

        $clean['text'] = '';
        switch ($kind) {
            case 'text':
                $clean['text'] = $this->cleanString($layer['text'] ?? '', self::MAX_STRING);
                $clean['fontSize'] = $this->cleanNumber($layer['fontSize'] ?? 16, 6, 200);
                $clean['fontWeight'] = $this->cleanNumber($layer['fontWeight'] ?? 400, 100, 900);
                $clean['align'] = in_array($layer['align'] ?? 'start', ['start', 'center', 'end'], true)
                    ? $layer['align'] : 'start';
                $clean['fontFamily'] = in_array($layer['fontFamily'] ?? 'vazir', self::FONT_FAMILIES, true)
                    ? $layer['fontFamily'] : 'vazir';
                // Typographic decorations (optional; absent = default off).
                $clean['italic'] = (bool) ($layer['italic'] ?? false);
                $clean['underline'] = (bool) ($layer['underline'] ?? false);
                $clean['strikethrough'] = (bool) ($layer['strikethrough'] ?? false);
                $clean['lineHeight'] = $this->cleanNumber($layer['lineHeight'] ?? 1.25, 0.5, 4);
                $clean['letterSpacing'] = $this->cleanNumber($layer['letterSpacing'] ?? 0, -8, 40);
                break;
            case 'image':
                $src = (string) ($layer['src'] ?? '');
                abort_if($src === '', 422, 'تصویر بدون منبع مجاز نیست.');
                abort_if(! str_starts_with($src, 'storage/') && ! str_starts_with($src, '/storage/'), 422, 'منبع تصویر باید مسیر ذخیره‌سازی سامانه باشد.');
                $clean['src'] = $this->cleanString($src, 400);
                $clean['radius'] = $this->cleanNumber($layer['radius'] ?? 0, 0, 2000);
                $clean['objectFit'] = in_array($layer['objectFit'] ?? 'cover', ['cover', 'contain'], true)
                    ? $layer['objectFit'] : 'cover';
                $clean['flipX'] = (bool) ($layer['flipX'] ?? false);
                $clean['flipY'] = (bool) ($layer['flipY'] ?? false);
                break;
            case 'qr':
                $clean['payload'] = $this->cleanString($layer['payload'] ?? '', 500);
                $clean['dark'] = $this->cleanColor($layer['dark'] ?? null) ?? '#000000';
                $clean['light'] = $this->cleanColor($layer['light'] ?? null) ?? '#ffffff';
                break;
            case 'badge':
                $clean['style'] = in_array($layer['style'] ?? 'verified', ['verified', 'promoted'], true)
                    ? $layer['style'] : 'verified';
                $clean['text'] = $this->cleanString($layer['text'] ?? '', 120);
                break;
            case 'shape':
                $clean['shape'] = in_array($layer['shape'] ?? 'rect', self::SHAPE_KINDS, true)
                    ? $layer['shape'] : 'rect';
                $clean['radius'] = $this->cleanNumber($layer['radius'] ?? 0, 0, 2000);
                // Vertex count for `polygon` (ignored by every other shape).
                $clean['sides'] = (int) $this->cleanNumber($layer['sides'] ?? 6, 3, 12);
                // Optional outline stroke (null color = no stroke).
                $clean['stroke'] = $this->cleanColor($layer['stroke'] ?? null);
                $clean['strokeWidth'] = $this->cleanNumber($layer['strokeWidth'] ?? 0, 0, 60);
                // Vector stroke decorations. These MUST be whitelisted: this
                // validator rebuilds every layer from scratch, so an unlisted
                // field is silently dropped on save (the control would look
                // broken after a reload).
                $clean['strokeStyle'] = $this->cleanEnum($layer['strokeStyle'] ?? null, self::STROKE_STYLES, 'solid');
                $clean['strokeLinecap'] = $this->cleanEnum($layer['strokeLinecap'] ?? null, self::LINE_CAPS, 'round');
                $clean['strokeLinejoin'] = $this->cleanEnum($layer['strokeLinejoin'] ?? null, self::LINE_JOINS, 'round');
                $clean['strokeOpacity'] = $this->cleanNumber($layer['strokeOpacity'] ?? 1, 0, 1);
                $this->cleanDash($layer, $clean);
                break;
            case 'path':
                // Freehand Bezier strokes (EditorEngine freehand tool). Points
                // are stored relative to the layer box; optional cubic handles
                // hIn/hOut sit on each anchor.
                // A path holds its geometry in ONE of two canonical shapes:
                //   - `points`  (Bézier anchors / 2-point arc lines), or
                //   - `rawD`    (committed freehand ribbons and the heritage
                //                template ornaments — authored directly as SVG
                //                path data, so `points` may legitimately be []).
                // A layer with NEITHER is not a drawable path.
                $clean['closed'] = (bool) ($layer['closed'] ?? false);
                $points = $layer['points'] ?? [];
                abort_if(! is_array($points) || ! array_is_list($points), 422, 'نقاط مسیر نامعتبر است.');
                abort_if(count($points) > self::MAX_PATH_POINTS, 422, 'تعداد نقاط مسیر نامعتبر است.');

                $rawD = null;
                $rawDInput = $layer['rawD'] ?? null;
                if (is_string($rawDInput) && $rawDInput !== '') {
                    // Present rawD is validated STRICTLY (never blind-trusted):
                    // malformed path data, oversized paths or anything outside
                    // the SVG grammar is a 422.
                    $rawD = $this->validateRawDString($rawDInput);
                }
                if ($rawD === null) {
                    abort_if(count($points) < 2, 422, 'تعداد نقاط مسیر نامعتبر است.');
                } else {
                    $clean['rawD'] = $rawD;
                }
                $clean['points'] = array_map(
                    fn ($point): array => $this->cleanPathPoint($point),
                    $points
                );
                // Canonical 2-point curved-line arc (signed sagitta ratio, see
                // domain/curveLine.ts); legacy documents carry `curvature`
                // (-100..100) instead, kept for backwards compatibility.
                if (array_key_exists('bend', $layer)) {
                    $clean['bend'] = $this->cleanNumber($layer['bend'] ?? 0, -1.5, 1.5);
                }
                if (array_key_exists('curvature', $layer)) {
                    $clean['curvature'] = $this->cleanNumber($layer['curvature'] ?? 0, -100, 100);
                }
                // New editor metadata for the upgraded vector tools. These
                // fields are optional so every existing design remains valid.
                if (array_key_exists('pathMode', $layer)
                    && is_string($layer['pathMode'])
                    && in_array($layer['pathMode'], ['curve', 'pen', 'freehand'], true)) {
                    $clean['pathMode'] = $layer['pathMode'];
                }
                if (array_key_exists('curveProfile', $layer)
                    && is_string($layer['curveProfile'])
                    && in_array($layer['curveProfile'], ['arc', 'sine', 'sine-asymmetric', 's'], true)) {
                    $clean['curveProfile'] = $layer['curveProfile'];
                }
                // PARAMETRIC CURVE RECORD (§4). Optional (only curve-tool layers
                // carry it) and rebuilt field by field, so an unknown key can
                // never ride along into the stored JSON.
                if (isset($layer['curve']) && is_array($layer['curve'])) {
                    $clean['curve'] = $this->cleanCurve($layer['curve']);
                }
                // SVG fill rule for this path's own fill (§13). `nonzero` is the
                // SVG default, so it is only written when explicitly requested.
                if (array_key_exists('fillRule', $layer)
                    && in_array($layer['fillRule'] ?? null, self::FILL_RULES, true)) {
                    $clean['fillRule'] = $layer['fillRule'];
                }
                $clean['stroke'] = $this->cleanColor($layer['stroke'] ?? null) ?? '#0ea5e9';
                $clean['strokeWidth'] = $this->cleanNumber($layer['strokeWidth'] ?? 4, 0.5, 100);
                $clean['strokeStyle'] = $this->cleanEnum($layer['strokeStyle'] ?? null, self::STROKE_STYLES, 'solid');
                $clean['strokeLinecap'] = $this->cleanEnum($layer['strokeLinecap'] ?? null, self::LINE_CAPS, 'round');
                $clean['strokeLinejoin'] = $this->cleanEnum($layer['strokeLinejoin'] ?? null, self::LINE_JOINS, 'round');
                $clean['strokeOpacity'] = $this->cleanNumber($layer['strokeOpacity'] ?? 1, 0, 1);
                $this->cleanDash($layer, $clean);
                $clean['fill'] = $this->cleanColor($layer['fill'] ?? null);
                break;
        }

        return $clean;
    }

    /**
     * Explicit dash pattern + offset (§14) — whitelisted for every stroke-bearing
     * layer. Absent stays absent (so stored designs are byte-identical), and a
     * pattern is capped in both segment count and segment length.
     */
    private function cleanDash(array $layer, array &$clean): void
    {
        $pattern = $layer['strokeDasharray'] ?? null;
        if (is_array($pattern) && array_is_list($pattern) && count($pattern) > 0) {
            $segments = array_slice($pattern, 0, self::MAX_DASH_SEGMENTS);
            $clean['strokeDasharray'] = array_map(
                fn ($segment): float => $this->cleanNumber($segment, 0.01, self::MAX_DASH_SEGMENT),
                $segments
            );
        }
        if (array_key_exists('strokeDashoffset', $layer)) {
            $clean['strokeDashoffset'] = $this->cleanNumber($layer['strokeDashoffset'] ?? 0, -2000, 2000);
        }
    }

    /**
     * The parametric curve record. Every parameter is bounded and every optional
     * value is preserved as null (not coerced to 0) so "natural tangent" survives
     * a round trip.
     */
    private function cleanCurve(array $curve): array
    {
        $clean = [
            'kind' => $this->cleanEnum($curve['kind'] ?? null, self::CURVE_KINDS, 'sine'),
            'length' => $this->cleanNumber($curve['length'] ?? 600, 10, 20000),
            'amplitude' => $this->cleanNumber($curve['amplitude'] ?? 80, 0, 5000),
            'frequency' => $this->cleanNumber($curve['frequency'] ?? 1, 0.25, 24),
            'phase' => $this->cleanNumber($curve['phase'] ?? 0, -360, 360),
            'symmetry' => $this->cleanNumber($curve['symmetry'] ?? 0.5, 0.05, 0.95),
            // Editable NODE COUNT — snapped onto the supported ladder so a
            // tampered payload can never ask for an anchor explosion (the
            // ladder caps at 16, far below MAX_PATH_POINTS).
            'nodes' => $this->cleanNodeCount($curve['nodes'] ?? null),
            // Chord direction in degrees. Fractional values are preserved
            // exactly (0.1° is a real rotation, not a rounding error).
            'chordAngle' => $this->cleanNumber($curve['chordAngle'] ?? 0, -360, 360),
            // Strictly `true`: a truthy string ("yes") is not a boolean flag, and
            // silently treating it as one would flip a curve's direction.
            'reversed' => ($curve['reversed'] ?? false) === true,
        ];
        foreach (['startTangent', 'endTangent'] as $key) {
            $value = $curve[$key] ?? null;
            $clean[$key] = is_numeric($value) ? $this->cleanNumber($value, -360, 360) : null;
        }

        return $clean;
    }

    /**
     * The editable node ladder (domain/curveGeometry.ts CURVE_NODE_COUNTS).
     * A value between rungs snaps to the NEAREST one instead of being rejected,
     * so a document saved by a future build with an extra rung still loads.
     */
    private function cleanNodeCount(mixed $value): int
    {
        $ladder = [3, 5, 7, 9, 12, 16];
        if (! is_numeric($value)) {
            return self::CURVE_NODE_DEFAULT;
        }
        $requested = (int) round((float) $value);
        $best = $ladder[0];
        foreach ($ladder as $rung) {
            if (abs($rung - $requested) < abs($best - $requested)) {
                $best = $rung;
            }
        }

        return $best;
    }

    private function cleanString(mixed $value, int $max): string
    {
        return mb_substr(trim((string) ($value ?? '')), 0, $max);
    }

    private function cleanNumber(mixed $value, float $min, float $max): float
    {
        $number = is_numeric($value) ? (float) $value : 0.0;

        return max($min, min($max, $number));
    }

    /**
     * Whitelist an enum-like string, falling back to `$default`.
     *
     * Deliberately takes the RAW value (never `$layer['key']` after a null-coalesce
     * test): reading the key outside the coalesce throws "undefined array key"
     * whenever the field is simply absent, which is the common case for every
     * document saved before the vector upgrade.
     *
     * @param  array<int, string>  $allowed
     */
    private function cleanEnum(mixed $value, array $allowed, string $default): string
    {
        return is_string($value) && in_array($value, $allowed, true) ? $value : $default;
    }

    private function cleanPathPoint(mixed $point): array
    {
        if (! is_array($point)) {
            abort(422, 'نقطه مسیر نامعتبر است.');
        }

        $clean = [
            'x' => $this->cleanNumber($point['x'] ?? 0, -4000, 8000),
            'y' => $this->cleanNumber($point['y'] ?? 0, -4000, 8000),
        ];

        foreach (['hIn', 'hOut'] as $handle) {
            $value = $point[$handle] ?? null;
            $clean[$handle] = is_array($value)
                ? [
                    'x' => $this->cleanNumber($value['x'] ?? 0, -4000, 8000),
                    'y' => $this->cleanNumber($value['y'] ?? 0, -4000, 8000),
                ]
                : null;
        }

        return $clean;
    }

    /**
     * Strict whitelist for a raw SVG path (`rawD`) — the geometry model used by
     * committed freehand ribbons and the heritage template ornaments.
     *
     * SECURITY: this string becomes the `d` attribute of an SVG element on the
     * canvas, in the EXPORTED file and on the PUBLIC card. Only the SVG path
     * grammar is accepted:
     *   - the command set MmZzLlHhVvCcSsQqTtAa, and nothing else as a letter —
     *     any other character outside [0-9 ,.eE+-] is REJECTED, which blocks
     *     <, >, (), ;, quotes and `#` (and therefore script:, url(), HTML and
     *     external resource references) at the grammar level;
     *   - argument counts are validated per command, including implicit
     *     repeats, so a malformed path is REJECTED, never stored;
     *   - length is capped;
     *   - the data must open with a moveto.
     * Rendering escapes attribute values anyway — this keeps the STORED
     * document honest, so it can carry nothing but geometry.
     *
     * @return string the validated path data (returned verbatim)
     */
    private function validateRawDString(string $value): string
    {
        if ($value === '' || strlen($value) > self::MAX_RAW_D) {
            abort(422, 'مسیر خام نامعتبر است.');
        }

        $argCount = [
            'M' => 2, 'm' => 2, 'L' => 2, 'l' => 2, 'H' => 1, 'h' => 1,
            'V' => 1, 'v' => 1, 'C' => 6, 'c' => 6, 'S' => 4, 's' => 4,
            'Q' => 4, 'q' => 4, 'T' => 2, 't' => 2, 'A' => 7, 'a' => 7,
            'Z' => 0, 'z' => 0,
        ];

        $length = strlen($value);
        $i = 0;
        // The first command must open a subpath, and a new one must open after
        // every close. Anything else is not a drawable path.
        $expecting = ['M', 'm'];

        while ($i < $length) {
            $char = $value[$i];

            if (ctype_space($char) || $char === ',') {
                $i++;
                continue;
            }

            if (isset($argCount[$char])) {
                // An empty expectation means "any command"; after a Z (or at
                // the very start) only a moveto may (re)open a subpath.
                if ($expecting !== [] && ! in_array($char, $expecting, true)) {
                    abort(422, 'مسیر خام نامعتبر است.');
                }
                $count = $argCount[$char];
                $i++;
                for ($a = 0; $a < $count; $a++) {
                    [, $i] = $this->readRawDNumber($value, $i, true);
                }
                // Implicit repeats: M/L/T/Q/C… keep consuming arg groups.
                // Z/z take NO arguments, so nothing may trail one (a stray
                // number after a closepath is malformed, not a repeat).
                while ($count > 0) {
                    $restart = $i;
                    [$num, $i] = $this->readRawDNumber($value, $i);
                    if ($num === null) {
                        $i = $restart;
                        break;
                    }
                    for ($a = 1; $a < $count; $a++) {
                        [, $i] = $this->readRawDNumber($value, $i, true);
                    }
                }
                $expecting = ($char === 'Z' || $char === 'z') ? ['M', 'm'] : [];
                continue;
            }

            abort(422, 'مسیر خام نامعتبر است.');
        }

        return $value;
    }

    /**
     * Read one SVG path number (optionally signed, with a decimal point and/or
     * an exponent). Returns [null, $start] when the input here is not a
     * number, so the caller can back out for an implicit-repeat boundary —
     * or abort when the number is REQUIRED (a command argument).
     *
     * @return array{0: string|null, 1: int}
     */
    private function readRawDNumber(string $value, int $i, bool $required = false): array
    {
        $length = strlen($value);

        // Separators between numbers are optional in SVG (1 2, 1,2, 1-2); any
        // leading whitespace/commas here are just separators.
        while ($i < $length && (ctype_space($value[$i]) || $value[$i] === ',')) {
            $i++;
        }

        $start = $i;
        $seenDigit = false;

        if ($i < $length && ($value[$i] === '+' || $value[$i] === '-')) {
            $i++;
        }
        while ($i < $length && ctype_digit($value[$i])) {
            $i++;
            $seenDigit = true;
        }
        if ($i < $length && $value[$i] === '.') {
            $i++;
            while ($i < $length && ctype_digit($value[$i])) {
                $i++;
                $seenDigit = true;
            }
        }
        if ($seenDigit && $i < $length && ($value[$i] === 'e' || $value[$i] === 'E')) {
            $j = $i + 1;
            if ($j < $length && ($value[$j] === '+' || $value[$j] === '-')) {
                $j++;
            }
            if ($j < $length && ctype_digit($value[$j])) {
                while ($j < $length && ctype_digit($value[$j])) {
                    $j++;
                }
                $i = $j;
            }
        }

        if (! $seenDigit) {
            if ($required) {
                abort(422, 'مسیر خام نامعتبر است.');
            }

            return [null, $start];
        }

        return [substr($value, $start, $i - $start), $i];
    }

    /**
     * Accept editor-produced CSS gradients: linear-gradient()/radial-gradient()
     * with a numeric angle/position and hex or rgba color stops. Everything
     * else (url(), var(), calc(), expressions) is rejected. The renderer only
     * ever consumes the resulting CSS string.
     */
    private function cleanGradient(mixed $value): ?string
    {
        if (! is_string($value) || $value === '' || strlen($value) > self::MAX_GRADIENT) {
            return null;
        }

        $kind = null;
        foreach (['linear-gradient', 'radial-gradient'] as $name) {
            if (stripos($value, $name.'(') === 0) {
                $kind = $name;
                break;
            }
        }
        if ($kind === null) {
            return null;
        }

        // Balanced-paren scan: the gradient must close exactly once, at the end.
        $depth = 0;
        $chars = str_split($value);
        foreach ($chars as $i => $char) {
            if ($char === '(') {
                $depth++;
            } elseif ($char === ')') {
                $depth--;
                if ($depth === 0 && $i !== strlen($value) - 1) {
                    return null;
                }
            }
        }
        if ($depth !== 0) {
            return null;
        }

        $inner = trim(substr($value, strlen($kind) + 1, -1));
        if ($inner === '') {
            return null;
        }

        // Split on top-level commas only (nested rgba() parens are protected).
        $parts = [];
        $current = '';
        $nested = 0;
        foreach (str_split($inner) as $char) {
            $current .= $char;
            if ($char === '(') {
                $nested++;
            } elseif ($char === ')') {
                $nested--;
            } elseif ($char === ',' && $nested === 0) {
                $parts[] = trim(substr($current, 0, -1));
                $current = '';
            }
        }
        $parts[] = trim($current);
        if ($parts === []) {
            return null;
        }

        // First token is the direction/angle for linear, a shape/size or angle
        // for radial — both optional; when present it must be a plain number
        // with deg/rad/turn or one of the known multi-word keywords.
        $first = $parts[0];
        $stops = $parts;
        if (! str_contains($first, '#') && ! str_contains($first, 'rgb')) {
            $validDirection = preg_match('/^-?\d+(\.\d+)?(deg|rad|turn)$/', $first) === 1
                || in_array(strtolower($first), [
                    'to top', 'to right', 'to bottom', 'to left',
                    'to top right', 'to top left', 'to bottom right', 'to bottom left',
                    'circle', 'ellipse', 'closest-side', 'farthest-corner', 'center',
                    'circle at center', 'ellipse at center', 'circle at top', 'ellipse at top',
                ], true)
                || preg_match('/^(circle|ellipse)\s+at\s+(center|top|bottom|left|right)$/', strtolower($first)) === 1
                || preg_match('/^at\s+(center|top|bottom|left|right)(\s+(top|bottom|left|right))?$/', strtolower($first)) === 1;
            if ($validDirection) {
                $stops = array_slice($parts, 1);
            }
        }

        // At least one color stop, each of the form <color> [ <offset>%? ].
        if ($stops === []) {
            return null;
        }
        foreach ($stops as $stop) {
            if ($stop === '') {
                return null;
            }
            // Color portion = up to the first whitespace or '%' boundary.
            $colorPart = preg_split('/[\s]/', $stop, -1, PREG_SPLIT_NO_EMPTY)[0] ?? '';
            if ($this->cleanColor($colorPart) === null) {
                return null;
            }
            // Optional offset: a plain percentage or length.
            if (preg_match('/\s/', trim($stop))) {
                $offsetPart = trim(preg_replace('/^'.preg_quote($colorPart, '/').'/', '', $stop, 1));
                if ($offsetPart !== '' && preg_match('/^-?\d+(\.\d+)?%?$/', $offsetPart) !== 1) {
                    return null;
                }
            }
        }

        return $value;
    }

    private function cleanColor(mixed $value, bool $strict = false): ?string
    {        if (! is_string($value) || $value === '') {
            return null;
        }

        // Hex (#rgb/#rrggbb/#rrggbbaa) and rgba()/rgb() CSS functions are
        // accepted (the factory emits rgba for muted tokens). Everything
        // else — url(), javascript:, expressions — is rejected in strict
        // mode and silently dropped otherwise. The renderer escapes text
        // output anyway; this only constrains style values.
        $isHex = preg_match('/^#[0-9a-fA-F]{3,8}$/', $value) === 1;
        $isRgba = preg_match('/^rgba?\(\s*[0-9.]+\s*,\s*[0-9.]+\s*,\s*[0-9.]+\s*(,\s*[0-9.]+\s*)?\)$/', $value) === 1;

        if (! $isHex && ! $isRgba) {
            if ($strict) {
                abort(422, 'مقدار رنگ نامعتبر است.');
            }

            return null;
        }

        return $value;
    }
}
