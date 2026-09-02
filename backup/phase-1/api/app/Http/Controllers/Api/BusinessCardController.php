<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Http\Requests\Business\BusinessCardRequest;
use App\Models\Business;
use App\Models\BusinessCard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
class BusinessCardController extends Controller {
 public function show(Request $request, Business $business): JsonResponse { $this->authorizeOwner($request,$business); return response()->json($business->load('cards')->cards->firstWhere('template','classic') ?? new BusinessCard(['business_id'=>$business->id,'template'=>'classic','theme'=>'navy','font_size'=>'medium'])); }
 public function save(BusinessCardRequest $request, Business $business): JsonResponse { $this->authorizeOwner($request,$business); $card=$business->cards()->updateOrCreate(['template'=>$request->validated('template')],$request->validated()); return response()->json($card); }
 private function authorizeOwner(Request $request, Business $business): void { abort_unless($request->user()?->hasRole('admin') || $business->user_id===$request->user()?->id,403); }
}
