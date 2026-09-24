<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Support\BusinessUrl;
use Endroid\QrCode\Builder\Builder;
use Endroid\QrCode\Writer\SvgWriter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
class PublicBusinessController extends Controller
{
    public function show(Request $request, string $slug): JsonResponse
    {
        $b = Business::where('slug', $slug)->where('status', 'approved')->firstOrFail();
        $data = $b->only(['name','slug','category','services','description','phone','email','address','city','neighborhood','latitude','longitude','social_links','badges','logo','cover_image','created_at','updated_at']);
        $data['images'] = $b->images()->get(['id','path','alt']);
        $data['public_url'] = BusinessUrl::public($b, $request);
        return response()->json($data)->header('Cache-Control', 'no-store');
    }
    public function qr(Request $request, string $slug): Response
    {
        $b = Business::where('slug', $slug)->firstOrFail();
        if ($b->status !== 'approved') {
            $user = $request->user('sanctum');
            if (!$user || (int)$b->user_id !== (int)$user->id) {
                abort(404);
            }
        }
        $qr = (new Builder(data: BusinessUrl::public($b, $request), writer: new SvgWriter(), size: 400, margin: 10))->build();
        return response($qr->getString(), 200, [
            'Content-Type' => 'image/svg+xml',
            'Content-Disposition' => 'inline; filename="business-'.$b->id.'.svg"',
            'Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
