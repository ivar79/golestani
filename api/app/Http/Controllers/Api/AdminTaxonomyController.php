<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AdminTaxonomy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class AdminTaxonomyController extends Controller
{
    private const TYPES = ['city', 'neighborhood', 'category', 'service', 'badge'];

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['nullable', Rule::in(self::TYPES)],
            'active' => ['nullable', 'boolean'],
            'parent_id' => ['nullable', 'integer', 'exists:admin_taxonomies,id'],
        ]);

        $query = AdminTaxonomy::with('parent:id,name,type')
            ->orderBy('type')->orderBy('sort_order')->orderBy('name');
        if (isset($data['type'])) $query->where('type', $data['type']);
        if (isset($data['active'])) $query->where('is_active', $data['active']);
        if (isset($data['parent_id'])) $query->where('parent_id', $data['parent_id']);

        return response()->json($query->paginate(100));
    }

    public function public(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(self::TYPES)],
            'parent_id' => ['nullable', 'integer', 'exists:admin_taxonomies,id'],
        ]);

        $query = AdminTaxonomy::where('type', $data['type'])
            ->where('is_active', true)
            ->orderBy('sort_order')->orderBy('name');
        if (isset($data['parent_id'])) $query->where('parent_id', $data['parent_id']);

        return response()->json($query->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request);
        $data['slug'] = $data['slug'] ?? Str::slug($data['name']);
        $taxonomy = AdminTaxonomy::create($data);
        return response()->json($taxonomy->load('parent:id,name,type'), 201);
    }

    public function update(Request $request, AdminTaxonomy $taxonomy): JsonResponse
    {
        $data = $this->validated($request, $taxonomy);
        if (isset($data['name']) && ! isset($data['slug'])) $data['slug'] = Str::slug($data['name']);
        $taxonomy->update($data);
        return response()->json($taxonomy->fresh('parent:id,name,type'));
    }

    public function destroy(AdminTaxonomy $taxonomy): JsonResponse
    {
        abort_if($taxonomy->children()->exists(), 422, 'این مورد دارای زیرمجموعه است و قابل حذف نیست.');
        $taxonomy->delete();
        return response()->json(['message' => 'مورد حذف شد.']);
    }

    private function validated(Request $request, ?AdminTaxonomy $taxonomy = null): array
    {
        $typeRule = $taxonomy ? ['sometimes', Rule::in(self::TYPES)] : ['required', Rule::in(self::TYPES)];
        $nameRule = $taxonomy ? ['sometimes', 'string', 'max:160'] : ['required', 'string', 'max:160'];
        $slugRule = ['nullable', 'string', 'max:180', 'regex:/^[a-z0-9-]+$/'];
        if ($taxonomy) $slugRule[] = Rule::unique('admin_taxonomies', 'slug')->where(fn ($query) => $query->where('type', $taxonomy->type))->ignore($taxonomy->id);

        return $request->validate([
            'type' => $typeRule,
            'parent_id' => ['nullable', 'integer', 'exists:admin_taxonomies,id', Rule::notIn([$taxonomy?->id])],
            'name' => $nameRule,
            'slug' => $slugRule,
            'is_active' => ['sometimes', 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
            'metadata' => ['nullable', 'array'],
        ]);
    }
}
