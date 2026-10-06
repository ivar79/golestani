<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * Security / compatibility regression matrix for the studio gate (P1 of the
 * corrective plan). Covers the states the earlier suite left implicit:
 *
 *   - a FROZEN snapshot without `designer_studio` denies access even when the
 *     plan has since been given the key (no silent grant);
 *   - expired and scheduled subscriptions resolve to the free tier;
 *   - rejected/suspended designers are denied, and revoking an approval cuts
 *     access on the next request + removes the designer role;
 *   - the legacy preview apply returns a document but the gated save still
 *     refuses to persist it for a non-designer;
 *   - the designer program request can only ever reach `pending`.
 */
class StudioSecurityRegressionTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $roles, ?string $designerStatus = null): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        foreach ($roles as $role) {
            $user->assignRole($role);
        }
        if ($designerStatus !== null) {
            $user->forceFill(['designer_status' => $designerStatus])->save();
        }

        return $user->fresh();
    }

    private function business(
        User $owner,
        array $features,
        ?array $snapshot = null,
        string $status = 'active',
        ?Carbon $expiresAt = null,
    ): Business {
        $business = $owner->businesses()->create([
            'name' => 'کسب‌وکار امنیت', 'slug' => 'sec-'.fake()->unique()->regexify('[a-z0-9]{8}'),
            'category' => 'آز', 'phone' => '09120000000', 'status' => 'approved',
        ]);

        $plan = Plan::create(['name' => 'Sec Plan', 'price' => 100, 'duration_days' => 30, 'features' => $features]);

        $subscription = $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => $status,
            'start_date' => now(),
            'end_date' => now()->addDays(30),
        ]);
        if ($expiresAt !== null) {
            $subscription->forceFill(['expires_at' => $expiresAt])->save();
        }
        if ($snapshot !== null) {
            $subscription->forceFill(['entitlements' => $snapshot])->save();
        }

        return $business;
    }

    private function design(string $text = 'سلام'): array
    {
        return [
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => '#f6f8fb',
            'layers' => [[
                'id' => 't1', 'kind' => 'text',
                'x' => 40, 'y' => 40, 'width' => 400, 'height' => 60,
                'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                'z' => 0, 'color' => '#0b1c33', 'background' => null,
                'text' => $text, 'fontSize' => 40, 'fontWeight' => 700,
                'align' => 'start', 'fontFamily' => 'vazir',
            ]],
        ];
    }

    private function enforce(): void
    {
        SiteSetting::updateOrCreate(['key' => 'studio_designer_only'], ['value' => '1']);
    }

    public function test_frozen_snapshot_without_capability_is_denied_even_when_plan_has_it(): void
    {
        $designer = $this->user(['business_owner', 'designer'], 'approved');
        // Plan now grants designer_studio, but the FROZEN snapshot predates it.
        $business = $this->business(
            $designer,
            ['card_editor' => true, 'designer_studio' => true],
            ['card_editor' => true],
        );
        $this->enforce();

        $this->actingAs($designer)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $this->design(),
        ])->assertStatus(403)->assertJsonPath('studio_errors.studio', 'no_capability');
    }

    public function test_expired_subscription_cannot_use_the_studio(): void
    {
        $designer = $this->user(['business_owner', 'designer'], 'approved');
        $business = $this->business(
            $designer,
            ['card_editor' => true, 'designer_studio' => true],
            ['card_editor' => true, 'designer_studio' => true],
            'active',
            Carbon::now()->subDay(),
        );
        $this->enforce();

        $this->actingAs($designer)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $this->design(),
        ])->assertStatus(403)->assertJsonPath('studio_errors.studio', 'no_capability');
    }

    public function test_scheduled_subscription_cannot_use_the_studio(): void
    {
        $designer = $this->user(['business_owner', 'designer'], 'approved');
        $business = $this->business(
            $designer,
            ['card_editor' => true, 'designer_studio' => true],
            ['card_editor' => true, 'designer_studio' => true],
            'scheduled',
        );
        // Push the scheduled start into the future so lazy promotion never fires.
        $business->subscriptions()->latest('id')->first()->forceFill(['started_at' => Carbon::now()->addDay()])->save();
        $this->enforce();

        $this->actingAs($designer)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $this->design(),
        ])->assertStatus(403)->assertJsonPath('studio_errors.studio', 'no_capability');
    }

    public function test_rejected_and_suspended_designers_are_denied(): void
    {
        $this->enforce();

        foreach (['pending', 'rejected', 'suspended'] as $status) {
            $designer = $this->user(['business_owner'], $status);
            $business = $this->business($designer, ['card_editor' => true, 'designer_studio' => true]);

            $this->actingAs($designer)->putJson("/api/businesses/{$business->id}/card", [
                'template' => 'classic',
                'design_json' => $this->design(),
            ])->assertStatus(403)->assertJsonPath('studio_errors.studio', 'not_approved');
        }
    }

    public function test_revoking_approval_cuts_access_and_removes_the_role(): void
    {
        $admin = $this->user(['admin']);
        $designer = $this->user(['business_owner', 'designer'], 'approved');
        $business = $this->business($designer, ['card_editor' => true, 'designer_studio' => true]);
        $this->enforce();

        // Sanity: access works before revocation.
        $this->actingAs($designer)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $this->design(),
        ])->assertOk();

        $this->actingAs($admin)->patchJson("/api/admin/users/{$designer->id}/designer-status", [
            'designer_status' => 'rejected',
            'reason' => 'تخلف',
        ])->assertOk();

        $this->assertFalse($designer->fresh()->hasRole('designer'));

        $this->actingAs($designer->fresh())->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $this->design('متن جدید'),
        ])->assertStatus(403)->assertJsonPath('studio_errors.studio', 'not_approved');
    }

    public function test_legacy_preview_apply_then_gated_save_is_blocked(): void
    {
        $owner = $this->user(['business_owner']); // NOT a designer
        $business = $this->business($owner, [
            'card_editor' => true,
            'card_templates' => ['free-classic-navy'],
        ]);
        $this->enforce();

        // The LEGACY preview endpoint returns a document (no persist, no gate).
        $preview = $this->actingAs($owner)->postJson('/api/card-templates/builtin/free-classic-navy/apply', [
            'business_id' => $business->id,
        ])->assertOk();

        $this->assertSame(0, $business->cards()->count());

        // Persisting that document still goes through the gated save → 403.
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $preview->json('document'),
        ])->assertStatus(403);

        $this->assertSame(0, $business->cards()->count());
    }

    public function test_program_request_can_only_reach_pending(): void
    {
        SiteSetting::updateOrCreate(['key' => 'designer_program_enabled'], ['value' => '1']);
        $user = $this->user(['business_owner']);

        $this->actingAs($user)->postJson('/api/designer/program/request')
            ->assertOk()
            ->assertJsonPath('designer_status', 'pending');

        $this->assertSame('pending', $user->fresh()->designer_status);
        $this->assertNotSame('approved', $user->fresh()->designer_status);
    }
}
