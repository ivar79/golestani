<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Advertisement;
use App\Models\Article;
use App\Models\Business;
use App\Models\Designer;
use App\Models\Media;
use App\Models\PageContent;
use App\Models\Portfolio;
use App\Models\Role;
use App\Models\Showcase;
use App\Models\SiteSetting;
use App\Models\Subscription;
use App\Models\User;
use App\Services\AuditTrail;
use App\Services\StudioAccess;
use App\Services\StudioAccessReport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class AdminController extends Controller
{
    /** Cache key for the public homepage CMS payload. */
    public const HOMEPAGE_CACHE_KEY = 'public_homepage_v1';

    /** Cache lifetime in seconds. */
    public const HOMEPAGE_CACHE_TTL = 300;

    /**
     * Flush the cached public homepage payload. Called whenever any CMS
     * setting is saved so admins see their changes immediately.
     */
    public static function flushHomepageCache(): void
    {
        Cache::forget(self::HOMEPAGE_CACHE_KEY);
    }

    public function publicHomepage(): JsonResponse
    {
        $settings = Cache::get(self::HOMEPAGE_CACHE_KEY);

        if ($settings === null) {
            $settings = $this->homepageSettings();

            // Cache guard: an empty payload (unseeded database) is NEVER cached.
            // Caching it once blanked the whole homepage until the TTL expired —
            // even after seeding. Empty results stay uncached so the page
            // recovers on the very next request once settings exist.
            if ($settings !== []) {
                Cache::put(self::HOMEPAGE_CACHE_KEY, $settings, now()->addSeconds(self::HOMEPAGE_CACHE_TTL));
            }
        }

        return response()->json($settings ?? []);
    }

    /** Additive whitelist: original Phase 6.1 keys preserved, new homepage
     *  section keys added so the redesigned homepage is fully CMS-driven. */
    private function homepageSettings(): array
    {
        $keys = [
            // Hero (original keys preserved)
            'homepage.hero.title',
            'homepage.hero.subtitle',
            'homepage.hero.buttons',
            'homepage.hero.badges',
            'homepage.hero.button_primary',
            'homepage.hero.button_secondary',
            // Hero (additive: button links, imagery)
            'homepage.hero.button_primary_link',
            'homepage.hero.button_secondary_link',
            'homepage.hero.image',
            'homepage.hero.card_title',
            'homepage.hero.card_subtitle',
            'homepage.hero.card_phone',
            'homepage.hero.card_location',
            'homepage.hero.title_accent',
            // Features (additive: per-feature keys)
            'homepage.feature.1.title', 'homepage.feature.1.description', 'homepage.feature.1.icon',
            'homepage.feature.2.title', 'homepage.feature.2.description', 'homepage.feature.2.icon',
            'homepage.feature.3.title', 'homepage.feature.3.description', 'homepage.feature.3.icon',
            'homepage.features',
            // Showcase / how-it-works (additive)
            'homepage.showcase.title',
            'homepage.showcase.subtitle',
            'homepage.showcase.link',
            'homepage.showcase.link_href',
            'homepage.showcase.cards',
            'homepage.howitworks.title',
            'homepage.howitworks.steps',
            // CTA (original keys preserved) + additive links
            'homepage.cta.title',
            'homepage.cta.subtitle',
            'homepage.cta.button_primary',
            'homepage.cta.button_secondary',
            'homepage.cta.button_primary_link',
            'homepage.cta.button_secondary_link',
            'homepage.cta.subtitle_accent',
            // Footer (additive)
            'homepage.footer.about',
            'homepage.footer.links',
            'homepage.footer.links_title',
            'homepage.footer.copyright',
            'homepage.footer.socials',
            // Branding (additive)
            'homepage.brand',
            'homepage.logo',
            'homepage.nav.features',
            'homepage.nav.showcase',
            'homepage.nav.about',
            'homepage.nav.contact',
            'homepage.header.login',
            // Nav pricing label (additive)
            'homepage.nav.pricing',
            // Pricing page (additive) — copy + Toman plans + SEO
            'pricing.eyebrow',
            'pricing.title',
            'pricing.subtitle',
            'pricing.features_title',
            'pricing.features',
            'pricing.updates.title',
            'pricing.updates.hint',
            'pricing.updates.label1',
            'pricing.updates.label2',
            'pricing.license.title',
            'pricing.license.hint',
            'pricing.license.label1',
            'pricing.license.label2',
            'pricing.plans',
            'pricing.cta.label',
            // SEO (original key preserved)
            'seo.homepage',
            'seo.pricing',
            // Smart Greeting (additive) — dashboard welcome schedule JSON
            'dashboard.greeting.schedule',
        ];

        return SiteSetting::whereIn('key', $keys)->pluck('value', 'key')->all();
    }

    public function settings(): JsonResponse
    {
        return response()->json(SiteSetting::orderBy('key')->get());
    }

    /** The ONLY settings keys an admin may write, with their value types.
     * The CMS homepage/pricing/SEO/greeting keys stay writable exactly as
     * before (they are already whitelisted on the READ side by
     * homepageSettings); the whitelist's job is refusing ARBITRARY NEW keys,
     * not breaking existing CMS flows. */
    private const WRITABLE_SETTINGS = [
        // Designer program master switch (bool as string '1'/'0').
        'designer_program_enabled' => 'bool',
        // Studio gate ENFORCEMENT switch (staged rollout). While '0' the
        // designer-only studio gate is dormant and Level B writes behave
        // exactly as before; flipping to '1' enforces designer approval +
        // the designer_studio capability.
        'studio_designer_only' => 'bool',
    ];

    /** Keys governed by the CMS whitelist (string payloads, pre-existing). */
    private const CMS_SETTING_PREFIXES = ['homepage.', 'pricing.', 'seo.', 'dashboard.'];

    private function isWritableSetting(string $key): bool
    {
        if (array_key_exists($key, self::WRITABLE_SETTINGS)) {
            return true;
        }
        foreach (self::CMS_SETTING_PREFIXES as $prefix) {
            if (str_starts_with($key, $prefix)) {
                return true;
            }
        }

        return false;
    }

    public function saveSetting(Request $request, string $key): JsonResponse
    {
        abort_unless(preg_match('/^[A-Za-z0-9._-]+$/', $key) === 1, 422);
        // Whitelist: an arbitrary setting write would let any admin endpoint
        // mutation reconfigure parts of the product silently. Unknown keys —
        // even valid-looking ones — are refused.
        abort_unless($this->isWritableSetting($key), 422, 'کلید تنظیمات مجاز نیست.');

        // Only the explicitly-typed keys carry a bool contract; CMS keys are
        // plain strings (?? keeps the lookup total for prefix-whitelisted keys).
        if ((self::WRITABLE_SETTINGS[$key] ?? 'string') === 'bool') {
            $data = $request->validate(['value' => ['required', 'boolean']]);
            $value = $data['value'] ? '1' : '0';
        } else {
            $data = $request->validate(['value' => ['nullable', 'string', 'max:10000']]);
            $value = $data['value'] ?? null;
        }

        $setting = SiteSetting::updateOrCreate(['key' => $key], ['value' => $value]);
        self::flushHomepageCache();

        return response()->json($setting);
    }

    public function pages(): JsonResponse
    {
        return response()->json(PageContent::orderBy('slug')->get());
    }

    public function savePage(Request $request, string $slug): JsonResponse
    {
        $data = $request->validate(['title' => ['nullable', 'string', 'max:200'], 'content' => ['nullable', 'string', 'max:50000'], 'seo_title' => ['nullable', 'string', 'max:200'], 'seo_description' => ['nullable', 'string', 'max:500']]);

        return response()->json(PageContent::updateOrCreate(['slug' => $slug], $data));
    }

    public function articles(): JsonResponse
    {
        return response()->json(Article::latest()->paginate(25));
    }

    public function saveArticle(Request $request, ?Article $article = null): JsonResponse
    {
        $data = $request->validate(['title' => ['required', 'string', 'max:200'], 'content' => ['required', 'string'], 'status' => ['required', 'in:draft,published'], 'slug' => ['nullable', 'string', 'max:220', 'regex:/^[a-z0-9-]+$/'], 'cover_image' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'], 'seo_title' => ['nullable', 'string', 'max:200'], 'seo_description' => ['nullable', 'string', 'max:500'], 'og_title' => ['nullable', 'string', 'max:200'], 'og_description' => ['nullable', 'string', 'max:500']]);
        if (empty($data['slug'])) {
            $data['slug'] = Str::slug($data['title']);
        } $slugQuery = Article::where('slug', $data['slug']);
        if ($article) {
            $slugQuery->whereKeyNot($article->getKey());
        } abort_if($slugQuery->exists(), 422, 'اسلاگ مقاله تکراری است.');
        if ($request->hasFile('cover_image')) {
            $data['cover_path'] = $request->file('cover_image')->store('media', 'public');
        } unset($data['cover_image']);
        if ($article) {
            $article->update($data);

            return response()->json($article->fresh());
        }

return response()->json(Article::create($data), 201);
    }

    public function deleteArticle(Article $article): JsonResponse
    {
        $article->delete();

        return response()->json(['message' => 'مقاله حذف شد.']);
    }

    public function media(Request $request): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,pdf,svg', 'max:10240']]);
        $file = $request->file('file');

        // SVG is the only uploaded format here that can execute script when
        // opened directly (the file is served from the public disk). Reject
        // payloads carrying executable content; the nginx layer sandboxes SVG
        // responses as a second line of defense.
        $this->assertSafeSvg($file);

        return response()->json(Media::create(['path' => $file->store('media', 'public'), 'original_name' => $file->getClientOriginalName(), 'mime_type' => $file->getMimeType(), 'file_size' => $file->getSize()]), 201);
    }

    /**
     * Deny SVG files that could script the API origin: <script>/<iframe>/
     * <embed>/<foreignObject>, inline event handlers, javascript: URLs and XML
     * entities (XXE). Plain logo/illustration SVGs pass untouched.
     */
    private function assertSafeSvg(UploadedFile $file): void
    {
        $isSvg = strtolower((string) $file->getClientOriginalExtension()) === 'svg'
            || $file->getClientMimeType() === 'image/svg+xml';
        if (! $isSvg) {
            return;
        }

        $contents = (string) file_get_contents((string) $file->getRealPath());
        $unsafe = preg_match('/<\s*(script|iframe|embed|foreignObject)\b/i', $contents) === 1
            || preg_match('/\bon[a-z]+\s*=/i', $contents) === 1
            || preg_match('/javascript\s*:/i', $contents) === 1
            || preg_match('/<!ENTITY/i', $contents) === 1;

        abort_if($unsafe, 422, 'فایل SVG ناایمن رد شد.');
    }

    public function mediaList(): JsonResponse
    {
        return response()->json(Media::orderByDesc('created_at')->get());
    }

    public function health(): JsonResponse
    {
        $database = ['ok' => false, 'driver' => DB::connection()->getDriverName()];
        $postgis = ['ok' => false, 'version' => null];
        $redis = ['ok' => false];

        try {
            DB::select('select 1');
            $database['ok'] = true;
            if ($database['driver'] === 'pgsql') {
                $postgis['version'] = DB::selectOne('select PostGIS_Version() as version')->version ?? null;
                $postgis['ok'] = $postgis['version'] !== null;
            }
        } catch (\Throwable $e) {
            report($e);
        }

        try {
            Redis::connection()->ping();
            $redis['ok'] = true;
        } catch (\Throwable $e) {
            report($e);
        }

        return response()->json([
            'status' => $database['ok'] && ($database['driver'] !== 'pgsql' || $postgis['ok']) ? 'ok' : 'degraded',
            'checked_at' => now()->toIso8601String(),
            'database' => $database,
            'postgis' => $postgis,
            'redis' => $redis,
            'storage' => ['ok' => is_writable(storage_path('app'))],
        ]);
    }

    public function auditLog(Request $request): JsonResponse
    {
        $data = $request->validate([
            'event' => ['nullable', 'string', 'max:100'],
            'subject_type' => ['nullable', 'string', 'max:60'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $query = DB::table('audit_events')->orderByDesc('id');
        if (! empty($data['event'])) {
            $query->where('event', $data['event']);
        }
        if (! empty($data['subject_type'])) {
            $query->where('subject_type', $data['subject_type']);
        }

        return response()->json($query->paginate(50));
    }

    public function overview(): JsonResponse
    {
        return response()->json([
            'counts' => [
                'users' => User::count(),
                'businesses_pending' => Business::where('status', 'pending')->count(),
                'subscriptions_pending' => Subscription::where('status', 'pending_receipt')->count(),
                'showcases_pending' => Showcase::where('is_published', false)->count(),
                'advertisements_pending' => Advertisement::where('status', 'pending')->count(),
                'portfolios_pending' => Portfolio::where('status', 'pending')->count(),
            ],
            'recent_users' => User::latest()->limit(8)->get(['id', 'phone', 'name', 'is_active', 'created_at']),
            'queues' => [
                'businesses' => Business::with('owner:id,phone')->whereIn('status', ['pending', 'rejected', 'suspended'])->latest()->limit(20)->get(),
                'subscriptions' => Subscription::with(['business:id,name', 'plan:id,name'])->where('status', 'pending_receipt')->latest()->limit(20)->get(),
                'showcases' => Showcase::with('business:id,name')->where('is_published', false)->latest()->limit(20)->get(),
                'advertisements' => Advertisement::with('business:id,name')->where('status', 'pending')->latest()->limit(20)->get(),
                'portfolios' => Portfolio::with('designer:id,display_name,slug')->where('status', 'pending')->latest()->limit(20)->get(),
            ],
        ]);
    }

    public function users(): JsonResponse
    {
        // designer:id,user_id,status feeds the divergence badge: the legacy
        // `designers` row and the canonical users.designer_status must never
        // silently disagree again.
        return response()->json(User::with(['roles', 'designer:id,user_id,status'])->latest()->paginate(25));
    }

    public function updateUser(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:120'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        $roles = $request->input('roles');
        unset($data['roles']);
        $user->update($data);
        if (is_array($roles)) {
            $roleNames = array_values(array_unique(array_map('strval', $roles)));
            $roleIds = Role::whereIn('name', $roleNames)->pluck('id', 'name');
            abort_if($roleIds->count() !== count($roleNames), 422, 'یکی از نقش‌های انتخاب‌شده معتبر نیست.');
            if ($user->is($request->user()) && ! in_array('admin', $roleNames, true)) {
                abort(422, 'مدیر نمی‌تواند نقش مدیریتی خودش را حذف کند.');
            }
            if ($user->hasRole('admin') && ! in_array('admin', $roleNames, true) && User::whereHas('roles', fn ($query) => $query->where('name', 'admin'))->count() <= 1) {
                abort(422, 'آخرین مدیر سامانه قابل تنزل نیست.');
            }
            $user->roles()->sync($roleIds->values());
        }

        // Admin mutations are audited (role/status changes were previously
        // invisible in the audit trail).
        AuditTrail::record($request->user()?->id, 'admin.user_updated', 'user', $user->id, [
            'is_active' => array_key_exists('is_active', $data) ? (bool) $data['is_active'] : null,
            'name_changed' => array_key_exists('name', $data),
            'roles' => is_array($roles) ? array_values(array_unique(array_map('strval', $roles))) : null,
        ]);

        return response()->json($user->fresh(['roles', 'designer:id,user_id,status']));
    }

    /**
     * PATCH /admin/users/{user}/designer-status — the CANONICAL designer
     * approval workflow.
     *
     * One transaction: users.designer_status (source of truth) + the designer
     * ROLE (derived) + the legacy `designers` row (kept in sync) + an audit
     * entry. Reject/suspend require a reason; the admin can never be locked
     * out of their own account by a status change (the admin role is never
     * touched).
     */
    public function updateDesignerStatus(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'designer_status' => ['required', 'in:none,pending,approved,rejected,suspended'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);

        $status = $data['designer_status'];
        abort_if(
            in_array($status, ['rejected', 'suspended'], true) && empty($data['reason']),
            422,
            'برای رد یا تعلیق وضعیت طراح، ثبت دلیل الزامی است.'
        );

        DB::transaction(function () use ($request, $user, $status, $data): void {
            /** @var User $locked */
            $locked = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            $previous = (string) ($locked->designer_status ?? 'none');

            $locked->forceFill(['designer_status' => $status])->save();

            // The designer role FOLLOWS the canonical status (access is
            // always role-driven; the status alone opens no endpoint).
            $roleAction = 'preserved';
            if ($status === 'approved') {
                $locked->assignRole('designer');
                $roleAction = 'assigned';
            } elseif ($locked->hasRole('designer')) {
                $designerRoleId = Role::query()->where('name', 'designer')->value('id');
                if ($designerRoleId !== null) {
                    $locked->roles()->detach($designerRoleId);
                    $locked->unsetRelation('roles');
                    $roleAction = 'removed';
                }
            }

            // Legacy program profile — keep both designer concepts in sync.
            $designer = Designer::query()->where('user_id', $locked->id)->first();
            if ($designer !== null) {
                $designer->forceFill([
                    'status' => $status === 'none' ? 'pending' : $status,
                    'moderation_note' => $data['reason'] ?? $designer->moderation_note,
                ])->save();
            }

            AuditTrail::record($request->user()?->id, 'admin.designer_status_changed', 'user', $locked->id, [
                'from' => $previous,
                'to' => $status,
                'reason' => $data['reason'] ?? null,
                'role' => $roleAction,
                'designer_row' => $designer !== null,
            ]);
        });

        return response()->json($user->fresh(['roles', 'designer:id,user_id,status']));
    }

    /** GET /admin/studio/report — the studio rollout board (read-only). */
    public function studioReport(Request $request): JsonResponse
    {
        return response()->json(app(StudioAccessReport::class)->build());
    }

    public function moderateBusiness(Request $request, Business $business): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'in:approved,rejected,suspended,pending'],
            'moderation_note' => ['nullable', 'string', 'max:1000'],
        ]);
        $business->update($data);

        return response()->json($business->fresh('owner:id,phone'));
    }

    public function moderateShowcase(Request $request, Showcase $showcase): JsonResponse
    {
        $data = $request->validate(['is_published' => ['required', 'boolean']]);
        $showcase->update($data);

        return response()->json($showcase->fresh('business:id,name'));
    }

    public function moderateAdvertisement(Request $request, Advertisement $advertisement): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'in:approved,rejected,suspended,pending'],
            'admin_note' => ['nullable', 'string', 'max:1000'],
        ]);
        $advertisement->update($data);

        return response()->json($advertisement->fresh('business:id,name'));
    }
}
