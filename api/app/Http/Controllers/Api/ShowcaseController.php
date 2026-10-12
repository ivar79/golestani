<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Http\Requests\Showcase\ShowcaseRequest;
use App\Models\Business;
use App\Models\Showcase;
use App\Services\FeatureGate;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
class ShowcaseController extends Controller {
 public function public(Business $business): JsonResponse { abort_unless($business->status==='approved',404); return response()->json($business->showcases()->where('is_published',true)->get()); }
 public function index(Request $request,Business $business): JsonResponse { $this->authorizeOwner($request,$business); return response()->json($business->showcases()->latest()->get()); }
 public function store(ShowcaseRequest $request,Business $business,FeatureGate $gate): JsonResponse { $this->authorizeOwner($request,$business); abort_unless($gate->allows($business,'showcase'),403,'ویترین نیازمند اشتراک فعال است.'); $limit=$gate->limit($business,'max_showcases'); $activeCount=(int)$business->showcases()->count(); if($limit!==null && $activeCount>=$limit){ throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json(['message'=>"سقف ویترین برای پلن شما {$limit} عدد است.",'entitlement_errors'=>['max_showcases'=>'limit_reached'],'entitlements'=>$gate->payload($business)],403)); } $data = $request->validated(); $this->enforceDescriptionLimit($data['description'] ?? null, $business, $gate); if ($request->hasFile('image')) { $path = $request->file('image')->store('businesses/showcases', 'public'); $data['image_path'] = '/storage/' . $path; } $showcase=$business->showcases()->create($data); return response()->json($showcase,201); }
 public function update(ShowcaseRequest $request,Showcase $showcase,FeatureGate $gate): JsonResponse { abort_unless($showcase->business?->user_id===$request->user()->id || $request->user()->hasRole('admin'),403); $data = $request->validated(); // Only a description that is actually being WRITTEN is checked, so an
 // admin lowering a plan's limit never blocks unrelated edits of existing
 // (previously longer) content.
 if (array_key_exists('description', $data) && $showcase->business) { $this->enforceDescriptionLimit($data['description'], $showcase->business, $gate); } if ($request->hasFile('image')) { $path = $request->file('image')->store('businesses/showcases', 'public'); $data['image_path'] = '/storage/' . $path; } $showcase->update($data); return response()->json($showcase->fresh()); }
 public function destroy(Request $request,Showcase $showcase): JsonResponse { abort_unless($showcase->business?->user_id===$request->user()->id || $request->user()->hasRole('admin'),403); $showcase->delete(); return response()->json(['message'=>'ویترین حذف شد.']); }
 private function authorizeOwner(Request $request,Business $business): void { abort_unless($request->user()?->hasRole('admin') || $business->user_id===$request->user()?->id,403); }

 /**
  * PDF Phase 5 «توضیحات کامل‌تر خدمات» — the description length is a PLAN
  * entitlement (max_description_length) enforced on the SERVER, so a direct
  * API call cannot exceed it. null = unlimited. The free-tier value is the
  * limit the dashboard editor already imposed, i.e. free behaviour is
  * unchanged; paid plans can be configured for longer copy.
  */
 private function enforceDescriptionLimit(?string $description, Business $business, FeatureGate $gate): void { $limit = $gate->limit($business, 'max_description_length'); abort_if($limit !== null && $description !== null && mb_strlen($description) > $limit, 422, "طول توضیحات برای پلن شما حداکثر {$limit} کاراکتر است."); }
}
