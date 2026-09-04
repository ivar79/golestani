<?php
namespace App\Http\Controllers\Api\Designer;
use App\Http\Controllers\Controller;
use App\Http\Requests\Designer\DesignerRequest;
use App\Http\Requests\Designer\PortfolioRequest;
use App\Models\Designer;
use App\Models\Portfolio;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
class DesignerController extends Controller {
 public function profile(Request $request): JsonResponse { $designer=Designer::with('portfolios')->firstOrCreate(['user_id'=>$request->user()->id],['display_name'=>'طراح اینکارت','slug'=>'designer-'.Str::lower(Str::random(8)),'status'=>'pending']); return response()->json($designer->load('portfolios')); }
 public function update(DesignerRequest $request): JsonResponse { $designer=Designer::firstOrCreate(['user_id'=>$request->user()->id],['display_name'=>$request->validated('display_name'),'slug'=>'designer-'.Str::lower(Str::random(8)),'status'=>'pending']); $designer->update($request->validated()+['status'=>'pending','moderation_note'=>null]); return response()->json($designer->fresh()); }
 public function portfolios(Request $request): JsonResponse { return response()->json($this->ownedDesigner($request)->portfolios()->latest()->get()); }
 public function storePortfolio(PortfolioRequest $request): JsonResponse { $designer=$this->ownedDesigner($request); $file=$request->file('file'); $portfolio=$designer->portfolios()->create(['title'=>$request->validated('title'),'description'=>$request->validated('description'),'file_path'=>$file->store('portfolios'),'mime_type'=>$file->getMimeType(),'file_size'=>$file->getSize(),'status'=>'pending']); return response()->json($portfolio,201); }
 public function destroyPortfolio(Request $request, Portfolio $portfolio): JsonResponse { abort_unless($portfolio->designer?->user_id===$request->user()->id || $request->user()->hasRole('admin'),403); $portfolio->delete(); return response()->json(['message'=>'نمونه‌کار حذف شد.']); }
 public function moderate(Request $request, Portfolio $portfolio): JsonResponse { abort_unless($request->user()->hasRole('admin'),403); $data=$request->validate(['status'=>['required','in:approved,rejected,suspended'],'moderation_note'=>['nullable','string','max:1000']]); $portfolio->update($data); return response()->json($portfolio->fresh()); }
 private function ownedDesigner(Request $request): Designer { return Designer::where('user_id',$request->user()->id)->firstOrFail(); }
}
