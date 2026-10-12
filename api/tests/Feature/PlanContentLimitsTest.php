<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\Showcase;
use App\Models\Subscription;
use App\Models\User;
use App\Services\FeatureGate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * PLAN-BASED CONTENT LIMITS (Phase 5 findings C and D).
 *
 *  • max_images            — «گالری تصاویر بیشتر»: the gallery used to be
 *                            capped at a hard-coded 5 for every plan; it is
 *                            now a server-enforced entitlement whose free
 *                            value preserves the old limit exactly.
 *  • max_description_length — «توضیحات کامل‌تر خدمات»: the description length
 *                            is now a plan entitlement instead of a fixed
 *                            request rule + editor cap.
 *
 * Both must be enforced on the SERVER (a direct API call cannot bypass them),
 * and both must leave the free tier behaving exactly as before.
 */
class PlanContentLimitsTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $user): Business
    {
        return $user->businesses()->create(['name' => 'Limits Biz', 'slug' => 'limits-'.uniqid(), 'status' => 'approved']);
    }

    /** Attach an ACTIVE subscription carrying the given plan features. */
    private function subscribe(Business $business, array $features): void
    {
        $plan = Plan::create([
            'name' => 'پلن محدودیت', 'slug' => 'limits-plan-'.uniqid(), 'price' => 100000,
            'currency' => 'IRR', 'duration_days' => 30, 'features' => $features,
            'is_active' => true, 'is_public' => true,
        ]);

        (new Subscription)->forceFill([
            'business_id' => $business->id,
            'plan_id' => $plan->id,
            'status' => 'active',
            'plan_name' => $plan->name,
            'price_amount' => $plan->price,
            'price_currency' => 'IRR',
            'duration_days' => 30,
            'entitlements' => FeatureGate::normalize($features),
            'started_at' => Carbon::now()->subDay(),
            'expires_at' => Carbon::now()->addDays(29),
        ])->save();
    }

    private function uploadImage(User $user, Business $business)
    {
        return $this->actingAs($user)->postJson("/api/businesses/{$business->id}/images", [
            'image' => UploadedFile::fake()->image('gallery.jpg', 120, 120),
            'alt' => 'تصویر گالری',
        ]);
    }

    /* ------------------------------------------------------------------ gallery */

    public function test_the_free_tier_gallery_stops_at_five_images(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);

        for ($i = 1; $i <= 5; $i++) {
            $this->uploadImage($owner, $business)->assertCreated();
        }

        $blocked = $this->uploadImage($owner, $business);
        $blocked->assertStatus(422);
        $this->assertStringContainsString('5', (string) $blocked->json('message'));
        $this->assertSame(5, $business->images()->count());
    }

    public function test_a_paid_plan_can_raise_the_gallery_limit(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $this->subscribe($business, ['showcase' => true, 'max_showcases' => 10, 'max_images' => 8]);

        for ($i = 1; $i <= 8; $i++) {
            $this->uploadImage($owner, $business)->assertCreated();
        }

        $this->uploadImage($owner, $business)->assertStatus(422);
        $this->assertSame(8, $business->images()->count());
    }

    public function test_an_explicit_null_gallery_limit_means_unlimited(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $this->subscribe($business, ['showcase' => true, 'max_showcases' => 10, 'max_images' => null]);

        for ($i = 1; $i <= 7; $i++) {
            $this->uploadImage($owner, $business)->assertCreated();
        }

        $this->assertSame(7, $business->images()->count());
    }

    public function test_the_gallery_limit_is_not_a_frontend_only_rule(): void
    {
        // No UI involved at all: raw API calls against a free-tier business.
        $owner = $this->owner();
        $business = $this->business($owner);

        for ($i = 1; $i <= 5; $i++) {
            $this->uploadImage($owner, $business)->assertCreated();
        }
        $this->uploadImage($owner, $business)->assertStatus(422);

        // And another owner cannot add images to someone else's business.
        $intruder = $this->owner();
        $this->uploadImage($intruder, $business)->assertForbidden();
    }

    /* -------------------------------------------------------------- description */

    private function createShowcase(User $user, Business $business, string $description)
    {
        return $this->actingAs($user)->postJson("/api/businesses/{$business->id}/showcases", [
            'title' => 'آیتم ویترین',
            'description' => $description,
            'is_published' => true,
        ]);
    }

    public function test_the_free_tier_description_stops_at_five_hundred_characters(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $this->subscribe($business, ['showcase' => true, 'max_showcases' => 5]);

        $this->createShowcase($owner, $business, str_repeat('ا', 500))->assertCreated();

        $blocked = $this->createShowcase($owner, $business, str_repeat('ا', 501));
        $blocked->assertStatus(422);
        $this->assertStringContainsString('500', (string) $blocked->json('message'));
    }

    public function test_a_paid_plan_can_raise_the_description_limit(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $this->subscribe($business, ['showcase' => true, 'max_showcases' => 10, 'max_description_length' => 3000]);

        $this->createShowcase($owner, $business, str_repeat('ب', 2500))->assertCreated();

        $this->createShowcase($owner, $business, str_repeat('ب', 3001))->assertStatus(422);
    }

    public function test_the_description_boundary_is_exact_and_unlimited_is_supported(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $this->subscribe($business, ['showcase' => true, 'max_showcases' => 10, 'max_description_length' => null]);

        // null = unlimited
        $this->createShowcase($owner, $business, str_repeat('پ', 5000))->assertCreated();

        $limited = $this->owner();
        $limitedBusiness = $this->business($limited);
        $this->subscribe($limitedBusiness, ['showcase' => true, 'max_showcases' => 10, 'max_description_length' => 120]);

        $this->createShowcase($limited, $limitedBusiness, str_repeat('ت', 120))->assertCreated();
        $this->createShowcase($limited, $limitedBusiness, str_repeat('ت', 121))->assertStatus(422);
    }

    public function test_a_title_only_edit_of_longer_existing_content_is_still_allowed(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $this->subscribe($business, ['showcase' => true, 'max_showcases' => 5, 'max_description_length' => 500]);

        // Legacy row written before the limit existed.
        $showcase = Showcase::create([
            'business_id' => $business->id,
            'title' => 'قدیمی',
            'description' => str_repeat('ج', 900),
            'is_published' => true,
        ]);

        // Renaming it must not be blocked by the untouched, longer description.
        $this->actingAs($owner)
            ->putJson("/api/showcases/{$showcase->id}", ['title' => 'نام تازه', 'is_published' => true])
            ->assertOk();

        $this->assertSame('نام تازه', $showcase->fresh()->title);
        $this->assertSame(900, mb_strlen((string) $showcase->fresh()->description));

        // Rewriting the description itself IS checked.
        $this->actingAs($owner)
            ->putJson("/api/showcases/{$showcase->id}", ['title' => 'نام تازه', 'description' => str_repeat('ج', 501)])
            ->assertStatus(422);
    }

    /* ------------------------------------------------------------- contract */

    public function test_the_entitlements_payload_exposes_the_content_limits(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);

        $free = $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/entitlements")->assertOk();
        $this->assertSame(5, $free->json('entitlements.capabilities.max_images'));
        $this->assertSame(500, $free->json('entitlements.capabilities.max_description_length'));

        $paid = $this->business($this->owner());
        $this->subscribe($paid, ['showcase' => true, 'max_showcases' => 9, 'max_images' => 12, 'max_description_length' => 4000]);

        $payload = $this->actingAs($paid->owner)->getJson("/api/businesses/{$paid->id}/entitlements")->assertOk();
        $this->assertSame(12, $payload->json('entitlements.capabilities.max_images'));
        $this->assertSame(4000, $payload->json('entitlements.capabilities.max_description_length'));
    }
}
