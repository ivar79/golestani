<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller; use App\Http\Requests\Business\BusinessRequest; use App\Models\Business; use Illuminate\Http\JsonResponse; use Illuminate\Http\Request; use Illuminate\Support\Str;
class BusinessController extends Controller {
 public function index(Request $request): JsonResponse { return response()->json($request->user()->businesses()->latest()->get()); }
 public function store(BusinessRequest $request): JsonResponse { $b=$request->user()->businesses()->create($this->payload($request)); return response()->json($b,201); }
 public function show(Business $business): JsonResponse { return response()->json($business->load('owner:id,phone')); }
 public function update(BusinessRequest $request,Business $business): JsonResponse { $this->authorizeOwner($request,$business); $data=$this->payload($request); unset($data['slug']); $business->update($data+['status'=>'pending','moderation_note'=>null]); return response()->json($business->fresh()); }
 public function destroy(Request $request,Business $business): JsonResponse { $this->authorizeOwner($request,$business); $business->delete(); return response()->json(['message'=>'پروفایل کسب‌وکار حذف شد.']); }


 public function moderate(Request $request,Business $business): JsonResponse { abort_unless($request->user()?->hasRole('admin'),403); $data=$request->validate(['status'=>['required','in:approved,rejected,suspended'],'moderation_note'=>['nullable','string','max:1000']]); $business->update($data); return response()->json($business->fresh()); }
 private function payload(BusinessRequest $request): array { $data=$request->validated(); $data['slug']=Str::slug($data['name']).'-'.Str::lower(Str::random(8)); return $data+['status'=>'pending']; }
 private function authorizeOwner(Request $request,Business $business): void { abort_unless($request->user()?->hasRole('admin')||$business->user_id===$request->user()?->id,403); }
}
