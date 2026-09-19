<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Traits\HasRoles;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable, HasRoles;

    protected $fillable = [
        'name',
        'email',
        'password',
        'phone',
        'is_active',
        // Public handle chosen after OTP login; unique + format-checked in the
        // DB (see 2026_09_18_100000_add_username_to_users) and re-validated in
        // AuthController::setUsername. Written only via POST /auth/username.
        'username',
        // Profile photo (public storage path). Written only via
        // POST /auth/avatar and cleared via DELETE /auth/avatar.
        'avatar',
        // M1 (Phase 3): chosen map location, persisted until the user changes
        // it. Written only via PUT /auth/location with server-side validation.
        'latitude',
        'longitude',
        'location_label',
        // P0: recovery_code removed from mass-assignment; it is only ever set
        // server-side (hash) by the artisan recovery-code command.
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_active' => 'boolean',
        ];
    }
    public function designer(): \Illuminate\Database\Eloquent\Relations\HasOne { return $this->hasOne(Designer::class); }
    public function businesses(): \Illuminate\Database\Eloquent\Relations\HasMany { return $this->hasMany(Business::class); }
}
