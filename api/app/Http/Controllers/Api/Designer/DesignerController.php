<?php

namespace App\Http\Controllers\Api\Designer;

use App\Http\Controllers\Controller;
use App\Http\Requests\Designer\DesignerRequest;
use App\Http\Requests\Designer\PortfolioRequest;
use App\Models\Designer;
use App\Models\Portfolio;
use App\Models\Role;
use App\Models\User;
use App\Services\AuditTrail;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class DesignerController extends Controller
{
    public function profile(Request $request): JsonResponse
    {
        $designer = Designer::with('portfolios')->firstOrCreate(
            ['user_id' => $request->user()->id],
            [
                'display_name' => 'طراح اینکارت',
                'slug' => 'designer-' . Str::lower(Str::random(8)),
                'referral_code' => 'DES-' . strtoupper(Str::random(6)),
                'status' => 'pending',
            ]
        );

        if (empty($designer->referral_code)) {
            $designer->referral_code = 'DES-' . strtoupper(Str::random(6));
            $designer->save();
        }

        // SECURITY (V1): the designer role is NEVER self-assigned. It is
        // granted exclusively by the admin approval workflow
        // (PATCH /admin/users/{user}/designer-status) — the old bootstrap let
        // any OTP user obtain the role with one GET request.

        $designerData = $designer->load('portfolios')->toArray();
        $designerData['attributed_businesses_count'] = $designer->businesses()->count();
        $designerData['referral_link'] = url('/dashboard?ref=' . $designer->referral_code);

        return response()->json($designerData);
    }

    public function update(DesignerRequest $request): JsonResponse
    {
        $designer = Designer::firstOrCreate(
            ['user_id' => $request->user()->id],
            [
                'display_name' => $request->validated('display_name'),
                'slug' => 'designer-' . Str::lower(Str::random(8)),
                'referral_code' => 'DES-' . strtoupper(Str::random(6)),
                'status' => 'pending',
            ]
        );

        if (empty($designer->referral_code)) {
            $designer->referral_code = 'DES-' . strtoupper(Str::random(6));
        }

        // SECURITY (V1): never self-assign the designer role here either.
        $designer->update($request->validated() + ['status' => 'pending', 'moderation_note' => null]);

        $designerData = $designer->fresh()->load('portfolios')->toArray();
        $designerData['attributed_businesses_count'] = $designer->businesses()->count();
        $designerData['referral_link'] = url('/dashboard?ref=' . $designer->referral_code);

        return response()->json($designerData);
    }

    public function portfolios(Request $request): JsonResponse
    {
        return response()->json($this->ownedDesigner($request)->portfolios()->latest()->get());
    }

    public function storePortfolio(PortfolioRequest $request): JsonResponse
    {
        $designer = $this->ownedDesigner($request);
        $file = $request->file('file');
        $portfolio = $designer->portfolios()->create([
            'title' => $request->validated('title'),
            'description' => $request->validated('description'),
            'file_path' => $file->store('portfolios', 'public'),
            'mime_type' => $file->getMimeType(),
            'file_size' => $file->getSize(),
            'status' => 'pending',
        ]);

        return response()->json($portfolio, 201);
    }

    public function destroyPortfolio(Request $request, Portfolio $portfolio): JsonResponse
    {
        abort_unless($portfolio->designer?->user_id === $request->user()->id || $request->user()->hasRole('admin'), 403);
        $portfolio->delete();

        return response()->json(['message' => 'نمونه‌کار حذف شد.']);
    }

    public function moderate(Request $request, Portfolio $portfolio): JsonResponse
    {
        abort_unless($request->user()->hasRole('admin'), 403);
        $data = $request->validate([
            'status' => ['required', 'in:approved,rejected,suspended'],
            'moderation_note' => ['nullable', 'string', 'max:1000'],
        ]);
        $portfolio->update($data);

        return response()->json($portfolio->fresh());
    }

    public function adminIndex(Request $request): JsonResponse
    {
        $data = $request->validate(['status' => ['nullable', 'in:pending,approved,rejected,suspended'], 'page' => ['nullable', 'integer', 'min:1']]);
        // user.designer_status travels with the row so the admin UI can show
        // the CANONICAL status next to the legacy one (divergence badge).
        $query = Designer::with(['user:id,phone,email,designer_status', 'portfolios'])->withCount('businesses')->latest();
        if (! empty($data['status'])) $query->where('status', $data['status']);
        return response()->json($query->paginate(25));
    }

    /**
     * LEGACY moderation endpoint — still supported, but it now writes the
     * CANONICAL status too (users.designer_status + role + audit), so the two
     * designer concepts can never diverge silently again.
     */
    public function adminModerate(Request $request, Designer $designer): JsonResponse
    {
        $data = $request->validate(['status' => ['required', 'in:approved,rejected,suspended,pending'], 'moderation_note' => ['nullable', 'string', 'max:1000']]);

        DB::transaction(function () use ($request, $designer, $data): void {
            $designer->update($data);

            $user = User::query()->whereKey($designer->user_id)->lockForUpdate()->first();
            if ($user === null) {
                return;
            }

            $previous = (string) ($user->designer_status ?? 'none');
            $user->forceFill(['designer_status' => $data['status']])->save();

            $roleAction = 'preserved';
            if ($data['status'] === 'approved') {
                $user->assignRole('designer');
                $roleAction = 'assigned';
            } elseif ($user->hasRole('designer')) {
                $designerRoleId = Role::query()->where('name', 'designer')->value('id');
                if ($designerRoleId !== null) {
                    $user->roles()->detach($designerRoleId);
                    $user->unsetRelation('roles');
                    $roleAction = 'removed';
                }
            }

            AuditTrail::record($request->user()?->id, 'admin.designer_status_changed', 'user', $user->id, [
                'from' => $previous,
                'to' => $data['status'],
                'reason' => $data['moderation_note'] ?? null,
                'role' => $roleAction,
                'source' => 'designers.moderate',
            ]);
        });

        return response()->json($designer->fresh(['user:id,phone,email,designer_status'])->loadCount('businesses'));
    }

    private function ownedDesigner(Request $request): Designer
    {
        return Designer::where('user_id', $request->user()->id)->firstOrFail();
    }
}
