<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

class Portfolio extends Model
{
    use HasFactory;

    protected $fillable = ['designer_id', 'title', 'description', 'file_path', 'mime_type', 'file_size', 'status', 'moderation_note'];

    protected static function booted(): void
    {
        // PHASE 4 hardening: deleting the record also deletes the stored file
        // from the public disk — no orphaned portfolio artifacts accumulate.
        static::deleting(function (Portfolio $portfolio): void {
            if ($portfolio->file_path) {
                Storage::disk('public')->delete($portfolio->file_path);
            }
        });
    }

    public function designer(): BelongsTo
    {
        return $this->belongsTo(Designer::class);
    }
}
