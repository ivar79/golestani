<?php

namespace Tests\Feature;

use App\Models\Designer;
use App\Models\SiteSetting;
use App\Models\User;
use App\Services\StudioAccess;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The ADMIN designer-approval workflow — the ONLY writer of the canonical
 * `users.designer_status`:
 *
 *   PATCH /admin/users/{user}/designer-status
 *     = status + designer role + legacy `designers` row sync + audit,
 *       atomically (reject/suspend require a reason).
 *
 * The legacy `PATCH /admin/designers/{designer}/moderate` keeps working and
 * now writes the canonical field too, so the two designer concepts can never
 * diverge silently again.
 */
class AdminDesignerApprovalTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('admin');

        return $user;
    }

    private function candidate(?string $legacyStatus = 'pending'): array
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('user');

        $designer = null;
        if ($legacyStatus !== null) {
            $designer = Designer::create([
                'user_id' => $user->id,
                'display_name' => 'طراح تست',
                'slug' => 'designer-'.fake()->unique()->regexify('[a-z0-9]{8}'),
                'status' => $legacyStatus,
            ]);
        }

        return [$user->fresh(), $designer];
    }

    public function test_approval_assigns_the_role_and_syncs_both_concepts(): void
    {
        [$user] = $this->candidate();
        $admin = $this->admin();

        $this->actingAs($admin)
            ->patchJson("/api/admin/users/{$user->id}/designer-status", ['designer_status' => 'approved'])
            ->assertOk()
            ->assertJsonPath('designer_status', 'approved')
            ->assertJsonPath('designer.status', 'approved');

        $this->assertDatabaseHas('users', ['id' => $user->id, 'designer_status' => 'approved']);
        $this->assertTrue($user->fresh()->hasRole('designer'));
        $this->assertDatabaseHas('designers', ['user_id' => $user->id, 'status' => 'approved']);

        $audit = DB::table('audit_events')->where('event', 'admin.designer_status_changed')->first();
        $this->assertNotNull($audit);
        $this->assertSame($admin->id, (int) $audit->actor_id);
        $this->assertSame('user', $audit->subject_type);
        $this->assertSame($user->id, (int) $audit->subject_id);
        $metadata = json_decode($audit->metadata, true);
        $this->assertSame('none', $metadata['from']);
        $this->assertSame('approved', $metadata['to']);
        $this->assertSame('assigned', $metadata['role']);
    }

    public function test_rejection_requires_a_reason_and_removes_the_role(): void
    {
        [$user] = $this->candidate();
        $admin = $this->admin();

        $this->actingAs($admin)
            ->patchJson("/api/admin/users/{$user->id}/designer-status", ['designer_status' => 'approved'])
            ->assertOk();

        // No reason → 422 (the status is untouched).
        $this->actingAs($admin)
            ->patchJson("/api/admin/users/{$user->id}/designer-status", ['designer_status' => 'rejected'])
            ->assertStatus(422);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'designer_status' => 'approved']);

        // With a reason → rejected + role removed + legacy row synced.
        $this->actingAs($admin)
            ->patchJson("/api/admin/users/{$user->id}/designer-status", [
                'designer_status' => 'rejected',
                'reason' => 'نمونه‌کارها کافی نبود.',
            ])
            ->assertOk();

        $this->assertDatabaseHas('users', ['id' => $user->id, 'designer_status' => 'rejected']);
        $this->assertFalse($user->fresh()->hasRole('designer'));
        $this->assertDatabaseHas('designers', ['user_id' => $user->id, 'status' => 'rejected']);
    }

    public function test_non_admins_cannot_change_designer_status(): void
    {
        [$user] = $this->candidate();
        $other = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $other->assignRole('designer');

        $this->actingAs($other)
            ->patchJson("/api/admin/users/{$user->id}/designer-status", ['designer_status' => 'approved'])
            ->assertStatus(403);

        $this->assertDatabaseHas('users', ['id' => $user->id, 'designer_status' => 'none']);
    }

    public function test_invalid_status_is_rejected(): void
    {
        [$user] = $this->candidate();
        $admin = $this->admin();

        $this->actingAs($admin)
            ->patchJson("/api/admin/users/{$user->id}/designer-status", ['designer_status' => 'superstar'])
            ->assertStatus(422);
    }

    public function test_legacy_moderation_endpoint_writes_the_canonical_status(): void
    {
        [$user, $designer] = $this->candidate();
        $admin = $this->admin();

        $this->actingAs($admin)
            ->patchJson("/api/admin/designers/{$designer->id}/moderate", ['status' => 'approved'])
            ->assertOk();

        $this->assertDatabaseHas('users', ['id' => $user->id, 'designer_status' => 'approved']);
        $this->assertTrue($user->fresh()->hasRole('designer'));

        $audit = DB::table('audit_events')->where('event', 'admin.designer_status_changed')->latest('id')->first();
        $this->assertSame('designers.moderate', json_decode($audit->metadata, true)['source']);
    }

    public function test_admin_users_list_exposes_both_designer_concepts(): void
    {
        [$user, $designer] = $this->candidate('approved');
        $admin = $this->admin();

        // Canonical says none, legacy says approved → the UI can flag the
        // divergence before anyone flips the studio switch.
        $response = $this->actingAs($admin)->getJson('/api/admin/users')->assertOk();
        $row = collect($response->json('data'))->firstWhere('id', $user->id);

        $this->assertSame('none', $row['designer_status']);
        $this->assertSame($designer->id, $row['designer']['id']);
        $this->assertSame('approved', $row['designer']['status']);
    }

    public function test_studio_rollout_report_is_admin_only(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)
            ->getJson('/api/admin/studio/report')
            ->assertOk()
            ->assertJsonPath('gate.enforced', false)
            ->assertJsonPath('gate.capability', 'designer_studio')
            ->assertJsonStructure([
                'users' => ['total', 'by_designer_status', 'divergent'],
                'businesses' => ['total', 'with_designer_studio'],
                'admin_bypasses' => ['total'],
            ]);

        $designer = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $designer->assignRole('designer');
        $this->actingAs($designer)->getJson('/api/admin/studio/report')->assertStatus(403);
    }

    public function test_studio_rollout_switch_is_admin_writable(): void
    {
        $admin = $this->admin();

        $this->assertFalse(StudioAccess::enforced());

        $this->actingAs($admin)
            ->putJson('/api/admin/settings/studio_designer_only', ['value' => true])
            ->assertOk();

        $this->assertSame('1', SiteSetting::query()->where('key', 'studio_designer_only')->value('value'));
        $this->assertTrue(StudioAccess::enforced());

        // Unknown keys stay refused (whitelist intact).
        $this->actingAs($admin)
            ->putJson('/api/admin/settings/studio_everything', ['value' => true])
            ->assertStatus(422);
    }
}
