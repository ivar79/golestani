<?php

namespace App\Http\Controllers\Api\Designer;

use App\Http\Controllers\Controller;
use App\Models\CardTemplate;
use App\Models\SiteSetting;
use App\Models\TemplateAsset;
use App\Services\CardDesignValidator;
use App\Services\FeatureGate;
use App\Services\StudioAccess;
use App\Services\TemplateAssetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Designer program + gallery submissions.
 *
 * THREE independent gates for a gallery submission (all server-checked):
 *   1. designer_status === approved   (program identity)
 *   2. custom_templates entitlement   (plan capability)
 *   3. designer_program_enabled       (master switch — closes the flow
 *      without ever erasing existing statuses)
 */
class DesignerTemplateController extends Controller
{
    public function __construct(private CardDesignValidator $validator) {}

    public static function programEnabled(): bool
    {
        return SiteSetting::query()->where('key', 'designer_program_enabled')->value('value') === '1';
    }

    /** User → request to join the designer program (status becomes pending). */
    public function requestProgram(Request $request): JsonResponse
    {
        abort_unless(self::programEnabled(), 403, 'برنامه طراحان در حال حاضر فعال نیست.');
        $user = $request->user();
        abort_unless($user !== null && in_array($user->designer_status, ['none', 'rejected', 'suspended'], true), 422, 'درخواست شما قبلاً ثبت شده یا وضعیت شما تغییرپذیر نیست.');

        $user->forceFill(['designer_status' => 'pending'])->save();

        return response()->json(['designer_status' => $user->designer_status]);
    }

    /** My program status (drives the dashboard UI). */
    public function programStatus(Request $request): JsonResponse
    {
        return response()->json([
            'designer_status' => $request->user()?->designer_status ?? 'none',
            'program_enabled' => self::programEnabled(),
        ]);
    }

    /** Approved designer submits a template to the PUBLIC gallery (pending). */
    public function store(Request $request): JsonResponse
    {
        abort_unless(self::programEnabled(), 403, 'برنامه طراحان در حال حاضر فعال نیست.');
        $user = $request->user();
        abort_unless($user !== null && $user->hasApprovedDesignerStatus(), 403, 'فقط طراحان تأییدشده می‌توانند قالب ثبت کنند.');

        // The custom_templates ENTITLEMENT is resolved from the submitter's
        // OWN business subscription (designer ≠ necessarily a business owner,
        // so absence of a business means no entitlement). Multi-business
        // users never inherit: an explicit business_id must be owned, and the
        // no-id fallback picks a business that actually passes BOTH the
        // entitlement and the studio gate (the old `businesses()->first()`
        // could read the capability from an unrelated business).
        $business = app(StudioAccess::class)->businessFor($user, (int) $request->input('business_id', 0) ?: null, 'custom_templates');
        abort_unless(app(FeatureGate::class)->allows($business, 'custom_templates'), 403, 'امکان قالب اختصاصی برای پلن شما فعال نیست.');

        // LEVEL B (gallery submission): the studio gate applies as well.
        app(StudioAccess::class)->assert($request, $business, 'gallery_submit');

        $data = $request->validate([
            'name_fa' => ['required', 'string', 'max:120'],
            'category' => ['nullable', 'string', 'max:40'],
            'design_json' => ['required', 'array'],
            'asset_paths' => ['nullable', 'array', 'max:12'],
            'asset_paths.*' => ['string', 'max:400'],
        ]);

        // Full structural validation — same whitelist, same caps (120 layers
        // / 100KB / 60KB rawD) as every other write path.
        $clean = $this->validator->validate($data['design_json']);

        // ASSET RESOLUTION: every image src must be registered in the
        // registry AND belong to THIS user (scope personal|submission).
        // A path belonging to another user — or an unregistered path — is a
        // hard 422, whatever the client claims.
        $this->resolveAssets($clean, (int) $user->id, (array) ($data['asset_paths'] ?? []));

        $template = CardTemplate::create([
            'slug' => 'designer-'.$user->id.'-'.strtolower(Str::random(8)),
            'name_fa' => $data['name_fa'],
            'category' => $data['category'] ?? 'general',
            'origin' => 'designer',
            'design_json' => json_encode($clean, JSON_UNESCAPED_UNICODE),
            'uploaded_by' => $user->id,
            'status' => 'pending',
        ]);

        return response()->json(['template' => $template->only(['id', 'slug', 'name_fa', 'status']), 'message' => 'قالب شما ثبت شد و پس از تأیید ادمین به گالری اضافه می‌شود.'], 201);
    }

