<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Services\BusinessAudit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
class AdminBusinessController extends Controller
{
    public function index(Request $r): JsonResponse
    {
        $data = $r->validate([
            'status'=>['nullable', Rule::in(['draft','pending','approved','rejected','suspended'])],
            'q'=>['nullable','string','max:120'], 'page'=>['nullable','integer','min:1'],
        ]);
        $q = Business::query()->with(['owner:id,phone', 'images', 'cards', 'designer:id,display_name,referral_code']);
        if (!empty($data['status'])) $q->where('status', $data['status']);
        if (!empty($data['q'])) $q->where('name', DB::connection()->getDriverName()==='pgsql' ? 'ilike' : 'like', '%'.addcslashes($data['q'], '%_\\').'%');
        return response()->json($q->orderByDesc('updated_at')->orderByDesc('id')->paginate(20));
    }
    /**
     * Phase 3 "featured ladder" (Golestani request): the ONLY admin path that
     * may flip is_promoted. Exactly one field is accepted — anything else in
     * the payload is ignored, so this endpoint can never mutate moderation
     * state, ownership, content or media (no mass assignment). The search
     * layer (BusinessController@search) already orders is_promoted DESC →
     * distance ASC; this toggle is what feeds that ordering.
     */
    public function promote(Request $r, Business $business): JsonResponse
    {
        $data = $r->validate(['is_promoted' => ['required', 'boolean']]);
        $b = DB::transaction(function () use ($r, $business, $data) {
            $b = Business::lockForUpdate()->findOrFail($business->id);
            $before = (bool) $b->is_promoted;
            $b->is_promoted = $data['is_promoted'];
            $b->save();
            if ($before !== $b->is_promoted) {
                BusinessAudit::record($r, 'business.promoted', $b->id, ['from' => $before, 'to' => $b->is_promoted]);
            }
            return $b->fresh();
        });
        // Facets are unaffected by the flag, but keep invalidation symmetric
        // with every other admin mutation in this controller's family.
        \Illuminate\Support\Facades\Cache::forget('search_facets_v1');
        return response()->json(['id' => $b->id, 'slug' => $b->slug, 'name' => $b->name, 'is_promoted' => (bool) $b->is_promoted]);
    }
    public function audit(Request $r, Business $business): JsonResponse
    {
        $r->validate(['page'=>['nullable','integer','min:1']]);
        return response()->json(DB::table('audit_events')->where('subject_type','business')->where('subject_id',$business->id)->orderByDesc('id')->paginate(30));
    }
}
