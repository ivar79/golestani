<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Http\Requests\Advertisement\AdvertisementRequest;
use App\Models\Advertisement;
use App\Models\Business;
use App\Services\FeatureGate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
class AdvertisementController extends Controller {
 public function public(string $slot): JsonResponse
 {
  $ads = Advertisement::query()
   ->where('slot', $slot)
   ->where('status', 'approved')
   ->whereHas('business', fn ($query) => $query->where('status', 'approved'))
   ->where(fn ($query) => $query->whereNull('starts_at')->orWhereDate('starts_at', '<=', now()))
   ->where(fn ($query) => $query->whereNull('ends_at')->orWhereDate('ends_at', '>=', now()))
   ->orderByDesc('starts_at')
   ->orderByDesc('id')
   ->limit(4)
   ->get(['id', 'business_id', 'slot', 'title', 'target_url', 'image_path', 'status', 'starts_at', 'ends_at']);

  return response()->json($ads)->header('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120');
 }
 public function index(Request $request,Business $business): JsonResponse { $this->authorizeOwner($request,$business); return response()->json($business->advertisements()->latest()->get()); }
 public function store(AdvertisementRequest $request,Business $business,FeatureGate $gate): JsonResponse { $this->authorizeOwner($request,$business); abort_unless($gate->allows($business,'ads'),403,'تبلیغات نیازمند اشتراک فعال است.'); $adLimit=$gate->limit($business,'max_ads'); $totalAds=(int)$business->advertisements()->whereIn('status',['pending','approved'])->count(); if($adLimit!==null && $totalAds>=$adLimit){ throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json(['message'=>"سقف آگهی فعال برای پلن شما {$adLimit} عدد است.",'entitlement_errors'=>['max_ads'=>'limit_reached'],'entitlements'=>$gate->payload($business)],403)); } abort_if(Advertisement::where('business_id',$business->id)->where('slot',$request->validated('slot'))->whereIn('status',['pending','approved'])->count()>=4,422,'حداکثر چهار آگهی در هر جایگاه مجاز است.'); $ad=$business->advertisements()->create($request->validated()+['status'=>'pending']); return response()->json($ad,201); }
 public function destroy(Request $request, Advertisement $advertisement): JsonResponse
 {
  $business = $advertisement->business;
  abort_unless($business && ($request->user()?->hasRole('admin') || (int) $business->user_id === (int) $request->user()?->id), 403);
  $advertisement->delete();
  return response()->json(['message' => 'آگهی حذف شد.']);
 }
 private function authorizeOwner(Request $request,Business $business): void { abort_unless($request->user()?->hasRole('admin') || $business->user_id===$request->user()?->id,403); }
}
