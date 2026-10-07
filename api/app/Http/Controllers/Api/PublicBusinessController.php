<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Services\CardDesignValidator;
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
        $b = Business::where('slug', $slug)->firstOrFail();
        if ($b->status !== 'approved') {
            // Still 404 (nothing about the business is disclosed), but with a
            // machine-readable reason so the page can say "awaiting review"
            // instead of "business not found". An owner edit sends an approved
            // business back to review (BusinessPublication::invalidate), which
            // used to look exactly like the business had been deleted.
            abort(response()->json([
                'message' => 'این صفحه در حال حاضر منتشر نشده است.',
                'reason'  => 'not_published',
            ], 404)->header('Cache-Control', 'no-store'));
        }
        $data = $b->only(['name','slug','category','services','description','phone','email','address','city','neighborhood','latitude','longitude','social_links','badges','logo','cover_image','created_at','updated_at']);
        $data['images'] = $b->images()->get(['id','path','alt']);
        $data['public_url'] = BusinessUrl::public($b, $request);
        return response()->json($data)->header('Cache-Control', 'no-store');
    }
    /**
     * The published CARD for a business (Phase 4 layered editor).
     *
     * Deliberately a separate read path from show(): `show` answers "who is this
     * business" and is an editorial profile payload; this answers "what does
     * their card look like" and returns ONLY render-relevant fields. Nothing
     * about the owner, payments, subscriptions, entitlements or receipts can
     * travel through here — that keeps the public surface a narrow contract.
     *
     * Isolation: resolution goes slug → approved business → its own card. There
     * is no id-based lookup, so no IDOR surface and no way to read another
     * business's document.
     *
     * Robustness: the stored document is re-validated through the NON-aborting
     * read path, so a row that can no longer be rendered degrades to the legacy
     * template (design_json = null) instead of leaking a malformed payload or
     * throwing on a public page.
     */
    public function card(string $slug): JsonResponse
    {
        $b = Business::where('slug', $slug)->where('status', 'approved')->firstOrFail();
        $card = $b->cards()->latest()->first();

        // Same defaults as the owner contract (BusinessCardController@show) so a
        // business that never opened the editor renders exactly like the
        // template picker previewed it.
        return response()->json([
            'template' => $card?->template ?? 'classic',
            'theme' => $card?->theme ?? 'navy',
            'font_size' => $card?->font_size ?? 'medium',
            'font_family' => $card?->font_family ?? 'sans',
            'design_json' => app(CardDesignValidator::class)->validateForDisplay($card?->design_json),
        ])->header('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400');
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
