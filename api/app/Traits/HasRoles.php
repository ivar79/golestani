<?php

namespace App\Traits;

use App\Models\Permission;
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

    /**
     * P1: permissions attached to the user's roles (via permission_role).
     * The admin role bypasses permission checks entirely.
     */
    public function permissions(): BelongsToMany
    {
        return $this->belongsToMany(Permission::class, 'permission_role', 'role_id', 'permission_id')
            ->distinct();
    }

    public function permissionList(): array
    {
        if ($this->hasRole('admin')) {
            return ['*'];
        }

        return $this->roles()
            ->with('permissions:name')
            ->get()
            ->pluck('permissions')
            ->flatten()
            ->pluck('name')
            ->unique()
            ->values()
            ->all();
    }

    public function hasPermission(string $permission): bool
    {
        if ($this->hasRole('admin')) {
            return true;
        }

        return $this->roles()
            ->whereHas('permissions', fn ($q) => $q->where('permissions.name', $permission))
            ->exists();
    }
}
