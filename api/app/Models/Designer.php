<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Designer extends Model
{
    use HasFactory;

    protected $fillable = ['user_id', 'display_name', 'slug', 'referral_code', 'bio', 'phone', 'email', 'social_links', 'status', 'moderation_note'];

    protected function casts(): array
    {
        return ['social_links' => 'array'];
    }

    protected static function booted(): void
    {
        static::creating(function (Designer $designer): void {
            if (empty($designer->referral_code)) {
                $designer->referral_code = 'DES-' . strtoupper(\Illuminate\Support\Str::random(6));
            }
        });
    }

    public function user(): BelongsTo { return $this->belongsTo(User::class); }
    public function portfolios(): HasMany { return $this->hasMany(Portfolio::class); }
    public function businesses(): HasMany { return $this->hasMany(Business::class); }
}
