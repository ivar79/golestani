<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Models\BusinessImage;
use App\Services\BusinessAudit;
use App\Services\BusinessMedia;
use App\Services\BusinessPublication;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
class BusinessImageController extends Controller
{
    private function authorizeOwner(Request $r, Business $b): void
    {
        abort_unless($r->user()?->hasRole('admin') || (int) $b->user_id === (int) $r->user()?->id, 403);
    }
    public function index(Request $r, Business $business): JsonResponse
    {
        $this->authorizeOwner($r, $business);
        return response()->json($business->images()->get());
    }
    public function store(Request $r, Business $business): JsonResponse
    {
        $this->authorizeOwner($r, $business);
        $r->validate(['image'=>array_merge(['required'], BusinessMedia::rules()), 'alt'=>['nullable','string','max:160']]);
        $path = BusinessMedia::store($r->file('image'), 'gallery');
        try {
            $image = DB::transaction(function () use ($r,$business,$path) {
                $b = Business::lockForUpdate()->findOrFail($business->id);
                $this->authorizeOwner($r, $b);
                abort_if($b->images()->count() >= config('business.gallery_limit'), 422, 'حداکثر پنج تصویر مجاز است.');
                $image = $b->images()->create(['path'=>$path,'alt'=>$r->input('alt')]);
                BusinessPublication::invalidate($b);
                BusinessAudit::record($r, 'business.image_added', $b->id, ['image_id'=>$image->id,'to_status'=>$b->status]);
                return $image;
            });
        } catch (\Throwable $e) { BusinessMedia::cleanup($path); throw $e; }
        Cache::forget('search_facets_v1');
        return response()->json($image, 201);
    }
    public function destroy(Request $r, Business $business, BusinessImage $image): JsonResponse
    {
        $path = DB::transaction(function () use ($r,$business,$image) {
            $b = Business::lockForUpdate()->findOrFail($business->id);
            $this->authorizeOwner($r, $b);
            // Scope the image to this business, even when IDs are guessed.
            $owned = $b->images()->whereKey($image->id)->firstOrFail();
            $path = $owned->path;
            $owned->delete();
            BusinessPublication::invalidate($b);
            BusinessAudit::record($r, 'business.image_deleted', $b->id, ['image_id'=>$image->id,'to_status'=>$b->status]);
            return $path;
        });
        BusinessMedia::cleanup($path);
        Cache::forget('search_facets_v1');
        return response()->json(['message'=>'تصویر حذف شد.']);
    }
}
