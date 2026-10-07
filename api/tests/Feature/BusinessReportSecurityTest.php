<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Regression suite for audit finding `reports-endpoint-unbounded-writes`:
 * the public report endpoint accepted unlimited sequential writes from one
 * account (12 requests → 12 rows, no throttle).
 *
 * The fix has two layers, and both are asserted here:
 *   - route throttle 5/60 (per authenticated USER, not per business) so the
 *     total write volume is bounded;
 *   - an ACTIVE duplicate (same reporter + same type + same business, status
 *     open|reviewing, within 24h) answers 409 with the existing report id —
 *     no row is created and nothing is silently discarded.
 * Legitimate reporting must keep working: other businesses, other types,
 * other users, and re-reporting a RESOLVED issue are all still accepted.
 */
class BusinessReportSecurityTest extends TestCase
{
    use RefreshDatabase;

    private function user(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('user');

        return $user;
    }

    private function approvedBusiness(): Business
    {
        $owner = $this->user();
        $owner->assignRole('business_owner');

        return $owner->businesses()->create([
            'name' => 'کسب‌وکار قابل گزارش',
            'slug' => 'report-biz-'.fake()->unique()->numerify('######'),
            'category' => 'کافه',
            'city' => 'تهران',
            'status' => 'approved',
        ]);
    }

