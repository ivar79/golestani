<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BusinessCard extends Model
{
    use HasFactory;

    protected $fillable = ['business_id', 'template', 'theme', 'font_size', 'export_format', 'exported_at'];
    protected function casts(): array { return ['exported_at' => 'datetime']; }
    public function business(): BelongsTo { return $this->belongsTo(Business::class); }
}
