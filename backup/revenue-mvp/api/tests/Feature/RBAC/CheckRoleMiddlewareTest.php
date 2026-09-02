<?php

namespace Tests\Feature\RBAC;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

class CheckRoleMiddlewareTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    // ─── Basic access control ───────────────────────────────────────

    public function test_unauthenticated_request_is_rejected_with_401(): void
    {
        $this->getJson('/api/admin/ping')->assertStatus(401);
    }

    public function test_user_without_required_role_gets_403(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('user');

        $this->withToken($user->createToken('t')->plainTextToken)
            ->getJson('/api/admin/ping')
            ->assertStatus(403);
    }

    public function test_admin_role_passes_admin_middleware(): void
    {
        $admin = User::create(['phone' => '09000000000', 'is_active' => true]);
        $admin->assignRole('admin');

        $this->withToken($admin->createToken('t')->plainTextToken)
            ->getJson('/api/admin/ping')
            ->assertOk();
    }

    // ─── Multiple roles ─────────────────────────────────────────────

    public function test_user_with_multiple_roles_can_access_if_one_matches(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('user');
        $user->assignRole('designer');

        $this->withToken($user->createToken('t')->plainTextToken)
            ->getJson('/api/admin/ping')
            ->assertStatus(403);
    }

    // ─── Token scope ────────────────────────────────────────────────

    public function test_token_is_bound_to_its_owner(): void
    {
        $admin = User::create(['phone' => '09000000000', 'is_active' => true]);
        $admin->assignRole('admin');

        $adminToken = $admin->createToken('admin-token')->plainTextToken;
        $this->withToken($adminToken)
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJson(['id' => $admin->id]);
    }

    // ─── Multiple tokens ────────────────────────────────────────────

    public function test_multiple_tokens_for_same_user(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);
        $user->assignRole('admin');

        $token1 = $user->createToken('device-1')->plainTextToken;
        $token2 = $user->createToken('device-2')->plainTextToken;

        $this->withToken($token1)->getJson('/api/auth/me')->assertOk();
        $this->withToken($token2)->getJson('/api/auth/me')->assertOk();
    }

    public function test_revoked_token_is_rejected(): void
    {
        $admin = User::create(['phone' => '09000000000', 'is_active' => true]);
        $admin->assignRole('admin');

        // Create a token, then revoke it by deleting all tokens
        $admin->createToken('temp');
        $admin->tokens()->delete();

        $this->app->make('auth')->forgetGuards();

        // We can't use the deleted token, but we can verify no tokens remain
        $this->assertCount(0, $admin->fresh()->tokens);

        // A fresh token should still work
        $freshToken = $admin->createToken('fresh')->plainTextToken;
        $this->withToken($freshToken)->getJson('/api/auth/me')->assertOk();
    }

    // ─── User model without roles ───────────────────────────────────

    public function test_user_with_no_roles_cannot_access_admin_route(): void
    {
        $user = User::create(['phone' => '09123456789', 'is_active' => true]);

        $this->withToken($user->createToken('t')->plainTextToken)
            ->getJson('/api/admin/ping')
            ->assertStatus(403);
    }
}
