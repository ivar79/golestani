<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Regression: designer-role owners lost card access after an admin role
 * change (audit event #17).
 *
 * Chain under test:
 *   1. The admin role editor sent a single-role payload {roles:[designer]}
 *      and AdminController::updateUser replaced the whole set — silently
 *      stripping business_owner from user 36.
 *   2. BusinessCardRequest::authorize() only admitted business_owner|admin
 *      while the route group (342c7f5) already admitted designer — so every
 *      card save started 403-ing although the studio plans themselves had
 *      widened access.
 *
 * Both ends are now fixed: the single-role payload ADDs (attach) instead of
 * replacing, and the three business FormRequests admit designer. Guards:
 * non-owners and role-less users must still be refused.
 */
class CardRoleRegressionTest extends TestCase
{
    use RefreshDatabase;

    private function businessFor(User $owner): \App\Models\Business
    {
        return $owner->businesses()->create([
            'name' => 'Role Reg',
            'slug' => 'role-reg-'.fake()->unique()->regexify('[a-z0-9]{8}'),
            'status' => 'approved',
        ]);
    }

    private function saveCard(User $user, int $businessId): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($user, 'sanctum')
            ->putJson("/api/businesses/{$businessId}/card", [
                // Free-tier-safe scalars: the role gate is the variable under
                // test; premium templates/themes would 403 on entitlements.
                'template' => 'classic',
                'theme' => 'navy',
                'font_size' => 'medium',
                'font_family' => 'vazir',
            ]);
    }

    private function readCard(User $user, int $businessId): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($user, 'sanctum')
            ->getJson("/api/businesses/{$businessId}/card");
    }

    public function test_designer_only_owner_can_save_and_read_card(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');
        $business = $this->businessFor($user);

        $this->saveCard($user, $business->id)->assertOk();
        $this->readCard($user, $business->id)->assertOk();
    }

    public function test_admin_single_role_grant_does_not_strip_existing_roles(): void
    {
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');

        $target = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $target->assignRole('business_owner');
        // Designer ROLE grants require the canonical status to be approved.
        $target->forceFill(['designer_status' => 'approved'])->save();

        // Mirrors AdminUsersTab::handleRoleChange: exactly one role.
        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/users/{$target->id}", ['roles' => ['designer']])
            ->assertOk();

        $fresh = $target->fresh();
        $this->assertTrue($fresh->hasRole('designer'), 'selected role must be granted');
        $this->assertTrue($fresh->hasRole('business_owner'), 'existing role must survive (audit #17 regression)');

        // And the owner can still save their card afterwards.
        $business = $this->businessFor($target);
        $this->saveCard($fresh, $business->id)->assertOk();
    }

    public function test_admin_explicit_multi_role_payload_still_replaces_the_set(): void
    {
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');

        $target = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $target->assignRole('business_owner');
        $target->forceFill(['designer_status' => 'approved'])->save();

        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/users/{$target->id}", ['roles' => ['designer', 'user']])
            ->assertOk();

        $fresh = $target->fresh();
        $this->assertTrue($fresh->hasRole('designer'));
        $this->assertTrue($fresh->hasRole('user'));
        $this->assertFalse($fresh->hasRole('business_owner'), 'explicit multi-role replace is intentional');
    }

    public function test_admin_single_role_payload_cannot_grant_designer_without_approved_status(): void
    {
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');

        $target = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $target->assignRole('business_owner');

        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/users/{$target->id}", ['roles' => ['designer']])
            ->assertStatus(422);

        $this->assertTrue($target->fresh()->hasRole('business_owner'), 'failed grant must not strip anything');
    }

    public function test_role_less_user_is_still_refused(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $business = $this->businessFor($user);

        $this->saveCard($user, $business->id)->assertStatus(403);
        $this->readCard($user, $business->id)->assertStatus(403);
    }

    public function test_user_cannot_save_someone_elses_card(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');
        $business = $this->businessFor($owner);

        $intruder = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $intruder->assignRole('designer');

        $this->saveCard($intruder, $business->id)->assertStatus(403);
    }

    public function test_admin_designer_status_workflow_keeps_gate_intact(): void
    {
        // Approval via the CANONICAL endpoint still grants the role; the
        // designer-only owner keeps card access through the new gate.
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');

        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');
        $business = $this->businessFor($user);

        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/users/{$user->id}/designer-status", [
                'designer_status' => 'approved',
                'reason' => 'portfolio ok',
            ])
            ->assertOk();

        $this->saveCard($user->fresh(), $business->id)->assertOk();
    }
}
