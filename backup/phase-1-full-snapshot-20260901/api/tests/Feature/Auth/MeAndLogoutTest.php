<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MeAndLogoutTest extends TestCase
{
    use RefreshDatabase;

    public function test_me_returns_current_user_with_roles(): void
    {
        $user = User::create(['phone' => '09120000000', 'is_active' => true]);
        $user->assignRole('designer');

        $token = $user->createToken('test')->plainTextToken;

        $this->withToken($token)->getJson('/api/auth/me')
            ->assertOk()
            ->assertJson(['id' => $user->id, 'phone' => '09120000000', 'roles' => ['designer']]);
    }

    public function test_logout_revokes_only_current_token(): void
    {
        $user = User::create(['phone' => '09120000000', 'is_active' => true]);
        $first = $user->createToken('first')->plainTextToken;
        $second = $user->createToken('second')->plainTextToken;

        $this->withToken($first)->postJson('/api/auth/logout')->assertOk();

        // The in-process test client caches the resolved RequestGuard, which would
        // replay the user resolved before revocation. Forget the cached guards so
        // the next request re-runs token resolution against the database.
        // (Production is unaffected: each HTTP request runs in a fresh process.)
        $this->app->make('auth')->forgetGuards();

        $this->withToken($first)->getJson('/api/auth/me')->assertUnauthorized();
        $this->withToken($second)->getJson('/api/auth/me')->assertOk();
    }
}
