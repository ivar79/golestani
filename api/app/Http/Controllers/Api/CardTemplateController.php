<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Services\FeatureGate;
use App\Services\TemplateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public-facing template gallery + the ONE server-side apply contract.
 *
 * The gallery's `entitled` flag is UX ONLY — apply is where authorization
 * actually happens, for every template kind (builtin, DB, personal).
 */
class CardTemplateController extends Controller
{
    public function __construct(private TemplateService $templates)
    {
    }

    /** Gallery: builtin catalog + approved DB templates (public read). */
    public function index(Request $request): JsonResponse
    {
        // The gallery may be browsed anonymously; entitlement flags then
        // simply read as false (UX lock overlay). When a business context is
        // requested and authorized, real flags are computed server-side.
        $business = $this->maybeBusiness($request);

        $builtinGate = null;
        $dbGate = null;
        if ($business !== null) {
            $gate = app(FeatureGate::class);
            $builtinGate = fn (string $id): bool => $gate->allowsValue($business, 'card_templates', $id);
            $dbGate = function ($template) use ($gate, $business): bool {
                $plan = $business->subscriptions()->where('status', 'active')->latest('id')->value('plan_id');

                return $plan !== null && $template->plans()->where('plans.id', $plan)->exists();
            };
        }

        return response()->json(['templates' => $this->templates->gallery($builtinGate, $dbGate)]);
    }

    /**
     * THE apply contract, builtin flavor: authorize → clone + new ids +
     * placeholder fill → consumer entitlement shape.
     */
    public function applyBuiltin(Request $request, string $templateId): JsonResponse
    {
        $business = $this->requireBusiness($request);

        // Final server-side gate: the plan's card_templates list must contain
        // this builtin slug — whatever the UI showed.
        abort_unless(
            app(FeatureGate::class)->allowsValue($business, 'card_templates', $templateId),
            403,
            'این قالب برای پلن شما فعال نیست.'
        );

        $document = $this->templates->applyBuiltin($templateId, $this->fills($request));

        return response()->json([
            'template' => ['id' => $templateId, 'source' => 'builtin'],
            'document' => $document,
            'limits' => $this->limits($business),
        ]);
    }

    /**
     * THE apply contract, DB flavor (admin + designer templates).
     */
    public function applyDb(Request $request, int $templateId): JsonResponse
    {
        $business = $this->requireBusiness($request);

        $template = \App\Models\CardTemplate::query()->approved()->findOrFail($templateId);

        $plan = $business->subscriptions()->where('status', 'active')->latest('id')->value('plan_id');
        abort_unless(
            $plan !== null && $template->plans()->where('plans.id', $plan)->exists(),
            403,
            'این قالب برای پلن شما فعال نیست.'
        );

        $document = $this->templates->applyDb($template, $this->fills($request));

        return response()->json([
            'template' => ['id' => $template->slug, 'db_id' => $template->id, 'source' => 'db'],
            'document' => $document,
            'limits' => $this->limits($business),
        ]);
    }

    /** Resolve {business} from an explicit body/business_id (owner-checked). */
    private function requireBusiness(Request $request): Business
    {
        $businessId = (int) $request->input('business_id');
        abort_unless($businessId > 0, 422, 'کسب‌وکار مشخص نشده است.');

        $business = Business::findOrFail($businessId);
        $user = $request->user();
        abort_unless($user !== null && ($business->user_id === $user->id || $user->hasRole('admin')), 403, 'دسترسی مجاز نیست.');

        return $business;
    }

    private function maybeBusiness(Request $request): ?Business
    {
        $businessId = (int) $request->input('business_id');
        if ($businessId <= 0 || ! $request->user()) {
            return null;
        }

        $business = Business::find($businessId);
        if ($business === null || $business->user_id !== $request->user()->id) {
            return null;
        }

        return $business;
    }

    /** Business data feeding {{placeholder}} replacement. */
    private function fills(Request $request): array
    {
        $business = $this->requireBusiness($request);

        return [
            'name' => (string) $business->name,
            'category' => (string) $business->category,
            'phone' => (string) $business->phone,
            'slug' => (string) $business->slug,
            'address' => (string) $business->address,
            'website' => (string) ($business->social_links['website'] ?? ''),
        ];
    }

    /** The consumer's entitlement shape the client must honor when editing. */
    private function limits(Business $business): array
    {
        $gate = app(FeatureGate::class);

        return [
            'max_layers' => $gate->limit($business, 'max_layers'),
            'layer_kinds' => (array) ($gate->capabilities($business)['map']['card_layer_kinds'] ?? []),
            'max_premium_elements' => $gate->limit($business, 'max_premium_elements'),
        ];
    }
}
