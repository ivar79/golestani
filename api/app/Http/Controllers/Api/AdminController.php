<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Advertisement;
use App\Models\Business;
use App\Models\Portfolio;
use App\Models\Showcase;
use App\Models\Subscription;
use App\Models\User;
use App\Models\Media;
use App\Models\Article;
use App\Models\PageContent;
use App\Models\SiteSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

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
        $settings = $this->homepageSettings();

        // Cache guard: an empty payload (unseeded database) is NEVER cached.
        // Caching it once blanked the whole homepage until the TTL expired —
        // even after seeding. Empty results stay uncached so the page
        // recovers on the very next request once settings exist.
        if ($settings !== []) {
            Cache::put(self::HOMEPAGE_CACHE_KEY, $settings, now()->addSeconds(self::HOMEPAGE_CACHE_TTL));
        }

        return response()->json($settings);
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
            'homepage.hero.background',
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
            // SEO (original key preserved)
            'seo.homepage',
        ];

        return SiteSetting::whereIn('key', $keys)->pluck('value', 'key')->all();
    }

    public function settings(): JsonResponse { return response()->json(SiteSetting::orderBy('key')->get()); }
    public function saveSetting(Request $request, string $key): JsonResponse { abort_unless(preg_match('/^[A-Za-z0-9._-]+$/', $key) === 1, 422); $data=$request->validate(['value'=>['nullable','string','max:10000']]); $setting=SiteSetting::updateOrCreate(['key'=>$key],['value'=>$data['value'] ?? null]); self::flushHomepageCache(); return response()->json($setting); }
    public function pages(): JsonResponse { return response()->json(PageContent::orderBy('slug')->get()); }
    public function savePage(Request $request, string $slug): JsonResponse { $data=$request->validate(['title'=>['nullable','string','max:200'],'content'=>['nullable','string','max:50000'],'seo_title'=>['nullable','string','max:200'],'seo_description'=>['nullable','string','max:500']]); return response()->json(PageContent::updateOrCreate(['slug'=>$slug],$data)); }
    public function articles(): JsonResponse { return response()->json(Article::latest()->paginate(25)); }
    public function saveArticle(Request $request, Article $article = null): JsonResponse { $data=$request->validate(['title'=>['required','string','max:200'],'content'=>['required','string'],'status'=>['required','in:draft,published'],'slug'=>['nullable','string','max:220','regex:/^[a-z0-9-]+$/'],'cover_image'=>['nullable','image','mimes:jpg,jpeg,png,webp','max:5120'],'seo_title'=>['nullable','string','max:200'],'seo_description'=>['nullable','string','max:500'],'og_title'=>['nullable','string','max:200'],'og_description'=>['nullable','string','max:500']]); if(empty($data['slug'])) $data['slug']=\Illuminate\Support\Str::slug($data['title']); $slugQuery=Article::where('slug',$data['slug']); if($article) $slugQuery->whereKeyNot($article->getKey()); abort_if($slugQuery->exists(),422,'اسلاگ مقاله تکراری است.'); if($request->hasFile('cover_image')) $data['cover_path']=$request->file('cover_image')->store('media','public'); unset($data['cover_image']); if($article){$article->update($data);return response()->json($article->fresh());} return response()->json(Article::create($data),201); }
    public function deleteArticle(Article $article): JsonResponse { $article->delete(); return response()->json(['message'=>'مقاله حذف شد.']); }
    public function media(Request $request): JsonResponse { $request->validate(['file'=>['required','file','mimes:jpg,jpeg,png,webp,pdf,svg','max:10240']]); $file=$request->file('file'); return response()->json(Media::create(['path'=>$file->store('media','public'),'original_name'=>$file->getClientOriginalName(),'mime_type'=>$file->getMimeType(),'file_size'=>$file->getSize()]),201); }
    public function mediaList(): JsonResponse { return response()->json(Media::orderByDesc('created_at')->get()); }

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
        return response()->json(User::with('roles')->latest()->paginate(25));
    }

    public function updateUser(Request $request, User $user): JsonResponse
    {
        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:120'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        $user->update($data);
        return response()->json($user->fresh('roles'));
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
