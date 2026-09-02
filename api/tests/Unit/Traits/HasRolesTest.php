<?php

namespace Tests\Unit\Traits;

use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class HasRolesTest extends TestCase
{
    use RefreshDatabase;

    // ─── roles() relationship ───────────────────────────────────────

    public function test_user_has_no_roles_by_default(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);

        $this->assertCount(0, $user->roles);
    }

    public function test_roles_relationship_returns_belongs_to_many(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('user');

        $this->assertCount(1, $user->roles);
        $this->assertSame('user', $user->roles->first()->name);
    }

    // ─── hasRole() ─────────────────────────────────────────────────

    public function test_has_role_returns_true_for_assigned_role(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('admin');

        $this->assertTrue($user->hasRole('admin'));
    }

    public function test_has_role_returns_false_for_unassigned_role(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('user');

        $this->assertFalse($user->hasRole('admin'));
    }

    public function test_has_role_returns_false_when_no_roles(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);

        $this->assertFalse($user->hasRole('user'));
    }

    public function test_has_role_is_case_sensitive(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('admin');

        $this->assertTrue($user->hasRole('admin'));
        $this->assertFalse($user->hasRole('Admin'));
        $this->assertFalse($user->hasRole('ADMIN'));
    }

    // ─── hasAnyRole() ──────────────────────────────────────────────

    public function test_has_any_role_returns_true_when_user_has_one_of_the_roles(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('designer');

        $this->assertTrue($user->hasAnyRole(['admin', 'designer']));
    }

    public function test_has_any_role_returns_false_when_user_has_none(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('user');

        $this->assertFalse($user->hasAnyRole(['admin', 'designer']));
    }

    public function test_has_any_role_with_empty_array(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('user');

        $this->assertFalse($user->hasAnyRole([]));
    }

    public function test_has_any_role_with_single_role(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('admin');

        $this->assertTrue($user->hasAnyRole(['admin']));
        $this->assertFalse($user->hasAnyRole(['user']));
    }

    // ─── assignRole() ──────────────────────────────────────────────

    public function test_assign_role_attaches_role_to_user(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('admin');

        $this->assertTrue($user->hasRole('admin'));
        $this->assertCount(1, $user->roles);
    }

    public function test_assign_role_returns_user_instance(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $result = $user->assignRole('admin');

        $this->assertSame($user->id, $result->id);
    }

    public function test_assign_role_is_idempotent(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('admin');
        $user->assignRole('admin');

        $this->assertCount(1, $user->roles);
    }

    public function test_assign_role_throws_on_nonexistent_role(): void
    {
        $this->expectException(\Illuminate\Database\Eloquent\ModelNotFoundException::class);

        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('nonexistent_role');
    }

    public function test_assign_multiple_roles(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('admin');
        $user->assignRole('designer');

        $this->assertTrue($user->hasRole('admin'));
        $this->assertTrue($user->hasRole('designer'));
        $this->assertCount(2, $user->roles);
    }

    public function test_assign_role_clears_cached_roles(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('user');

        // Force load
        $this->assertCount(1, $user->roles);

        $user->assignRole('admin');

        // Should now see both roles (cache was cleared)
        $this->assertCount(2, $user->fresh()->roles);
    }

    // ─── All four roles ────────────────────────────────────────────

    public function test_all_default_roles_can_be_assigned(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);

        $roles = ['admin', 'business_owner', 'designer', 'user'];
        foreach ($roles as $role) {
            $user->assignRole($role);
        }

        $this->assertCount(4, $user->roles);
        foreach ($roles as $role) {
            $this->assertTrue($user->hasRole($role));
        }
    }

    // ─── Database level ────────────────────────────────────────────

    public function test_assign_role_creates_pivot_record(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('admin');

        $this->assertDatabaseHas('role_user', [
            'user_id' => $user->id,
            'role_id' => Role::where('name', 'admin')->first()->id,
        ]);
    }

    public function test_user_deletion_cascades_role_pivot(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('admin');

        $userId = $user->id;
        $user->delete();

        $this->assertDatabaseMissing('role_user', ['user_id' => $userId]);
    }
}
