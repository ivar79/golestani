<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Phase 3 (Golestani addition): the featured ladder.
 *
 * The search layer orders is_promoted DESC -> distance ASC (covered by
 * BusinessSearchTest); these tests cover the admin-only endpoint that flips
 * the flag, its authorization boundaries, and its mass-assignment safety.
 */
class BusinessPromotionTest extends TestCase
{
    use RefreshDatabase;

    private function makeOwner(): User
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        return $owner;
    }

    private function makeBusiness(User $owner, array $overrides = []): Business
    {
        return $owner->businesses()->create(array_merge([
            'name' => 'کافه نردبانی', 'slug' => 'ladder-'.fake()->unique()->numerify('######'),
            'city' => 'تهران', 'status' => 'approved',
        ], $overrides));
    }

    private function makeAdmin(): User
    {
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');

        return $admin;
    }

    public function test_admin_can_promote_and_unpromote(): void
    {
        $business = $this->makeBusiness($this->makeOwner());
        $admin = $this->makeAdmin();

        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/businesses/{$business->id}/promote", ['is_promoted' => true])
            ->assertOk()
            ->assertJsonPath('is_promoted', true);
        $this->assertTrue($business->fresh()->is_promoted);

        // Toggle back off (browser scenario 6).
        $this->patchJson("/api/admin/businesses/{$business->id}/promote", ['is_promoted' => false])
            ->assertOk()
            ->assertJsonPath('is_promoted', false);
        $this->assertFalse($business->fresh()->is_promoted);
    }

    public function test_promotion_is_recorded_in_the_audit_log(): void
    {
        $business = $this->makeBusiness($this->makeOwner());
        $admin = $this->makeAdmin();

        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/businesses/{$business->id}/promote", ['is_promoted' => true])
            ->assertOk();

        $row = DB::table('audit_events')
            ->where('subject_type', 'business')->where('subject_id', $business->id)
            ->where('event', 'business.promoted')->first();

        $this->assertNotNull($row, 'promotion must be audited');
        $this->assertSame($admin->id, $row->actor_id);
        $this->assertSame(['from' => false, 'to' => true], json_decode((string) $row->metadata, true));
    }

    public function test_regular_user_and_guest_are_rejected(): void
    {
        $business = $this->makeBusiness($this->makeOwner());
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('user');

        // Authenticated non-admin: 403 (browser scenario 7).
        $this->actingAs($owner, 'sanctum')
            ->patchJson("/api/admin/businesses/{$business->id}/promote", ['is_promoted' => true])
            ->assertForbidden();
        $this->assertFalse($business->fresh()->is_promoted, 'flag must be untouched');

        // Even the owner of the business cannot promote it themselves.
        $owningUser = User::whereKey($business->user_id)->first();
        $this->actingAs($owningUser, 'sanctum')
            ->patchJson("/api/admin/businesses/{$business->id}/promote", ['is_promoted' => true])
            ->assertForbidden();
        $this->assertFalse($business->fresh()->is_promoted);

        // Guest: the project's role middleware answers 403 (consistent with
        // every other admin route, e.g. moderate) — never leak route existence.
        $this->patchJson("/api/admin/businesses/{$business->id}/promote", ['is_promoted' => true])
            ->assertForbidden();
        $this->assertFalse($business->fresh()->is_promoted);
    }

    public function test_extra_fields_are_ignored_no_mass_assignment(): void
    {
        $business = $this->makeBusiness($this->makeOwner(), ['moderation_note' => 'بررسی اولیه']);
        $admin = $this->makeAdmin();

        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/businesses/{$business->id}/promote", [
                'is_promoted' => true,
                // Attack payload: attempt to ride the request into other fields.
                'status' => 'suspended',
                'name' => 'هک‌شده',
                'is_claimed' => false,
                'verification_level' => 9,
                'badges' => ['verified'],
            ])
            ->assertOk();

        $fresh = $business->fresh();
        $this->assertTrue($fresh->is_promoted, 'the single allowed field is applied');
        $this->assertSame('approved', $fresh->status);
        $this->assertSame('کافه نردبانی', $fresh->name);
        $this->assertTrue($fresh->is_claimed);
        $this->assertSame(0, $fresh->verification_level);
        $this->assertSame([], (array) $fresh->badges);
        $this->assertSame('بررسی اولیه', $fresh->moderation_note);
    }

    public function test_missing_or_non_boolean_flag_is_unprocessable(): void
    {
        $business = $this->makeBusiness($this->makeOwner());
        $admin = $this->makeAdmin();

        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/businesses/{$business->id}/promote", [])
            ->assertUnprocessable();

        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/businesses/{$business->id}/promote", ['is_promoted' => 'maybe'])
            ->assertUnprocessable();

        $this->assertFalse($business->fresh()->is_promoted);
    }

    public function test_promoting_a_pending_business_does_not_publish_it(): void
    {
        // Promotion changes presentation order only; it must never bypass
        // moderation by making a pending row searchable.
        $business = $this->makeBusiness($this->makeOwner(), ['status' => 'pending']);
        $admin = $this->makeAdmin();

        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/businesses/{$business->id}/promote", ['is_promoted' => true])
            ->assertOk();

        $this->assertTrue($business->fresh()->is_promoted);
        $this->getJson('/api/search/businesses?q=نردبانی')
            ->assertOk()
            ->assertJsonCount(0, 'data', 'pending rows stay invisible to search');
    }

    public function test_promoted_business_wins_over_never_promoted_in_non_spatial_search(): void
    {
        // End-to-end through the real endpoint (complements the ordering test
        // in BusinessSearchTest): a newly promoted row outranks newer rows.
        $owner = $this->makeOwner();
        $older = $this->makeBusiness($owner, ['name' => 'نردبان‌دار', 'slug' => 'with-ladder']);
        $this->makeBusiness($owner, ['name' => 'تازه‌تر', 'slug' => 'newer-row']);

        $admin = $this->makeAdmin();
        $this->actingAs($admin, 'sanctum')
            ->patchJson("/api/admin/businesses/{$older->id}/promote", ['is_promoted' => true])
            ->assertOk();

        $res = $this->getJson('/api/search/businesses?city=تهران')->assertOk();
        $this->assertSame($older->id, $res->json('data.0.id'), 'promoted row must come first');
        $this->assertTrue($res->json('data.0.is_promoted'));
    }
}
