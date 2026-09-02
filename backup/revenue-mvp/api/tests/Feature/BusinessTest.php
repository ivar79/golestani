<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BusinessTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $role): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole($role);
        return $user;
    }

    private function data(string $name = 'کسب و کار'): array
    {
        return [
            'name' => $name,
            'category' => 'خدمات',
            'services' => ['مشاوره'],
            'description' => 'شرح کسب و کار',
            'phone' => '09123456789',
            'email' => 'owner@example.test',
            'address' => 'خیابان اصلی',
            'city' => 'تهران',
            'neighborhood' => 'مرکز',
            'latitude' => 35.7,
            'longitude' => 51.4,
            'social_links' => ['instagram' => 'https://instagram.com/example'],
        ];
    }

    public function test_business_owner_can_create_and_update_business(): void
    {
        $owner = $this->user('business_owner');
        $response = $this->actingAs($owner)->postJson('/api/businesses', $this->data());

        $response->assertCreated()->assertJsonPath('status', 'pending');
        $business = Business::firstOrFail();
        $this->assertSame($owner->id, $business->user_id);

        $this->actingAs($owner)
            ->putJson('/api/businesses/'.$business->id, $this->data('نام به‌روزشده'))
            ->assertOk()
            ->assertJsonPath('name', 'نام به‌روزشده');
    }

    public function test_user_and_designer_cannot_create_or_access_business_panel(): void
    {
        foreach (['user', 'designer'] as $role) {
            $this->actingAs($this->user($role))->getJson('/api/businesses')->assertForbidden();
            $this->actingAs($this->user($role))->postJson('/api/businesses', $this->data())->assertForbidden();
        }
    }

    public function test_idor_is_blocked_for_another_owner_and_admin_can_access(): void
    {
        $owner = $this->user('business_owner');
        $otherOwner = $this->user('business_owner');
        $business = $owner->businesses()->create($this->data() + ['slug' => 'owned-slug', 'status' => 'pending']);

        $this->actingAs($otherOwner)->putJson('/api/businesses/'.$business->id, $this->data('نفوذ'))->assertForbidden();
        $this->actingAs($otherOwner)->deleteJson('/api/businesses/'.$business->id)->assertForbidden();
        $this->actingAs($this->user('admin'))->getJson('/api/businesses/'.$business->id)->assertOk();
    }

    public function test_business_status_lifecycle_and_admin_moderation(): void
    {
        $owner = $this->user('business_owner');
        $admin = $this->user('admin');
        $business = $owner->businesses()->create($this->data() + ['slug' => 'lifecycle', 'status' => 'draft']);
        $this->assertSame('draft', $business->status);

        $this->actingAs($owner)->putJson('/api/businesses/'.$business->id, $this->data())->assertOk();
        $this->assertSame('pending', $business->fresh()->status);

        foreach (['approved', 'rejected', 'suspended'] as $status) {
            $this->actingAs($admin)->patchJson('/api/admin/businesses/'.$business->id.'/moderate', ['status' => $status])->assertOk();
            $this->assertSame($status, $business->fresh()->status);
        }
    }

    public function test_only_admin_can_approve_reject_or_suspend(): void
    {
        $business = $this->user('business_owner')->businesses()->create($this->data() + ['slug' => 'moderation', 'status' => 'pending']);
        $this->actingAs($this->user('business_owner'))->patchJson('/api/admin/businesses/'.$business->id.'/moderate', ['status' => 'approved'])->assertForbidden();
        $this->actingAs($this->user('designer'))->patchJson('/api/admin/businesses/'.$business->id.'/moderate', ['status' => 'rejected'])->assertForbidden();
        $this->actingAs($this->user('admin'))->patchJson('/api/admin/businesses/'.$business->id.'/moderate', ['status' => 'suspended'])->assertOk();
    }

    public function test_public_api_exposes_only_approved_business_and_no_private_fields(): void
    {
        $owner = $this->user('business_owner');
        $business = $owner->businesses()->create($this->data() + ['slug' => 'public-business', 'status' => 'approved', 'moderation_note' => 'private note']);

        $this->getJson('/api/public/businesses/public-business')
            ->assertOk()
            ->assertJsonPath('slug', 'public-business')
            ->assertJsonMissingPath('owner')
            ->assertJsonMissingPath('moderation_note')
            ->assertJsonMissingPath('user_id');

        foreach (['draft', 'pending', 'rejected', 'suspended'] as $status) {
            $business->update(['status' => $status]);
            $this->getJson('/api/public/businesses/public-business')->assertNotFound();
        }
    }

    public function test_validation_rejects_invalid_coordinates_email_urls_and_xss_payload_is_not_stored_as_html(): void
    {
        $owner = $this->user('business_owner');
        $response = $this->actingAs($owner)->postJson('/api/businesses', [
            'name' => '<script>alert(1)</script>',
            'email' => 'not-an-email',
            'latitude' => 91,
            'longitude' => -181,
            'social_links' => ['instagram' => 'javascript:alert(1)'],
        ]);
        $response->assertUnprocessable()->assertJsonValidationErrors(['email', 'latitude', 'longitude', 'social_links.instagram']);

        $created = $this->actingAs($owner)->postJson('/api/businesses', $this->data('<script>alert(1)</script>'))->assertCreated();
        $this->assertSame('<script>alert(1)</script>', $created->json('name'));
        $this->getJson('/api/public/businesses/'.$created->json('slug'))->assertNotFound();
    }

    public function test_mass_assignment_does_not_allow_owner_status_or_slug_override(): void
    {
        $owner = $this->user('business_owner');
        $response = $this->actingAs($owner)->postJson('/api/businesses', $this->data() + [
            'user_id' => 999999,
            'status' => 'approved',
            'slug' => 'attacker-slug',
            'moderation_note' => 'forged',
        ])->assertCreated();
        $business = Business::findOrFail($response->json('id'));
        $this->assertSame($owner->id, $business->user_id);
        $this->assertSame('pending', $business->status);
        $this->assertNotSame('attacker-slug', $business->slug);
        $this->assertNull($business->moderation_note);
    }

    public function test_sql_injection_input_is_treated_as_data(): void
    {
        $owner = $this->user('business_owner');
        $payload = $this->data("' OR 1=1 --");
        $response = $this->actingAs($owner)->postJson('/api/businesses', $payload)->assertCreated();
        $this->assertSame("' OR 1=1 --", $response->json('name'));
        $this->assertDatabaseCount('businesses', 1);
    }

    public function test_slug_is_unique_for_multiple_businesses(): void
    {
        $owner = $this->user('business_owner');
        $first = $this->actingAs($owner)->postJson('/api/businesses', $this->data('یک نام'))->assertCreated()->json('slug');
        $second = $this->actingAs($owner)->postJson('/api/businesses', $this->data('یک نام'))->assertCreated()->json('slug');
        $this->assertNotSame($first, $second);
    }

    public function test_qr_endpoint_returns_real_png_for_canonical_public_url_only(): void
    {
        $business = $this->user('business_owner')->businesses()->create($this->data() + ['slug' => 'qr-business', 'status' => 'approved']);
        $response = $this->get('/api/public/businesses/qr-business/qr')->assertOk()->assertHeader('Content-Type', 'image/svg+xml');
        $bytes = $response->getContent();
        $this->assertStringContainsString("<svg", $bytes);
        $this->assertStringNotContainsString('Bearer', $bytes);
        $this->assertNotNull($business->slug);
    }
}
