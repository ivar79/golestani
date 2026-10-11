<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FeaturedBusinessTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');
        return $owner;
    }

    public function test_homepage_featured_endpoint_only_returns_approved_promoted_businesses_and_caps_at_four(): void
    {
        $owner = $this->owner();
        foreach (range(1, 5) as $number) {
            $owner->businesses()->create([
                'name' => 'Featured '.$number, 'slug' => 'featured-'.$number,
                'status' => 'approved', 'is_promoted' => true,
                'phone' => '0210000000', 'email' => 'private@example.com',
                'moderation_note' => 'private moderation note',
            ]);
        }
        $owner->businesses()->create([
            'name' => 'Pending Featured', 'slug' => 'pending-featured',
            'status' => 'pending', 'is_promoted' => true,
        ]);
        $owner->businesses()->create([
            'name' => 'Ordinary Approved', 'slug' => 'ordinary-approved',
            'status' => 'approved', 'is_promoted' => false,
        ]);

        $response = $this->getJson('/api/public/businesses/featured')->assertOk()->assertJsonCount(4);
        $slugs = collect($response->json())->pluck('slug')->all();
        $this->assertNotContains('pending-featured', $slugs);
        $this->assertNotContains('ordinary-approved', $slugs);
        foreach ($response->json() as $item) {
            $this->assertTrue($item['is_promoted']);
            $this->assertArrayNotHasKey('user_id', $item);
            $this->assertArrayNotHasKey('phone', $item);
            $this->assertArrayNotHasKey('email', $item);
            $this->assertArrayNotHasKey('moderation_note', $item);
        }
    }
}
