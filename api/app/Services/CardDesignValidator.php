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

    private const MAX_LAYERS = 60;

    private const MAX_STRING = 2_000;

    /** Max length of a serialized CSS gradient background. */
    private const MAX_GRADIENT = 1_200;

    private const LAYER_KINDS = ['text', 'image', 'qr', 'badge', 'shape', 'path'];

    private const SHAPE_KINDS = ['rect', 'ellipse', 'triangle', 'line', 'arrow', 'star', 'polygon'];

    /** Vector stroke decorations — shared by shape and path layers. */
    private const STROKE_STYLES = ['solid', 'dashed', 'dotted'];

    private const LINE_CAPS = ['butt', 'round', 'square'];

    private const LINE_JOINS = ['miter', 'round', 'bevel'];

    private const FONT_FAMILIES = ['vazir', 'sans', 'serif', 'monospace'];

    private const MAX_PATH_POINTS = 500;

    private const IMAGE_PREFIXES = ['storage/', '/storage/'];

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

        return [
            'version' => 1,
            'artboard' => ['width' => $artboard['width'], 'height' => $artboard['height']],
            'background' => $cleanBackground,
            'layers' => $cleanLayers,
        ];
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
                break;
            case 'path':
                // Freehand Bezier strokes (EditorEngine freehand tool). Points
                // are stored relative to the layer box; optional cubic handles
                // hIn/hOut sit on each anchor.
                $clean['closed'] = (bool) ($layer['closed'] ?? false);
                $points = $layer['points'] ?? [];
                abort_if(! is_array($points) || ! array_is_list($points), 422, 'نقاط مسیر نامعتبر است.');
                abort_if(count($points) < 2 || count($points) > self::MAX_PATH_POINTS, 422, 'تعداد نقاط مسیر نامعتبر است.');
                $clean['points'] = array_map(
                    fn ($point): array => $this->cleanPathPoint($point),
                    $points
                );
                $clean['stroke'] = $this->cleanColor($layer['stroke'] ?? null) ?? '#0ea5e9';
                $clean['strokeWidth'] = $this->cleanNumber($layer['strokeWidth'] ?? 4, 0.5, 100);
                $clean['strokeStyle'] = $this->cleanEnum($layer['strokeStyle'] ?? null, self::STROKE_STYLES, 'solid');
                $clean['strokeLinecap'] = $this->cleanEnum($layer['strokeLinecap'] ?? null, self::LINE_CAPS, 'round');
                $clean['strokeLinejoin'] = $this->cleanEnum($layer['strokeLinejoin'] ?? null, self::LINE_JOINS, 'round');
                $clean['strokeOpacity'] = $this->cleanNumber($layer['strokeOpacity'] ?? 1, 0, 1);
                $clean['fill'] = $this->cleanColor($layer['fill'] ?? null);
                break;
        }

        return $clean;
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
