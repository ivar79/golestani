<?php

namespace App\Services;

use App\Models\Business;
use App\Models\BusinessCard;
use App\Models\CardTemplate;
use App\Models\UserCardTemplate;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * THE canonical studio apply pipeline (approved plan, amendment 4):
 *
 *   authorize → entitlement → materialize (clone + fresh ids + placeholder
 *   fill) → structural validation → design entitlement accounting → persist,
 *   all in ONE transaction.
 *
 * The client never sends a document: it names a SOURCE + a template id/slug.
 * Every template kind runs through the same path, so the gallery, the card
 * editor and the studio can never diverge on what "apply" means.
 */
class StudioTemplateApply
{
    public function __construct(
        private TemplateService $templates,
        private CardDesignValidator $validator,
    ) {
    }

    /**
     * @return array{
     *     template: array<string, mixed>,
     *     document: array<string, mixed>,
     *     card: array<string, mixed>,
     *     limits: array<string, mixed>,
     *     studio: array<string, mixed>
     * }
     */
    public function apply(Request $request, Business $business, string $source, mixed $templateId, ?int $cardId = null): array
    {
        $user = $request->user();
        abort_unless($user !== null, 401);

        $gate = app(FeatureGate::class);

        // 1. LEVEL B studio gate (designer approval + designer_studio
        //    capability, staged switch, audited admin bypass).
        $studio = app(StudioAccess::class)->assert($request, $business, 'template_apply');

        // 2. The layered document itself is a card_editor feature.
        if (! $gate->allows($business, 'card_editor')) {
            abort(response()->json([
                'message' => 'ویرایشگر پیشرفته کارت نیازمند اشتراک فعال است.',
                'entitlement_errors' => ['card_editor' => 'locked'],
                'entitlements' => $gate->payload($business),
            ], 403));
        }

        // 3. Source resolution + per-source entitlement.
        [$document, $templateMeta] = $this->resolve($request, $business, $source, $templateId);

        // 4. Structural validation of the MATERIALIZED document (placeholder
        //    fills + source data can still produce something unstorable).
        $clean = $this->validator->validate($document);

        // 5. Design entitlement accounting — the same growth-over-baseline
        //    contract as the card save endpoint (the stored document of the
        //    TARGET card is the grandfathering baseline).
        $stored = $this->targetCard($business, $cardId);
        $storedDesign = ($stored !== null && is_array($stored->design_json)) ? $stored->design_json : null;
        $designErrors = app(DesignEntitlements::class)->violations($business, $storedDesign, $clean);
        if ($designErrors !== []) {
            abort(response()->json([
                'message' => 'قالب شامل عناصری است که پلن این کسب‌وکار مجاز نمی‌داند.',
                'entitlement_errors' => $designErrors,
                'entitlements' => $gate->payload($business),
            ], 403));
        }

        // 6. Persist — one transaction, serialized per business.
        $card = DB::transaction(function () use ($business, $clean, $cardId): BusinessCard {
            $business->newQuery()->whereKey($business->id)->lockForUpdate()->first();

            /** @var BusinessCard|null $card */
            $card = $this->targetCard($business, $cardId);

            if ($card === null) {
                $limit = app(FeatureGate::class)->limit($business, 'max_cards');
                if ($limit !== null && $business->cards()->count() >= $limit) {
                    abort(response()->json([
                        'message' => "سقف کارت برای پلن شما {$limit} عدد است.",
                        'entitlement_errors' => ['max_cards' => 'limit_reached'],
                        'entitlements' => app(FeatureGate::class)->payload($business),
                    ], 403));
                }

                $card = new BusinessCard([
                    'business_id' => $business->id,
                    'template' => 'classic',
                    'theme' => 'navy',
                    'font_size' => 'medium',
                    'font_family' => 'sans',
                ]);
            }

            $card->design_json = $clean;
            $card->save();

            return $card;
        });

        $fresh = $card->fresh();

        return [
            'template' => $templateMeta,
            'document' => $clean,
            'card' => $fresh->toArray() + $fresh->printFileMeta(),
            'limits' => [
                'max_layers' => $gate->limit($business, 'max_layers'),
                'layer_kinds' => (array) ($gate->capabilities($business)['map']['card_layer_kinds'] ?? []),
                'max_premium_elements' => $gate->limit($business, 'max_premium_elements'),
            ],
            'studio' => $studio,
        ];
    }

