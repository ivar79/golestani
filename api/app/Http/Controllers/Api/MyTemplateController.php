<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\UserCardTemplate;
use App\Services\CardDesignValidator;
use App\Services\FeatureGate;
use App\Services\StudioAccess;
use App\Services\TemplateAssetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * PRIVATE personal templates (custom_templates entitlement).
 *
 * Contract:
 *   - owner-only, end to end; no moderation, no gallery;
 *   - every document passes the SAME structural validator (caps intact);
 *   - every image src resolves against the registry scoped to THIS user;
 *   - delete (soft) NEVER touches assets: applied cards keep resolving
 *     their references from the immutable registry;
 *   - apply runs the ONE server pipeline: ownership → clone + new ids +
 *     placeholder fill → consumer limits.
 */
class MyTemplateController extends Controller
{
    public function __construct(private CardDesignValidator $validator)
    {
    }

    /** The requester's business used for entitlement checks + fills. */
    private function entitledBusiness(Request $request): Business
    {
        $user = $request->user();
        abort_unless($user !== null, 401);

        // Multi-business resolution: an explicit business_id must be OWNED;
        // otherwise the first owned business that actually passes BOTH the
        // entitlement and the studio gate is used. A capability is never
        // inherited from a different business of the same user.
        $business = app(StudioAccess::class)->businessFor(
            $user,
            (int) $request->input('business_id', 0) ?: null,
            'custom_templates',
        );
        abort_unless(app(FeatureGate::class)->allows($business, 'custom_templates'), 403, 'قالب اختصاصی نیازمند پلن فعال با این امکان است.');

        return $business;
    }

    public function index(Request $request): JsonResponse
    {
        $templates = UserCardTemplate::query()
            ->where('user_id', $request->user()?->id)
            ->whereNull('deleted_at')
            ->orderByDesc('id')
            ->get(['id', 'name_fa', 'category', 'created_at']);

        return response()->json(['templates' => $templates]);
    }

    public function store(Request $request): JsonResponse
    {
        $business = $this->entitledBusiness($request);
        // LEVEL B: creating a personal template writes a design document.
        app(StudioAccess::class)->assert($request, $business, 'personal_template.store');

        $data = $request->validate([
            'name_fa' => ['required', 'string', 'max:120'],
            'category' => ['nullable', 'string', 'max:40'],
            'design_json' => ['required', 'array'],
        ]);

        $clean = $this->validator->validate($data['design_json']);
        $this->resolveAssets($clean, (int) $request->user()?->id);

        $template = UserCardTemplate::create([
            'user_id' => $request->user()?->id,
            'name_fa' => $data['name_fa'],
            'category' => $data['category'] ?? 'general',
            'design_json' => json_encode($clean, JSON_UNESCAPED_UNICODE),
        ]);

        return response()->json(['template' => $template->only(['id', 'name_fa', 'category'])], 201);
    }

    public function update(Request $request, UserCardTemplate $template): JsonResponse
    {
        abort_unless((int) $template->user_id === (int) $request->user()?->id, 403, 'این قالب متعلق به شما نیست.');
        $business = $this->entitledBusiness($request);
        // LEVEL B: updating a personal template mutates a design document.
        app(StudioAccess::class)->assert($request, $business, 'personal_template.update');

        $data = $request->validate([
            'name_fa' => ['sometimes', 'string', 'max:120'],
            'category' => ['sometimes', 'string', 'max:40'],
            'design_json' => ['sometimes', 'array'],
        ]);

        if (array_key_exists('design_json', $data)) {
            $clean = $this->validator->validate($data['design_json']);
            $this->resolveAssets($clean, (int) $request->user()?->id);
            $template->design_json = json_encode($clean, JSON_UNESCAPED_UNICODE);
        }
        foreach (['name_fa', 'category'] as $field) {
            if (array_key_exists($field, $data)) {
                $template->{$field} = $data[$field];
            }
        }
        $template->save();

        return response()->json(['template' => $template->only(['id', 'name_fa', 'category'])]);
    }

    /** Soft delete ONLY. Assets + registry rows are never touched. */
    public function destroy(Request $request, UserCardTemplate $template): JsonResponse
    {
        abort_unless((int) $template->user_id === (int) $request->user()?->id, 403, 'این قالب متعلق به شما نیست.');
        $business = $this->entitledBusiness($request);
        app(StudioAccess::class)->assert($request, $business, 'personal_template.delete');
        $template->delete();

        return response()->json(['deleted' => true]);
    }

    /** Server-side apply for a private template (the ONE apply contract). */
    public function apply(Request $request, UserCardTemplate $template): JsonResponse
    {
        $user = $request->user();
        abort_unless($user !== null && (int) $template->user_id === (int) $user->id, 403, 'این قالب متعلق به شما نیست.');
        $business = $this->entitledBusiness($request);
        app(StudioAccess::class)->assert($request, $business, 'personal_template.apply');

        $document = app(\App\Services\TemplateService::class)->applyPersonal($template, [
            'name' => (string) $business->name,
            'category' => (string) $business->category,
            'phone' => (string) $business->phone,
            'slug' => (string) $business->slug,
            'address' => (string) $business->address,
            'website' => (string) ($business->social_links['website'] ?? ''),
        ]);

        $gate = app(FeatureGate::class);

        return response()->json([
            'template' => ['id' => $template->id, 'source' => 'personal'],
            'document' => $document,
            'limits' => [
                'max_layers' => $gate->limit($business, 'max_layers'),
                'layer_kinds' => (array) ($gate->capabilities($business)['map']['card_layer_kinds'] ?? []),
                'max_premium_elements' => $gate->limit($business, 'max_premium_elements'),
            ],
        ]);
    }

    /** Upload a personal asset: verify + register (scope=personal). */
    public function uploadAsset(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user !== null, 401);
        $business = $this->entitledBusiness($request);
        // LEVEL B: the asset exists to author a personal template design.
        app(StudioAccess::class)->assert($request, $business, 'personal_template.asset');

        $request->validate(['image' => array_merge(['required'], TemplateAssetService::UPLOAD_RULES)]);

        $asset = TemplateAssetService::storeUpload($request->file('image'), 'personal', (int) $user->id);

        return response()->json([
            'asset' => [
                'path' => $asset->path,
                'src' => TemplateAssetService::srcForPath($asset->path),
                'width' => $asset->width,
                'height' => $asset->height,
            ],
        ], 201);
    }

    /** Every image src must be a registry row owned by this user. */
    private function resolveAssets(array $clean, int $ownerId): void
    {
        foreach ($clean['layers'] as $layer) {
            if (($layer['kind'] ?? null) !== 'image') {
                continue;
            }
            $asset = TemplateAssetService::resolve($layer['src'] ?? null, ['personal', 'submission'], $ownerId);
            abort_if($asset === null, 422, 'منبع تصویر در دارایی‌های ثبت‌شده شما یافت نشد.');
        }
    }
}
