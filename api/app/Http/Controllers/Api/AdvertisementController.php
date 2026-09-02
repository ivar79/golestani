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
 public function public(string $slot): JsonResponse { return response()->json(Advertisement::where('slot',$slot)->where('status','approved')->where(function($q):void{$q->whereNull('starts_at')->orWhereDate('starts_at','<=',now());})->where(function($q):void{$q->whereNull('ends_at')->orWhereDate('ends_at','>=',now());})->limit(4)->get()); }
 public function index(Request $request,Business $business): JsonResponse { $this->authorizeOwner($request,$business); return response()->json($business->advertisements()->latest()->get()); }
 public function store(AdvertisementRequest $request,Business $business,FeatureGate $gate): JsonResponse { $this->authorizeOwner($request,$business); abort_unless($gate->allows($business,'ads'),403); abort_if(Advertisement::where('business_id',$business->id)->where('slot',$request->validated('slot'))->whereIn('status',['pending','approved'])->count()>=4,422,'حداکثر چهار آگهی در هر جایگاه مجاز است.'); $ad=$business->advertisements()->create($request->validated()+['status'=>'pending']); return response()->json($ad,201); }
 private function authorizeOwner(Request $request,Business $business): void { abort_unless($request->user()?->hasRole('admin') || $business->user_id===$request->user()?->id,403); }
}