    /** My gallery submissions with moderation state. */
    public function index(Request $request): JsonResponse
    {
        $templates = CardTemplate::query()
            ->where('uploaded_by', $request->user()?->id)
            ->whereNull('deleted_at')
            ->orderByDesc('id')
            ->get(['id', 'slug', 'name_fa', 'category', 'status', 'rejection_reason', 'created_at']);

        return response()->json(['templates' => $templates]);
    }

    /**
     * Admin moderation: approve/reject/archive. Approved submissions join
     * the public gallery, and approval PUBLISHES the submission-scope artwork
     * they reference (copy to the public disk — idempotent, reported, and
     * retryable via `template-assets:publish`). Review-stage artwork stays on
     * the private disk, so nothing is publicly readable before approval.
     */
    public function moderate(Request $request, CardTemplate $template): JsonResponse
    {
        $data = $request->validate([
            'action' => ['required', 'in:approve,reject,archive'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $status = match ($data['action']) {
            'approve' => 'approved',
            'reject' => 'rejected',
            'archive' => 'archived',
        };
        abort_if($data['action'] === 'reject' && empty($data['reason']), 422, 'دلیل رد قالب الزامی است.');

        $template->update([
            'status' => $status,
            'rejection_reason' => $data['action'] === 'reject' ? $data['reason'] : null,
        ]);

        // PUBLICATION (audit finding `private-template-asset-public-disk`):
        // approval is the ONLY moment submission artwork becomes publicly
        // readable — pending/rejected/archived templates keep it private. The
        // copy is idempotent and deliberately runs AFTER the status write and
        // outside any transaction: an object-store problem must never roll back
        // or block a moderation decision. Anything that could not be published
        // is reported (`unpublished`, `unpublished_count`) so the state is
        // detectable, and `php artisan template-assets:publish` retries it.
        $publication = null;
        if ($status === 'approved') {
            $publication = TemplateAssetService::publishSubmissionAssets(
                is_string($template->design_json) ? $template->design_json : json_encode($template->design_json)
            );
        }

        return response()->json([
            'template' => $template->only(['id', 'status', 'rejection_reason']),
            'publication' => $publication === null ? null : [
                'published_count' => count($publication['published']),
                'unpublished_count' => count($publication['unpublished']),
                'unpublished' => $publication['unpublished'],
            ],
        ]);
    }

    /** Admin listing with filters (origin, status). */
    public function adminIndex(Request $request): JsonResponse
    {
        $query = CardTemplate::query()->withTrashed();
        if ($origin = $request->input('origin')) {
            $query->where('origin', $origin);
        }
        if ($status = $request->input('status')) {
            $query->where('status', $status);
        }
        if ($search = $request->input('q')) {
            $query->where(function ($q) use ($search): void {
                $q->where('name_fa', 'like', "%{$search}%")->orWhere('slug', 'like', "%{$search}%");
            });
        }

        return response()->json(['templates' => $query->orderByDesc('id')->limit(200)->get()]);
    }

    /**
     * Admin CRUD store: origin=admin, status approved directly (admin
     * templates are trusted), full validation still applies.
     */
    public function adminStore(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name_fa' => ['required', 'string', 'max:120'],
            'slug' => ['nullable', 'string', 'max:80', 'regex:/^[a-z0-9-]+$/'],
            'category' => ['nullable', 'string', 'max:40'],
            'design_json' => ['required', 'array'],
            'plan_ids' => ['nullable', 'array'],
            'plan_ids.*' => ['integer'],
        ]);

        $clean = $this->validator->validate($data['design_json']);

        $template = null;
        DB::transaction(function () use (&$template, $data, $clean, $request): void {
            $template = CardTemplate::create([
                'slug' => $data['slug'] ?? ('admin-'.strtolower(Str::random(8))),
                'name_fa' => $data['name_fa'],
                'category' => $data['category'] ?? 'general',
                'origin' => 'admin',
                'design_json' => json_encode($clean, JSON_UNESCAPED_UNICODE),
                'uploaded_by' => $request->user()?->id,
                'status' => 'approved',
            ]);
            $template->plans()->sync($data['plan_ids'] ?? []);
        });

        return response()->json(['template' => $template->only(['id', 'slug', 'name_fa', 'status'])], 201);
    }

    /** Admin update: metadata, document, plan assignment, sort order. */
    public function adminUpdate(Request $request, CardTemplate $template): JsonResponse
    {
        $data = $request->validate([
            'name_fa' => ['sometimes', 'string', 'max:120'],
            'category' => ['sometimes', 'string', 'max:40'],
            'design_json' => ['sometimes', 'array'],
            'plan_ids' => ['sometimes', 'array'],
            'plan_ids.*' => ['integer'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
        ]);

        if (array_key_exists('design_json', $data)) {
            $clean = $this->validator->validate($data['design_json']);
            $this->resolveAssets($clean, null, []);
            $template->design_json = json_encode($clean, JSON_UNESCAPED_UNICODE);
        }
        foreach (['name_fa', 'category', 'sort_order'] as $field) {
            if (array_key_exists($field, $data)) {
                $template->{$field} = $data[$field];
            }
        }
        $template->save();
        if (array_key_exists('plan_ids', $data)) {
            $template->plans()->sync($data['plan_ids']);
        }

        return response()->json(['template' => $template->fresh()?->only(['id', 'slug', 'name_fa', 'category', 'sort_order'])]);
    }

    /** The template's plan assignment (stable plan_id pivot read). */
    public function adminPlans(CardTemplate $template): JsonResponse
    {
        return response()->json(['plan_ids' => $template->plans()->pluck('plans.id')]);
    }

    /** SOFT delete only — the registry and any referenced asset survive. */
    public function adminDestroy(CardTemplate $template): JsonResponse
    {
        $template->delete();

        return response()->json(['deleted' => true]);
    }

    /**
     * Resolve every image layer src against the registry. $ownerId null =
     * admin context (system-scope assets allowed); otherwise the assets
     * must be registered and owned by that user.
     */
    private function resolveAssets(array $clean, ?int $ownerId, array $declaredPaths): void
    {
        foreach ($clean['layers'] as $layer) {
            if (($layer['kind'] ?? null) !== 'image') {
                continue;
            }
            $asset = TemplateAssetService::resolve(
                $layer['src'] ?? null,
                $ownerId === null ? ['system'] : ['submission', 'personal'],
                $ownerId
            );
            abort_if($asset === null, 422, 'منبع تصویر قالب معتبر نیست یا متعلق به شما نیست: '.($layer['src'] ?? ''));
        }

        // Declared asset uploads (this submission's own files) must exist in
        // the registry and belong to the submitter — an honest manifest.
        foreach ($declaredPaths as $path) {
            $asset = TemplateAsset::query()->where('path', ltrim((string) $path, '/storage/'))->first();
            abort_if($asset === null, 422, 'فایل ارسالی در registry ثبت نشده است.');
            if ($ownerId !== null && $asset->scope !== 'system' && (int) $asset->owner_id !== $ownerId) {
                abort(422, 'فایل ارسالی متعلق به شما نیست.');
            }
        }
    }
}
