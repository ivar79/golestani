<?php

namespace Tests\Feature;

use App\Models\Advertisement;
use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * PLACEMENT BUSINESS CAP (Phase 5 finding B).
 *
 * The contractual rule is «حداکثر ۴ کسب‌وکار تبلیغاتی در جایگاه تعیین‌شده» —
 * four distinct BUSINESSES. Previously the endpoint capped raw ad ROWS
 * (`limit(4)`), so one advertiser holding several approved ads could occupy
 * every visible position and displace everyone else. These tests pin the
 * business-level cap, the unchanged eligibility rules, determinism, and the
 * public payload's field allowlist.
 */
class AdvertisementPlacementBusinessCapTest extends TestCase
{
    use RefreshDatabase;

    private function approvedBusiness(string $name): Business
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user->businesses()->create([
            'name' => $name,
            'slug' => 'cap-'.uniqid(),
            'status' => 'approved',
        ]);
    }

    private function ad(Business $business, array $overrides = []): Advertisement
    {
        return $business->advertisements()->create(array_merge([
            'slot' => 'home_banner',
            'title' => 'آگهی '.$business->name,
            'target_url' => 'https://example.com/landing',
            'status' => 'approved',
            'starts_at' => null,
            'ends_at' => null,
        ], $overrides));
    }

    /** @return array<int,int> business ids in returned order */
    private function publicBusinessIds(string $slot = 'home_banner'): array
    {
        $response = $this->getJson("/api/public/advertisements/{$slot}")->assertOk();

        return collect($response->json())->pluck('business_id')->all();
    }

    public function test_one_advertiser_cannot_fill_a_placement_or_displace_others(): void
    {
        $hoarder = $this->approvedBusiness('پرتبلیغ');
        $others = collect(['الف', 'ب', 'پ', 'ت'])->map(fn (string $n) => $this->approvedBusiness($n));

        // The same business owns four approved, eligible ads in one placement,
        // and they are the BEST RANKED rows (most recent starts_at) — so any
        // ad-row cap would hand it every position.
        foreach (range(1, 4) as $i) {
            $this->ad($hoarder, ['title' => "آگهی {$i}", 'starts_at' => Carbon::now()->subMinutes(10)]);
        }
        $others->each(fn (Business $b) => $this->ad($b, ['starts_at' => Carbon::now()->subDay()]));

        $ids = $this->publicBusinessIds();

        $this->assertCount(4, $ids);
        $this->assertCount(4, array_unique($ids), 'each placement position must belong to a DISTINCT business');
        $this->assertSame(1, collect($ids)->filter(fn ($id) => $id === $hoarder->id)->count(), 'the multi-ad business occupies exactly one position');

        // The other three positions go to the competing businesses — never to
        // a second (or third, or fourth) ad of the same advertiser.
        $shown = collect($ids)->reject(fn ($id) => $id === $hoarder->id);
        $this->assertCount(3, $shown);
        $this->assertTrue(
            $shown->every(fn ($id) => $others->contains(fn (Business $b) => $b->id === $id)),
            'remaining positions must belong to distinct competing businesses',
        );
    }

    public function test_the_newest_eligible_ad_of_a_business_is_the_one_displayed(): void
    {
        $business = $this->approvedBusiness('چندآگهی');
        $this->ad($business, ['title' => 'قدیمی']);
        $this->ad($business, ['title' => 'میانی']);
        $newest = $this->ad($business, ['title' => 'جدیدترین']);

        $payload = $this->getJson('/api/public/advertisements/home_banner')->assertOk()->json();

        $this->assertCount(1, $payload);
        $this->assertSame($newest->id, $payload[0]['id']);
        $this->assertSame('جدیدترین', $payload[0]['title']);
    }

    public function test_a_placement_with_fewer_than_four_businesses_returns_all_of_them(): void
    {
        $a = $this->approvedBusiness('یک');
        $b = $this->approvedBusiness('دو');
        $this->ad($a, ['title' => 'اول']);
        $this->ad($b, ['title' => 'دوم']);

        $ids = $this->publicBusinessIds();

        $this->assertCount(2, $ids);
        $this->assertEqualsCanonicalizing([$a->id, $b->id], $ids);
    }

    public function test_ineligible_ads_and_ineligible_businesses_are_never_selected(): void
    {
        $business = $this->approvedBusiness('واجد شرایط');
        $rejectedBusiness = $this->approvedBusiness('تأییدنشده');
        $rejectedBusiness->update(['status' => 'pending']);

        // Ineligible rows of an otherwise eligible business.
        $this->ad($business, ['status' => 'pending', 'title' => 'در انتظار']);
        $this->ad($business, ['status' => 'rejected', 'title' => 'رد شده']);
        $this->ad($business, ['starts_at' => Carbon::tomorrow(), 'title' => 'آینده']);
        $this->ad($business, ['ends_at' => Carbon::yesterday(), 'title' => 'منقضی']);
        $this->ad($business, ['slot' => 'search_top', 'title' => 'جایگاه دیگر']);
        $this->ad($rejectedBusiness, ['title' => 'کسب‌وکار تأییدنشده']);

        $this->assertSame([], $this->publicBusinessIds());

        // A single genuinely eligible row is the only thing that survives.
        $eligible = $this->ad($business, ['title' => 'واجد شرایط']);
        $payload = $this->getJson('/api/public/advertisements/home_banner')->assertOk()->json();

        $this->assertCount(1, $payload);
        $this->assertSame($eligible->id, $payload[0]['id']);
    }

    public function test_the_selection_is_deterministic_across_repeated_requests(): void
    {
        $businesses = collect(range(1, 6))->map(fn (int $i) => $this->approvedBusiness("بیزنس {$i}"));
        $businesses->each(fn (Business $b) => $this->ad($b));
        // A duplicate-ad business that must resolve to the same row every time.
        $this->ad($businesses->first());

        $first = $this->getJson('/api/public/advertisements/home_banner')->assertOk()->json();
        $second = $this->getJson('/api/public/advertisements/home_banner')->assertOk()->json();

        $this->assertSame(
            collect($first)->pluck('id')->all(),
            collect($second)->pluck('id')->all(),
        );
        $this->assertCount(4, $first);
    }

    public function test_the_public_payload_exposes_only_permitted_fields(): void
    {
        $business = $this->approvedBusiness('افشا');
        $this->ad($business, ['admin_note' => 'یادداشت محرمانه مدیر']);

        $payload = $this->getJson('/api/public/advertisements/home_banner')->assertOk()->json();

        $this->assertSame(
            ['id', 'business_id', 'slot', 'title', 'target_url', 'image_path', 'status', 'starts_at', 'ends_at'],
            array_keys($payload[0]),
        );
        $this->assertArrayNotHasKey('admin_note', $payload[0]);
    }

    public function test_the_cap_constant_is_four(): void
    {
        $this->assertSame(4, \App\Http\Controllers\Api\AdvertisementController::PLACEMENT_BUSINESS_LIMIT);
    }
}
