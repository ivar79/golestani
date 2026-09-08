<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\Business;
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
        $q = Business::query()->with(['owner:id,phone','images']);
        if (!empty($data['status'])) $q->where('status', $data['status']);
        if (!empty($data['q'])) $q->where('name', DB::connection()->getDriverName()==='pgsql' ? 'ilike' : 'like', '%'.addcslashes($data['q'], '%_\\').'%');
        return response()->json($q->orderByDesc('updated_at')->orderByDesc('id')->paginate(20));
    }
    public function audit(Request $r, Business $business): JsonResponse
    {
        $r->validate(['page'=>['nullable','integer','min:1']]);
        return response()->json(DB::table('audit_events')->where('subject_type','business')->where('subject_id',$business->id)->orderByDesc('id')->paginate(30));
    }
}
