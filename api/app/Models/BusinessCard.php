<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BusinessCard extends Model
{
    use HasFactory;

    protected $fillable = [
        'business_id', 'template', 'theme', 'font_size', 'font_family',
        'export_format', 'exported_at', 'creation_type', 'front_image', 'back_image',
        'print_file_path', 'print_file_name', 'print_file_mime',
    ];

    protected function casts(): array
    {
        return ['exported_at' => 'datetime', 'design_json' => 'array'];
    }

    /**
     * Phase 4 security: print files live on the PRIVATE card_files disk and
     * are served exclusively through the authorized download endpoint
     * (BusinessCardController@download). No public URL accessor is exposed;
     * the model only tells the owner UI whether a file exists plus its
     * original name/mime for the download button.
     */
    public function getPrintFileUrlAttribute(): ?string
    {
        return null; // Deprecated: kept so legacy clients get null, never a public URL.
    }

    /** Serialized for the owner/admin UI (authorized contexts only). */
    public function printFileMeta(): array
    {
        return [
            'print_file_name' => $this->print_file_name,
            'print_file_mime' => $this->print_file_mime,
            'has_print_file' => ! empty($this->print_file_path),
        ];
    }

    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }
}