    /** @return array<string, string> */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'type' => 'incorrect_data',
            'message' => 'اطلاعات این کسب‌وکار نادرست است.',
        ], $overrides);
    }

    // ------------------------------------------------------------------
    // Legitimate behaviour preserved
    // ------------------------------------------------------------------

    public function test_authenticated_user_can_submit_a_valid_report(): void
    {
        $business = $this->approvedBusiness();
        $reporter = $this->user();

        $this->actingAs($reporter)
            ->postJson("/api/public/businesses/{$business->id}/reports", $this->payload())
            ->assertCreated()
            ->assertJsonPath('type', 'incorrect_data')
            ->assertJsonPath('reporter_id', $reporter->id);

        // The row's `status` default ('open') is applied by the database, so
        // assert it on the persisted row rather than on the create response.

        $this->assertDatabaseHas('business_reports', [
            'business_id' => $business->id,
            'reporter_id' => $reporter->id,
            'type' => 'incorrect_data',
            'status' => 'open',
        ]);
    }

    public function test_report_payload_is_validated(): void
    {
        $business = $this->approvedBusiness();
        $reporter = $this->user();
        $url = "/api/public/businesses/{$business->id}/reports";

        // Unknown type.
        $this->actingAs($reporter)->postJson($url, $this->payload(['type' => 'not_a_type']))->assertUnprocessable();
        // Message too short / too long / missing.
        $this->actingAs($reporter)->postJson($url, $this->payload(['message' => 'بد']))->assertUnprocessable();
        $this->actingAs($reporter)->postJson($url, $this->payload(['message' => str_repeat('ا', 2001)]))->assertUnprocessable();
        $this->actingAs($reporter)->postJson($url, ['type' => 'abuse'])->assertUnprocessable();

        $this->assertSame(0, BusinessReport::count());
    }

    public function test_unauthenticated_user_cannot_submit_a_report(): void
    {
        $business = $this->approvedBusiness();

        $this->postJson("/api/public/businesses/{$business->id}/reports", $this->payload())->assertUnauthorized();

        $this->assertSame(0, BusinessReport::count());
    }

    public function test_unapproved_business_is_not_reportable(): void
    {
        $owner = $this->user();
        $owner->assignRole('business_owner');
        $pending = $owner->businesses()->create([
            'name' => 'در انتظار تأیید', 'slug' => 'pending-report-biz',
            'city' => 'تهران', 'status' => 'pending',
        ]);

        $this->actingAs($this->user())
            ->postJson("/api/public/businesses/{$pending->id}/reports", $this->payload())
            ->assertNotFound();
    }

    // ------------------------------------------------------------------
    // Duplicate / active-report guard
    // ------------------------------------------------------------------

    public function test_duplicate_active_report_returns_conflict_with_existing_id_and_creates_no_row(): void
    {
        $business = $this->approvedBusiness();
        $reporter = $this->user();
        $url = "/api/public/businesses/{$business->id}/reports";

        $first = $this->actingAs($reporter)->postJson($url, $this->payload())->assertCreated();
        $id = $first->json('id');

        // Identical repeat → 409, explicitly naming the report that already exists.
        $this->actingAs($reporter)
            ->postJson($url, $this->payload())
            ->assertStatus(409)
            ->assertJsonPath('report_id', $id);

        $this->assertSame(1, BusinessReport::count());
    }

    public function test_reviewing_report_still_blocks_duplicates(): void
    {
        $business = $this->approvedBusiness();
        $reporter = $this->user();
        $url = "/api/public/businesses/{$business->id}/reports";

        $first = $this->actingAs($reporter)->postJson($url, $this->payload())->assertCreated();
        // Admin moderation moves it to `reviewing` — it is still in the queue,
        // so the same reporter cannot re-submit and create queue noise.
        BusinessReport::whereKey($first->json('id'))->update(['status' => 'reviewing']);

        $this->actingAs($reporter)->postJson($url, $this->payload())->assertStatus(409);
        $this->assertSame(1, BusinessReport::count());
    }

    public function test_resolved_report_can_be_reported_again(): void
    {
        $business = $this->approvedBusiness();
        $reporter = $this->user();
        $url = "/api/public/businesses/{$business->id}/reports";

        $first = $this->actingAs($reporter)->postJson($url, $this->payload())->assertCreated();
        BusinessReport::whereKey($first->json('id'))->update(['status' => 'resolved']);

        // Terminal status → a genuine re-report must still go through.
        $this->actingAs($reporter)->postJson($url, $this->payload())->assertCreated();
        $this->assertSame(2, BusinessReport::count());
    }

    public function test_duplicate_window_expires_after_a_day(): void
    {
        $business = $this->approvedBusiness();
        $reporter = $this->user();
        $url = "/api/public/businesses/{$business->id}/reports";

        $this->actingAs($reporter)->postJson($url, $this->payload())->assertCreated();

        $this->travel(25)->hours();

        $this->actingAs($reporter)->postJson($url, $this->payload())->assertCreated();
        $this->assertSame(2, BusinessReport::count());
    }

    public function test_same_type_on_another_business_is_not_blocked(): void
    {
        $a = $this->approvedBusiness();
        $b = $this->approvedBusiness();
        $reporter = $this->user();

        $this->actingAs($reporter)->postJson("/api/public/businesses/{$a->id}/reports", $this->payload())->assertCreated();
        $this->actingAs($reporter)->postJson("/api/public/businesses/{$b->id}/reports", $this->payload())->assertCreated();
    }

    public function test_different_type_on_same_business_is_not_blocked(): void
    {
        $business = $this->approvedBusiness();
        $reporter = $this->user();
        $url = "/api/public/businesses/{$business->id}/reports";

        $this->actingAs($reporter)->postJson($url, $this->payload(['type' => 'incorrect_data']))->assertCreated();
        $this->actingAs($reporter)->postJson($url, $this->payload(['type' => 'closed']))->assertCreated();
    }

    // ------------------------------------------------------------------
    // Rate limiting (per user, not per business)
    // ------------------------------------------------------------------

    public function test_report_writes_are_throttled_per_user(): void
    {
        $reporter = $this->user();
        $businesses = [];
        // Six DIFFERENT businesses: each one is a legitimate, non-duplicate
        // report, so only the route throttle can stop the sixth.
        foreach (range(1, 6) as $i) {
            $businesses[] = $this->approvedBusiness();
        }

        foreach (array_slice($businesses, 0, 5) as $business) {
            $this->actingAs($reporter)
                ->postJson("/api/public/businesses/{$business->id}/reports", $this->payload(['type' => 'other']))
                ->assertCreated();
        }

        $this->actingAs($reporter)
            ->postJson("/api/public/businesses/{$businesses[5]->id}/reports", $this->payload(['type' => 'other']))
            ->assertStatus(429);

        // The quota is per USER (not per business)…
        $this->assertSame(5, BusinessReport::count());
        // …and never leaks onto another account.
        $this->actingAs($this->user())
            ->postJson("/api/public/businesses/{$businesses[5]->id}/reports", $this->payload(['type' => 'other']))
            ->assertCreated();
    }
}
