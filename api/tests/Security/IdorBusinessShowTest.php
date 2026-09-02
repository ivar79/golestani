<?php

namespace Tests\Security;

use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P0 security hotfix regression tests.
 *
 * Before this fix, GET /api/businesses/{id} was only protected by the
 * route-level role middleware, so any business_owner could read ANY
 * business (including the owner's phone) by ID — a real IDOR.
 */
class IdorBusinessShowTest extends TestCase
{
    use RefreshDatabase;

    private function owner(string $phone): User
    {
        $user = User::factory()->create(['phone' => $phone]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $owner, string $slug): Business
    {
        return $owner->businesses()->create([
            'name' => 'کسب‌وکار '.$slug,
            'slug' => $slug,
            'category' => 'خدمات',
            'city' => 'تهران',
            'status' => 'approved',
        ]);
    }

    public function test_owner_cannot_read_another_owners_business(): void
    {
        $victim = $this->owner('09120000001');
        $attacker = $this->owner('09120000002');
        $business = $this->business($victim, 'victim-business');

        $this->actingAs($attacker)
            ->getJson('/api/businesses/'.$business->id)
            ->assertForbidden();
    }

    public function test_owner_can_read_own_business(): void
    {
        $owner = $this->owner('09120000003');
        $business = $this->business($owner, 'own-business');

        $this->actingAs($owner)
            ->getJson('/api/businesses/'.$business->id)
            ->assertOk()
            ->assertJsonPath('slug', 'own-business');
    }

    public function test_admin_can_read_any_business(): void
    {
        $owner = $this->owner('09120000004');
        $admin = User::factory()->create(['phone' => '09000000009']);
        $admin->assignRole('admin');
        $business = $this->business($owner, 'admin-readable');

        $this->actingAs($admin)
            ->getJson('/api/businesses/'.$business->id)
            ->assertOk()
            ->assertJsonPath('slug', 'admin-readable');
    }

    public function test_regular_user_cannot_read_any_business(): void
    {
        $owner = $this->owner('09120000005');
        $user = User::factory()->create(['phone' => '09120000006']);
        $user->assignRole('user');
        $business = $this->business($owner, 'user-denied');

        $this->actingAs($user)
            ->getJson('/api/businesses/'.$business->id)
            ->assertForbidden();
    }
}
