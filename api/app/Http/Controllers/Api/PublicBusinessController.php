<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Support\BusinessUrl;
use Endroid\QrCode\Builder\Builder;
use Endroid\QrCode\Writer\SvgWriter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;
class PublicBusinessController extends Controller
{
    public function show(string $slug): JsonResponse
    {
        $b = Business::where('slug', $slug)->where('status', 'approved')->firstOrFail();
        $data = $b->only(['name','slug','category','services','description','phone','email','address','city','neighborhood','latitude','longitude','social_links','badges','logo','cover_image','created_at','updated_at']);
        $data['images'] = $b->images()->get(['id','path','alt']);
        $data['public_url'] = BusinessUrl::public($b);
        return response()->json($data)->header('Cache-Control', 'no-store');
    }
    public function qr(string $slug): Response
    {
        $b = Business::where('slug', $slug)->where('status', 'approved')->firstOrFail();
        $qr = (new Builder(data: BusinessUrl::public($b), writer: new SvgWriter(), size: 400, margin: 10))->build();
        return response($qr->getString(), 200, [
            'Content-Type' => 'image/svg+xml',
            'Content-Disposition' => 'inline; filename="business-'.$b->id.'.svg"',
            'Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
