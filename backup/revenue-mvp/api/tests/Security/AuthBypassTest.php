<?php

namespace Tests\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Contract Phase 7 security controls: Access control.
 * Protected endpoints must reject anonymous/malformed tokens and
 * enforce role-based access (CheckRole middleware).
 */
class AuthBypassTest extends TestCase
{
    use RefreshDatabase;

    public function test_protected_endpoints_reject_anonymous_requests(): void
    {
        $this->getJson('/api/auth/me')->assertUnauthorized();
        $this->postJson('/api/auth/logout')->assertUnauthorized();
        $this->getJson('/api/admin/ping')->assertUnauthorized();
    }

    public function test_malformed_tokens_are_rejected(): void
    {
        $this->withToken('not-a-real-token')->getJson('/api/auth/me')->assertUnauthorized();
        $this->withToken('')->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_regular_users_cannot_access_admin_endpoints(): void
    {
        $user = User::create(['phone' => '09120000000', 'is_active' => true]);
        $user->assignRole('user');

        $this->withToken($user->createToken('t')->plainTextToken)
            ->getJson('/api/admin/ping')
            ->assertStatus(403);
    }

    public function test_admin_role_passes_role_middleware(): void
    {
        $admin = User::create(['phone' => '09000000000', 'is_active' => true]);
        $admin->assignRole('admin');

        $this->withToken($admin->createToken('t')->plainTextToken)
            ->getJson('/api/admin/ping')
            ->assertOk();
    }

    public function test_token_is_scoped_to_its_owner(): void
    {
        $owner = User::create(['phone' => '09120000001', 'is_active' => true]);
        User::create(['phone' => '09120000002', 'is_active' => true]);

        $this->withToken($owner->createToken('t')->plainTextToken)
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJson(['id' => $owner->id]);
    }
}
