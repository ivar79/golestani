<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AdminTaxonomy extends Model
{
    use HasFactory;

    protected $table = 'admin_taxonomies';

    protected $fillable = ['type', 'parent_id', 'name', 'slug', 'is_active', 'sort_order', 'metadata'];

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'metadata' => 'array'];
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }
}
