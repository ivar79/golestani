<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Business\BusinessRequest;
use App\Http\Requests\Business\SearchBusinessRequest;
use App\Models\Business;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use App\Services\SearchRankingService;

class BusinessController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json($request->user()->businesses()->latest()->get());
    }

    public function store(BusinessRequest $request): JsonResponse
    {
        // P1: a plain user's first business upgrades them to business_owner.
        // The role is assigned server-side (never from user input), and it
        // only opens the owner's own-resource endpoints — no escalation.
        if ($request->user()->hasRole('user') && ! $request->user()->hasRole('business_owner')) {
            $request->user()->assignRole('business_owner');
        }

        $business = $request->user()->businesses()->create($this->payload($request));
        $this->syncGeometry($business);

        return response()->json($business->fresh(), 201);
    }

    public function show(Request $request, Business $business): JsonResponse
    {
        // P0 security hotfix: previously any business_owner could read any
        // business by ID (including the owner's phone) — IDOR.
        $this->authorizeOwner($request, $business);

        return response()->json($business->load('owner:id,phone'));
    }

    public function update(BusinessRequest $request, Business $business): JsonResponse
    {
        $this->authorizeOwner($request, $business);
        $data = $this->payload($request);
        unset($data['slug']);
        $business->update($data + ['status' => 'pending', 'moderation_note' => null]);
        $this->syncGeometry($business);

        return response()->json($business->fresh());
    }

    public function destroy(Request $request, Business $business): JsonResponse
    {
        $this->authorizeOwner($request, $business);
        $business->delete();

        return response()->json(['message' => 'پروفایل کسب‌وکار حذف شد.']);
    }

    public function search(SearchBusinessRequest $request, SearchRankingService $ranking): JsonResponse
    {
        $data = $request->validated();
        $query = Business::query()->where('status', 'approved');
        if (!empty($data['q'])) {
            $term = addcslashes($data['q'], '%_');
            $query->where(function ($builder) use ($term): void {
                $builder->where('name', 'ilike', "%{$term}%")
                    ->orWhere('category', 'ilike', "%{$term}%")
                    ->orWhere('description', 'ilike', "%{$term}%")
                    ->orWhere('services', 'ilike', "%{$term}%")
                    ->orWhere('social_links', 'ilike', "%{$term}%");
            });
        }
        foreach (['city', 'neighborhood', 'category'] as $field) {
            if (!empty($data[$field])) $query->where($field, $data[$field]);
        }
        if (!empty($data['verified'])) $query->whereJsonContains('badges', 'verified');
        // M1: previously-declared but unimplemented filters. `rating` and
        // `open` have no backing data model yet (no reviews / opening hours
        // exist), so they are intentionally ignored rather than failing —
        // the UI must not advertise them until a data source exists.
        if (!empty($data['showcase'])) {
            $query->whereHas('showcases', fn ($q) => $q->where('is_published', true));
        }
        $hasPoint = isset($data['latitude'], $data['longitude']);
        $pgsql = DB::connection()->getDriverName() === 'pgsql';
        if ($hasPoint && isset($data['radius']) && $pgsql) $query->whereRaw('ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)', [$data['longitude'], $data['latitude'], $data['radius']]);
        if ($hasPoint && $pgsql) {
            $query->select('businesses.*')->selectRaw('ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography) AS distance_meters', [$data['longitude'], $data['latitude']])->orderBy('distance_meters');
        } else $query->latest();
        $perPage=(int)($data['limit'] ?? 20); $page=(int)($data['page'] ?? 1);
        $paginator=$query->paginate($perPage,['*'],'page',$page);
        $items=$paginator->getCollection()->map(fn(Business $b): array => [
            'id'=>$b->id,'slug'=>$b->slug,'name'=>$b->name,'category'=>$b->category,'city'=>$b->city,'neighborhood'=>$b->neighborhood,'address'=>$b->address,
            'coordinates'=>['latitude'=>$b->latitude,'longitude'=>$b->longitude],'distance'=>$b->distance_meters ?? null,'verification_badge'=>in_array('verified',(array)$b->badges,true),
            'badges'=>$b->badges,'rating'=>null,'phone'=>$b->phone,'services'=>$b->services,'description'=>$b->description,
            'navigation_url'=>$this->navigationUrl($b),
        ]);
        return response()->json(['data'=>$items,'pagination'=>['page'=>$paginator->currentPage(),'limit'=>$paginator->perPage(),'total'=>$paginator->total(),'last_page'=>$paginator->lastPage(),'next_page'=>$paginator->nextPageUrl()]]);
    }

    /**
     * M1: GET /search/facets — distinct filter values for the search UI.
     * Public, cheap, cacheable (5 min) — queried on every search page load.
     */
    public function facets(): JsonResponse
    {
        $facets = Cache::remember('search_facets_v1', now()->addMinutes(5), function (): array {
            $base = Business::query()->where('status', 'approved');

            return [
                'cities' => (clone $base)->whereNotNull('city')->where('city', '!=', '')->distinct()->orderBy('city')->pluck('city'),
                'categories' => (clone $base)->whereNotNull('category')->where('category', '!=', '')->distinct()->orderBy('category')->pluck('category'),
                'neighborhoods' => (clone $base)->whereNotNull('neighborhood')->where('neighborhood', '!=', '')->distinct()->orderBy('neighborhood')->pluck('neighborhood'),
            ];
        });

        return response()->json($facets);
    }

    private function navigationUrl(Business $business): ?string
    {
        if ($business->latitude === null || $business->longitude === null) return null;
        return 'https://www.google.com/maps/dir/?api=1&destination='.$business->latitude.','.$business->longitude;
    }

    public function moderate(Request $request, Business $business): JsonResponse
    {
        abort_unless($request->user()?->hasRole('admin'), 403);
        $data = $request->validate([
            'status' => ['required', 'in:approved,rejected,suspended'],
            'moderation_note' => ['nullable', 'string', 'max:1000'],
        ]);
        $business->update($data);

        return response()->json($business->fresh());
    }

    private function payload(BusinessRequest $request): array
    {
        $data = $request->validated();
        $data['slug'] = Str::slug($data['name']).'-'.Str::lower(Str::random(8));

        return $data + ['status' => 'pending'];
    }

    private function syncGeometry(Business $business): void
    {
        if (DB::connection()->getDriverName() === 'pgsql' && $business->latitude !== null && $business->longitude !== null) {
            DB::statement(
                'UPDATE businesses SET geom = ST_SetSRID(ST_MakePoint(?, ?), 4326) WHERE id = ?',
                [$business->longitude, $business->latitude, $business->id]
            );

            return;
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('UPDATE businesses SET geom = NULL WHERE id = ?', [$business->id]);
        }
    }

    private function authorizeOwner(Request $request, Business $business): void
    {
        abort_unless($request->user()?->hasRole('admin') || $business->user_id === $request->user()?->id, 403);
    }
}
