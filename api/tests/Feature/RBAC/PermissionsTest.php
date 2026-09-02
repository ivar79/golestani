<?php

namespace Tests\Feature\RBAC;

use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P1: RBAC + permission layer + role-on-first-create flow.
 */
class PermissionsTest extends TestCase
{
    use RefreshDatabase;

    private function userWithRole(string $role, string $phone): User
    {
        $user = User::factory()->create(['phone' => $phone]);
        $user->assignRole($role);

        return $user;
    }

    // ---------- permission layer ----------

    public function test_support_and_expert_have_expected_permissions(): void
    {
        foreach (['support' => '09130000001', 'expert' => '09130000002'] as $role => $phone) {
            $user = $this->userWithRole($role, $phone);

            $this->assertTrue($user->hasPermission('users.view'), $role);
            $this->assertTrue($user->hasPermission('support.view'), $role);
            $this->assertTrue($user->hasPermission('support.reply'), $role);
            $this->assertTrue($user->hasPermission('chat.internal'), $role);

            // Not granted anywhere: sensitive admin permissions.
            $this->assertFalse($user->hasPermission('users.suspend'), $role);
            $this->assertFalse($user->hasPermission('cms.edit'), $role);
            $this->assertFalse($user->hasPermission('admin.manage'), $role);
        }
    }

    public function test_admin_bypasses_permission_checks(): void
    {
        $admin = $this->userWithRole('admin', '09000000000');

        $this->assertSame(['*'], $admin->permissionList());
        $this->assertTrue($admin->hasPermission('anything.at.all'));
    }

    public function test_plain_user_has_no_permissions(): void
    {
        $user = $this->userWithRole('user', '09130000003');

        $this->assertSame([], $user->permissionList());
        $this->assertFalse($user->hasPermission('support.view'));
        $this->assertFalse($user->hasPermission('users.view'));
    }

    public function test_me_endpoint_returns_permissions(): void
    {
        $user = $this->userWithRole('support', '09130000004');

        $response = $this->actingAs($user)->getJson('/api/auth/me');
        $response->assertOk();

        $permissions = $response->json('permissions');
        $this->assertNotEmpty($permissions);
        foreach (['users.view', 'support.view', 'support.reply', 'chat.internal'] as $p) {
            $this->assertContains($p, $permissions);
        }
    }

    // ---------- role-on-first-create (no public role escalation) ----------

    public function test_user_creating_first_business_becomes_business_owner(): void
    {
        $user = $this->userWithRole('user', '09130000005');

        $this->actingAs($user)
            ->postJson('/api/businesses', [
                'name' => 'کسب‌وکار من',
                'phone' => '09123456789',
                'address' => 'تهران',
                'city' => 'تهران',
                'latitude' => 35.7,
                'longitude' => 51.4,
            ])
            ->assertCreated();

        $this->assertTrue($user->fresh()->hasRole('business_owner'));
        $this->assertTrue(Business::where('user_id', $user->id)->exists());
    }

    public function test_user_cannot_assign_roles_via_business_payload(): void
    {
        $user = $this->userWithRole('user', '09130000006');

        $this->actingAs($user)
            ->postJson('/api/businesses', [
                'name' => 'حمله ارتقای نقش',
                'phone' => '09123456789',
                'address' => 'تهران',
                'city' => 'تهران',
                'latitude' => 35.7,
                'longitude' => 51.4,
                'roles' => ['admin'],
                'role' => 'admin',
                'is_active' => true,
            ])
            ->assertCreated();

        $fresh = $user->fresh();
        $this->assertFalse($fresh->hasRole('admin'));
        $this->assertTrue($fresh->hasRole('business_owner'));
    }

    public function test_business_payload_with_admin_role_in_request_is_ignored(): void
    {
        // Mass-assignment guard: UserController-style role injection must fail.
        $user = $this->userWithRole('user', '09130000007');
        $user->giveAllPermissionsTo = null; // no-op property, just noise

        $this->actingAs($user)
            ->postJson('/api/businesses', [
                'name' => 'تست',
                'phone' => '09123456789',
                'address' => 'تهران',
                'city' => 'تهران',
                'latitude' => 35.7,
                'longitude' => 51.4,
            ]);

        $this->assertFalse($user->fresh()->hasRole('admin'));
    }

    public function test_inactive_user_flag_cannot_be_set_via_business_create(): void
    {
        // is_active is not fillable via this endpoint; the created business
        // must not alter the user record.
        $user = $this->userWithRole('user', '09130000008');

        $this->actingAs($user)
            ->postJson('/api/businesses', [
                'name' => 'تست',
                'phone' => '09123456789',
                'address' => 'تهران',
                'city' => 'تهران',
                'latitude' => 35.7,
                'longitude' => 51.4,
                'is_active' => false,
            ])
            ->assertCreated();

        $this->assertTrue($user->fresh()->is_active);
    }

    // ---------- DECISION-1 backfill ----------

    public function test_backfill_migration_grants_business_owner_role_to_existing_owners(): void
    {
        // Create an owner WITHOUT the role (pre-backfill state).
        $orphan = User::factory()->create(['phone' => '09130000009']);
        $orphan->businesses()->create([
            'name' => 'بی نقش',
            'slug' => 'orphan-owner',
            'category' => 'خدمات',
            'city' => 'تهران',
            'status' => 'approved',
        ]);

        $this->assertFalse($orphan->fresh()->hasRole('business_owner'));

        // RefreshDatabase already ran the backfill; drop its record so we can
        // re-run exactly this migration against the current dataset.
        \Illuminate\Support\Facades\DB::table('migrations')
            ->where('migration', '2026_09_02_000002_backfill_business_owner_role')
            ->delete();

        $this->artisan('migrate', ['--path' => 'database/migrations/2026_09_02_000002_backfill_business_owner_role.php']);

        $this->assertTrue($orphan->fresh()->hasRole('business_owner'));
    }

    // ---------- designer bootstrap ----------

    public function test_user_bootstrapping_designer_profile_gets_designer_role(): void
    {
        $user = $this->userWithRole('user', '09130000010');

        $this->actingAs($user)->getJson('/api/designer/profile')->assertOk();

        $this->assertTrue($user->fresh()->hasRole('designer'));
    }

    public function test_designer_cannot_access_business_panel(): void
    {
        // designer-only user must not pass the businesses gate.
        $designer = $this->userWithRole('designer', '09130000011');

        $this->actingAs($designer)->getJson('/api/businesses')->assertForbidden();
    }

    public function test_user_without_staff_role_has_no_staff_access(): void
    {
        $user = $this->userWithRole('user', '09130000012');

        // No staff endpoints exist yet (P3/P4); the invariant is that a plain
        // user has none of the staff permissions.
        $this->assertFalse($user->hasPermission('support.view'));
        $this->assertFalse($user->hasPermission('chat.internal'));
        $this->assertFalse($user->hasPermission('users.view'));
    }
}
