<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Http\Requests\Subscription\SubscriptionRequest;
use App\Models\Business;
use App\Models\Plan;
use App\Models\Subscription;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
class SubscriptionController extends Controller {
 public function plans(): JsonResponse { return response()->json(Plan::where('is_active',true)->orderBy('price')->get()); }
 public function index(Request $request, Business $business): JsonResponse { $this->authorizeOwner($request,$business); return response()->json($business->subscriptions()->with('plan')->latest()->get()); }
 public function store(SubscriptionRequest $request, Business $business): JsonResponse { $this->authorizeOwner($request,$business); $plan=Plan::where('id',$request->validated('plan_id'))->where('is_active',true)->firstOrFail(); $subscription=$business->subscriptions()->create(['plan_id'=>$plan->id,'status'=>'pending_receipt','receipt_reference'=>$request->validated('receipt_reference')]); return response()->json($subscription->load('plan'),201); }
 public function moderate(Request $request, Subscription $subscription): JsonResponse { abort_unless($request->user()?->hasRole('admin'),403); $data=$request->validate(['status'=>['required','in:active,rejected,expired'],'admin_note'=>['nullable','string','max:1000']]); if($data['status']==='active'){ $data['start_date']=Carbon::today(); $data['end_date']=Carbon::today()->addDays($subscription->plan->duration_days); } $subscription->update($data); return response()->json($subscription->fresh('plan')); }
 private function authorizeOwner(Request $request,Business $business): void { abort_unless($request->user()?->hasRole('admin') || $business->user_id===$request->user()?->id,403); }
}
