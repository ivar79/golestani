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
 public function store(ShowcaseRequest $request,Business $business,FeatureGate $gate): JsonResponse { $this->authorizeOwner($request,$business); abort_unless($gate->allows($business,'showcase'),403); $showcase=$business->showcases()->create($request->validated()); return response()->json($showcase,201); }
 public function update(ShowcaseRequest $request,Showcase $showcase): JsonResponse { abort_unless($showcase->business?->user_id===$request->user()->id || $request->user()->hasRole('admin'),403); $showcase->update($request->validated()); return response()->json($showcase->fresh()); }
 public function destroy(Request $request,Showcase $showcase): JsonResponse { abort_unless($showcase->business?->user_id===$request->user()->id || $request->user()->hasRole('admin'),403); $showcase->delete(); return response()->json(['message'=>'ویترین حذف شد.']); }
 private function authorizeOwner(Request $request,Business $business): void { abort_unless($request->user()?->hasRole('admin') || $business->user_id===$request->user()?->id,403); }
}