    /**
     * The target card for this apply.
     *
     * An explicit `card_id` MUST belong to the business (403 otherwise) and is
     * the exact target; without it the legacy `latest('id')` behavior is
     * preserved so existing clients are unaffected. Never deletes a card.
     */
    private function targetCard(Business $business, ?int $cardId): ?BusinessCard
    {
        if ($cardId !== null && $cardId > 0) {
            $card = $business->cards()->whereKey($cardId)->first();
            abort_if($card === null, 403, 'این کارت متعلق به این کسب‌وکار نیست.');

            return $card;
        }

        return $business->cards()->latest('id')->first();
    }

    /**
     * Resolve a template source into [materialized document, template meta].
     *
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private function resolve(Request $request, Business $business, string $source, mixed $templateId): array
    {
        $fills = [
            'name' => (string) $business->name,
            'category' => (string) $business->category,
            'phone' => (string) $business->phone,
            'slug' => (string) $business->slug,
            'address' => (string) $business->address,
            'website' => (string) ($business->social_links['website'] ?? ''),
        ];

        return match ($source) {
            'builtin' => $this->resolveBuiltin($business, (string) $templateId, $fills),
            'db' => $this->resolveDb($business, $templateId, $fills),
            'personal' => $this->resolvePersonal($request, $business, (int) $templateId, $fills),
            default => abort(422, 'منبع قالب پشتیبانی نمی‌شود.'),
        };
    }

    private function resolveBuiltin(Business $business, string $templateId, array $fills): array
    {
        abort_if($templateId === '', 422, 'قالب مشخص نشده است.');

        // Final server-side gate: the plan's card_templates list must contain
        // this builtin slug — whatever the UI showed.
        abort_unless(
            app(FeatureGate::class)->allowsValue($business, 'card_templates', $templateId),
            403,
            'این قالب برای پلن شما فعال نیست.'
        );

        return [
            $this->templates->applyBuiltin($templateId, $fills),
            ['id' => $templateId, 'source' => 'builtin'],
        ];
    }

    private function resolveDb(Business $business, mixed $templateId, array $fills): array
    {
        $template = is_numeric($templateId)
            ? CardTemplate::query()->approved()->findOrFail((int) $templateId)
            : CardTemplate::query()->approved()->where('slug', (string) $templateId)->firstOrFail();

        // Same plan-pivot contract as the gallery apply endpoint (stable
        // plan_id — never plan names).
        $plan = $business->subscriptions()->where('status', 'active')->latest('id')->value('plan_id');
        abort_unless(
            $plan !== null && $template->plans()->where('plans.id', $plan)->exists(),
            403,
            'این قالب برای پلن شما فعال نیست.'
        );

        return [
            $this->templates->applyDb($template, $fills),
            ['id' => $template->slug, 'db_id' => $template->id, 'source' => 'db'],
        ];
    }

    private function resolvePersonal(Request $request, Business $business, int $templateId, array $fills): array
    {
        $user = $request->user();

        /** @var UserCardTemplate|null $template */
        $template = UserCardTemplate::query()->whereNull('deleted_at')->find($templateId);
        abort_if($template === null, 404, 'قالب شخصی یافت نشد.');

        // Ownership is NEVER bypassed (not even for admins — amendment 5).
        abort_unless($user !== null && (int) $template->user_id === (int) $user->id, 403, 'این قالب متعلق به شما نیست.');

        abort_unless(
            app(FeatureGate::class)->allows($business, 'custom_templates'),
            403,
            'قالب اختصاصی نیازمند پلن فعال با این امکان است.'
        );

        return [
            $this->templates->applyPersonal($template, $fills),
            ['id' => $template->id, 'source' => 'personal'],
        ];
    }
}
