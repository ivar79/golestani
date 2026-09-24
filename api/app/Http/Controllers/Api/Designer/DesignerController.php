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

        if ($designer->wasRecentlyCreated && $request->user()->hasRole('user') && ! $request->user()->hasRole('designer')) {
            $request->user()->assignRole('designer');
        }

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

        if ($designer->wasRecentlyCreated && $request->user()->hasRole('user') && ! $request->user()->hasRole('designer')) {
            $request->user()->assignRole('designer');
        }

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
        $query = Designer::with(['user:id,phone,email', 'portfolios'])->withCount('businesses')->latest();
        if (! empty($data['status'])) $query->where('status', $data['status']);
        return response()->json($query->paginate(25));
    }

    public function adminModerate(Request $request, Designer $designer): JsonResponse
    {
        $data = $request->validate(['status' => ['required', 'in:approved,rejected,suspended,pending'], 'moderation_note' => ['nullable', 'string', 'max:1000']]);
        $designer->update($data);
        return response()->json($designer->fresh(['user:id,phone,email'])->loadCount('businesses'));
    }

    private function ownedDesigner(Request $request): Designer
    {
        return Designer::where('user_id', $request->user()->id)->firstOrFail();
    }
}
