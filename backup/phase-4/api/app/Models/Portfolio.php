<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Portfolio extends Model
{
    use HasFactory;

    protected $fillable = ['designer_id', 'title', 'description', 'file_path', 'mime_type', 'file_size', 'status', 'moderation_note'];

    public function designer(): BelongsTo { return $this->belongsTo(Designer::class); }
}
