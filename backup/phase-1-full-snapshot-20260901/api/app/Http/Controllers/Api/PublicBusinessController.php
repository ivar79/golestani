<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\Business;
use Endroid\QrCode\Builder\Builder;
use Endroid\QrCode\Writer\SvgWriter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
class PublicBusinessController extends Controller {
 public function show(string $slug): JsonResponse { return response()->json(Business::where('slug',$slug)->where('status','approved')->firstOrFail()->only(['name','slug','category','services','description','phone','email','address','city','neighborhood','latitude','longitude','social_links','badges','created_at','updated_at'])); }
 public function qr(string $slug): Response { $business=Business::where('slug',$slug)->where('status','approved')->firstOrFail(); $result=(new Builder(data: url('/b/'.$business->slug), writer: new SvgWriter(), size: 400, margin: 10))->build(); return response($result->getString(),200,['Content-Type'=>'image/svg+xml','Content-Disposition'=>'inline; filename="business-'.$business->slug.'.png"']); }
}
