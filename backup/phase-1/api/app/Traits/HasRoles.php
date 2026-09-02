<?php

namespace App\Traits;

use App\Models\Role;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

trait HasRoles
{
    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class);
    }

    public function hasRole(string $name): bool
    {
        return $this->roles->contains('name', $name);
    }

    public function hasAnyRole(array $names): bool
    {
        return $this->roles->whereIn('name', $names)->isNotEmpty();
    }

    public function assignRole(string $name): static
    {
        $role = Role::where('name', $name)->firstOrFail();

        if (! $this->hasRole($name)) {
            $this->roles()->attach($role->getKey());
            $this->unsetRelation('roles');
        }

        return $this;
    }
}
