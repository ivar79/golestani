<?php
namespace Tests;
use Database\Seeders\PermissionSeeder;
use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\Sanctum;
abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();

        // RBAC tests rely on the fixed roles + permission matrix existing.
        // Route-inspection and driver unit tests never migrate the (in-memory)
        // database, so seeding would fail with "no such table"; skip when the
        // schema is not present.
        if (\Schema::hasTable('roles')) {
            $this->seed(RoleSeeder::class);
            $this->seed(PermissionSeeder::class);
        }
    }
    // Existing role tests keep their actingAs API, but now use the actual API
    // guard rather than a web session. Cookie isolation is tested with be().
    public function actingAs(\Illuminate\Contracts\Auth\Authenticatable $user, $guard = null)
    {
        Sanctum::actingAs($user, ['*'], $guard ?? 'sanctum');
        return $this;
    }
}
