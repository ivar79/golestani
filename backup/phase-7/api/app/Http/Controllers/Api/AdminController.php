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

class AdminController extends Controller
{
    public function publicHomepage(): JsonResponse
    {
        $settings = SiteSetting::whereIn('key', ['homepage.hero.title','homepage.hero.subtitle','homepage.hero.buttons','homepage.hero.badges','homepage.features','homepage.cta','seo.homepage'])->pluck('value','key');
        return response()->json($settings);
    }

    public function settings(): JsonResponse { return response()->json(SiteSetting::orderBy('key')->get()); }
    public function saveSetting(Request $request, string $key): JsonResponse { $data=$request->validate(['value'=>['nullable','string','max:10000']]); return response()->json(SiteSetting::updateOrCreate(['key'=>$key],['value'=>$data['value'] ?? null])); }
    public function pages(): JsonResponse { return response()->json(PageContent::orderBy('slug')->get()); }
    public function savePage(Request $request, string $slug): JsonResponse { $data=$request->validate(['title'=>['nullable','string','max:200'],'content'=>['nullable','string','max:50000'],'seo_title'=>['nullable','string','max:200'],'seo_description'=>['nullable','string','max:500']]); return response()->json(PageContent::updateOrCreate(['slug'=>$slug],$data)); }
    public function articles(): JsonResponse { return response()->json(Article::latest()->paginate(25)); }
    public function saveArticle(Request $request, Article $article = null): JsonResponse { $data=$request->validate(['title'=>['required','string','max:200'],'content'=>['required','string'],'status'=>['required','in:draft,published'],'slug'=>['nullable','string','max:220'],'cover_image'=>['nullable','image','mimes:jpg,jpeg,png,webp','max:5120'],'seo_title'=>['nullable','string','max:200'],'seo_description'=>['nullable','string','max:500'],'og_title'=>['nullable','string','max:200'],'og_description'=>['nullable','string','max:500']]); if(empty($data['slug'])) $data['slug']=\Illuminate\Support\Str::slug($data['title']); if($request->hasFile('cover_image')) $data['cover_path']=$request->file('cover_image')->store('media','public'); unset($data['cover_image']); if($article){$article->update($data);return response()->json($article->fresh());} return response()->json(Article::create($data),201); }
    public function deleteArticle(Article $article): JsonResponse { $article->delete(); return response()->json(['message'=>'مقاله حذف شد.']); }
    public function media(Request $request): JsonResponse { $request->validate(['file'=>['required','file','mimes:jpg,jpeg,png,webp,pdf,svg','max:10240']]); $file=$request->file('file'); return response()->json(Media::create(['path'=>$file->store('media','public'),'original_name'=>$file->getClientOriginalName(),'mime_type'=>$file->getMimeType(),'file_size'=>$file->getSize()]),201); }

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
