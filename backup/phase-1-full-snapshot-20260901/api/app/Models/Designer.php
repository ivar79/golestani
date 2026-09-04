<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Designer extends Model
{
    use HasFactory;

    protected $fillable = ['user_id', 'display_name', 'slug', 'bio', 'phone', 'email', 'social_links', 'status', 'moderation_note'];

    protected function casts(): array
    {
        return ['social_links' => 'array'];
    }

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function portfolios(): HasMany { return $this->hasMany(Portfolio::class); }
}
