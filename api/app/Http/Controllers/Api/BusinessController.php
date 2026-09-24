<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Http\Requests\Business\BusinessRequest;
use App\Http\Requests\Business\SearchBusinessRequest;
use App\Models\Business;
use App\Services\BusinessAudit;
use App\Services\BusinessMedia;
use App\Services\BusinessPublication;

use App\Support\BusinessUrl;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
class BusinessController extends Controller
{
    private function ownerData(Business $b): array
    {
        return $b->loadMissing(['cards', 'designer:id,display_name,referral_code'])->toArray() + ['public_url' => BusinessUrl::public($b)];
    }
    public function index(Request $r): JsonResponse
    {
        return response()->json($r->user()->businesses()->with(['cards', 'designer:id,display_name,referral_code'])->latest()->get()->map(fn(Business $b) => $this->ownerData($b)));
    }
    public function store(BusinessRequest $r): JsonResponse
    {
        $b = DB::transaction(function () use ($r) {
            // Serialize first-business role assignment for a given user.
            $user = $r->user()->newQuery()->lockForUpdate()->findOrFail($r->user()->id);
            if ($user->hasRole('user') && !$user->hasRole('business_owner')) $user->assignRole('business_owner');
            $data = $r->validated();
            $this->resolveDesignerAttribution($data);
            $data['slug'] = (Str::slug($data['name']) ?: 'business').'-'.Str::lower((string) Str::ulid());
            $data['status'] = 'pending';
            $b = $user->businesses()->create($data);
            $this->syncGeometry($b);
            BusinessAudit::record($r, 'business.created', $b->id, ['fields' => array_keys($r->validated()), 'status' => 'pending']);
            return $b->fresh();
        });
        return response()->json($this->ownerData($b), 201);
    }
    public function show(Request $r, Business $business): JsonResponse
    {
        $this->authorizeOwner($r, $business);
        return response()->json($this->ownerData($business->load(['images', 'cards', 'designer:id,display_name,referral_code'])));
    }
    public function update(BusinessRequest $r, Business $business): JsonResponse
    {
        $b = DB::transaction(function () use ($r, $business) {
            $b = Business::lockForUpdate()->findOrFail($business->id);
            $this->authorizeOwner($r, $b);
            $before = $b->status;
            $data = $r->validated();
            $this->resolveDesignerAttribution($data);
            $b->fill($data);
            $fields = array_keys($b->getDirty());
            if ($fields !== []) {
                BusinessPublication::invalidate($b);
                $this->syncGeometry($b);
                BusinessAudit::record($r, 'business.updated', $b->id, ['fields' => $fields, 'from_status' => $before, 'to_status' => $b->status]);
            }
            return $b->fresh();
        });
        Cache::forget('search_facets_v1');
        return response()->json($this->ownerData($b));
    }
    public function upload(Request $r, Business $business): JsonResponse
    {
        $this->authorizeOwner($r, $business);
        $r->validate([
            'logo' => array_merge(['nullable'], BusinessMedia::rules(2048)),
            'cover_image' => array_merge(['nullable'], BusinessMedia::rules()),
            'remove_logo' => ['sometimes','boolean'], 'remove_cover_image' => ['sometimes','boolean'],
        ]);
        foreach (['logo','cover_image'] as $field) {
            if ($r->hasFile($field) && $r->boolean('remove_'.$field)) abort(422, 'آپلود و حذف همزمان یک تصویر مجاز نیست.');
        }
        $paths = []; $old = [];
        try {
            foreach (['logo','cover_image'] as $field) {
                if ($r->hasFile($field)) $paths[$field] = BusinessMedia::store($r->file($field), $field === 'logo' ? 'logos' : 'covers');
                elseif ($r->boolean('remove_'.$field)) $paths[$field] = null;
            }
            abort_if($paths === [], 422, 'تصویری برای تغییر انتخاب نشده است.');
            $b = DB::transaction(function () use ($r, $business, $paths, &$old) {
                $b = Business::lockForUpdate()->findOrFail($business->id);
                $this->authorizeOwner($r, $b);
                $before = $b->status;
                foreach ($paths as $field => $path) { $old[] = $b->{$field}; $b->{$field} = $path; }
                BusinessPublication::invalidate($b);
                BusinessAudit::record($r, 'business.media_changed', $b->id, ['fields' => array_keys($paths), 'from_status' => $before, 'to_status' => $b->status]);
                return $b->fresh();
            });
        } catch (\Throwable $e) {
            foreach ($paths as $path) BusinessMedia::cleanup($path);
            throw $e;
        }
        foreach ($old as $path) BusinessMedia::cleanup($path);
        Cache::forget('search_facets_v1');
        return response()->json($this->ownerData($b));
    }
    public function destroy(Request $r, Business $business): JsonResponse
    {
        DB::transaction(function () use ($r, $business) {
            $b = Business::lockForUpdate()->findOrFail($business->id);
            $this->authorizeOwner($r, $b);
            BusinessAudit::record($r, 'business.deleted', $b->id, ['from_status' => $b->status]);
            $b->delete();
        });
        // Files intentionally retained on whole-business deletion to avoid
        // deleting media still referenced by other modules. See retention guide.
        Cache::forget('search_facets_v1');
        return response()->json(['message' => 'پروفایل کسب‌وکار حذف شد.']);
    }
    public function moderate(Request $r, Business $business): JsonResponse
    {
        abort_unless($r->user()?->hasRole('admin'), 403);
        $data = $r->validate([
            'status' => ['required', Rule::in(['approved','rejected','suspended'])],
            'moderation_note' => ['nullable','string','max:1000'],
            'badges' => ['sometimes','array','max:3'],
            'badges.*' => ['string','distinct', Rule::in(config('business.badges'))],
        ]);
        $b = DB::transaction(function () use ($r, $business, $data) {
            $b = Business::lockForUpdate()->findOrFail($business->id);
            $before = $b->status;
            $b->status = $data['status'];
            $b->moderation_note = $data['moderation_note'] ?? null;
            if (array_key_exists('badges', $data)) $b->badges = $data['badges'];
            if ($b->status !== 'approved') $b->badges = array_values(array_diff((array) $b->badges, ['verified']));
            $b->save();
            BusinessAudit::record($r, 'business.moderated', $b->id, [
                'from_status' => $before, 'to_status' => $b->status,
                'badges' => $b->badges, 'has_note' => !empty($b->moderation_note),
            ]);
            return $b->fresh();
        });
        Cache::forget('search_facets_v1');
        return response()->json($this->ownerData($b));
    }
    public function search(SearchBusinessRequest $r): JsonResponse
    {
        $data = $r->validated();
        $pgsql = DB::connection()->getDriverName() === 'pgsql';
        $like = $pgsql ? 'ilike' : 'like';
        $query = Business::query()->where('status', 'approved');
        if (!empty($data['q'])) {
            $term = '%'.addcslashes($data['q'], '%_\\').'%';
            $query->where(function ($q) use ($term, $like, $pgsql) {
                $q->where('name', $like, $term)->orWhere('category', $like, $term)->orWhere('description', $like, $term);
                // Identifiers are fixed; all user input remains bound parameters.
                foreach (['services','social_links'] as $column) {
                    if ($pgsql) $q->orWhereRaw('CAST('.$column.' AS TEXT) ILIKE ?', [$term]);
                    else $q->orWhere($column, 'like', $term);
                }
            });
        }
        foreach (['city','neighborhood','category'] as $field) if (!empty($data[$field])) $query->where($field, $data[$field]);
        if (!empty($data['verified'])) $query->whereJsonContains('badges', 'verified');
        if (!empty($data['showcase'])) $query->whereHas('showcases', fn($q) => $q->where('is_published', true));
        $hasPoint = isset($data['latitude'], $data['longitude']);
        if ($hasPoint && isset($data['radius']) && $pgsql) $query->whereRaw('ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)', [$data['longitude'], $data['latitude'], $data['radius']]);
        if ($hasPoint && $pgsql) {
            // Phase 3 approved ordering: promoted first, then nearest, then id.
            $query->select('businesses.*')->selectRaw('ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) AS distance_meters', [$data['longitude'], $data['latitude']])->orderByDesc('is_promoted')->orderBy('distance_meters')->orderBy('id');
        } else $query->orderByDesc('is_promoted')->latest()->orderByDesc('id');
        $p = $query->paginate((int) ($data['limit'] ?? 20));
        // Phase 3: cold-start rows (unclaimed) ride the same payload for the
        // map but never belong to the visible list — subtract them from the
        // paginated total so the front-end counter matches the card list,
        // and report their count separately for observability.
        $unclaimedTotal = (clone $query)->where('is_claimed', false)->toBase()->count();
        $items = $p->getCollection()->map(fn(Business $b) => [
            'id'=>$b->id,'slug'=>$b->slug,'name'=>$b->name,'category'=>$b->category,'city'=>$b->city,'neighborhood'=>$b->neighborhood,'address'=>$b->address,
            'coordinates'=>['latitude'=>$b->latitude,'longitude'=>$b->longitude],'distance'=>$b->distance_meters ?? null,
            'verification_badge'=>in_array('verified',(array)$b->badges,true),'badges'=>$b->badges,
            'is_promoted'=>(bool) $b->is_promoted,'is_claimed'=>(bool) $b->is_claimed,
            'license_verified'=>filled($b->license_tracking_code),
            // Phase 3: the raw code feeds the front-end license-track deep link
            // (qr.mojavez.ir). Null for businesses without a license code.
            'license_tracking_code'=>$b->license_tracking_code,
            // Phase 3: map popups show the logo when one was uploaded.
            'logo'=>$b->logo,
            'phone'=>$b->phone,'services'=>$b->services,'description'=>$b->description,
        ]);
        return response()->json(['data'=>$items,'pagination'=>['page'=>$p->currentPage(),'limit'=>$p->perPage(),'total'=>max(0, $p->total() - $unclaimedTotal),'last_page'=>$p->lastPage(),'next_page'=>$p->nextPageUrl(),'unclaimed_total'=>$unclaimedTotal]]);
    }
    public function facets(): JsonResponse
    {
        return response()->json(Cache::remember('search_facets_v1', 300, function () {
            $result = []; $base = Business::where('status', 'approved');
            foreach (['cities'=>'city','categories'=>'category','neighborhoods'=>'neighborhood'] as $key=>$column) {
                $result[$key] = (clone $base)->whereNotNull($column)->where($column,'!=','')->distinct()->orderBy($column)->pluck($column);
            }
            return $result;
        }));
    }
    /**
     * Phase 4: attribution is resolved SERVER-SIDE from the referral code —
     * designer_id is never accepted from the client. An explicitly empty
     * code clears the attribution (owner removed the designer); an absent
     * key on update keeps the current attribution untouched.
     */
    private function resolveDesignerAttribution(array &$data): void
    {
        $present = array_key_exists('designer_referral_code', $data) || array_key_exists('referral_code', $data);
        $refCode = trim((string) ($data['designer_referral_code'] ?? $data['referral_code'] ?? ''));

        if ($refCode !== '') {
            $designer = \App\Models\Designer::where('referral_code', $refCode)->first();
            $data['designer_id'] = $designer?->id;
        } elseif ($present) {
            $data['designer_id'] = null; // explicit clear
        }

        unset($data['designer_referral_code'], $data['referral_code']);
    }

    private function syncGeometry(Business $b): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') return;
        if ($b->latitude !== null && $b->longitude !== null) {
            DB::statement('UPDATE businesses SET geom = ST_SetSRID(ST_MakePoint(?, ?), 4326) WHERE id = ?', [$b->longitude,$b->latitude,$b->id]);
        } else DB::statement('UPDATE businesses SET geom = NULL WHERE id = ?', [$b->id]);
    }
    private function authorizeOwner(Request $r, Business $b): void
    {
        abort_unless($r->user()?->hasRole('admin') || (int) $b->user_id === (int) $r->user()?->id, 403);
    }
}
