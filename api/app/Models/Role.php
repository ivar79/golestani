<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsToMany;

use Illuminate\Database\Eloquent\Model;


class Role extends Model
{
    protected $fillable = ['name', 'display_name'];

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class);
    }

    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'permission_role', 'role_id', 'permission_id');
    }
}
