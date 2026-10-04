<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The Card STUDIO gate (approved plan, amendments 1/2/3/5/8):
 *
 *   - Level B (design_json MUTATION, print-file replacement on a layered
 *     card) requires: users.designer_status = approved AND the business'
 *     own plan granting `designer_studio`.
 *   - Level A (scalars, template/theme/font/export, images, a first print
 *     file) is NEVER locked.
 *   - Grandfathering compares the CANONICAL document: key-order / numeric
 *     notation differences are not mutations; any semantic change is.
 *   - Admin bypass is explicit, capability-scoped and AUDITED.
 *   - Rollout: the gate is dormant until `studio_designer_only` = '1'.
 */
class StudioAccessGateTest extends TestCase
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

    private function business(User $owner, array $features, string $prefix = 'studio'): Business
    {
        $business = $owner->businesses()->create([
            'name' => 'کسب‌وکار استودیو',
            'slug' => $prefix.'-'.fake()->unique()->regexify('[a-z0-9]{8}'),
            'category' => 'آز',
            'phone' => '09120000000',
            'status' => 'approved',
        ]);

        $plan = Plan::create([
            'name' => 'Studio Plan',
            'price' => 100,
            'duration_days' => 30,
            'features' => $features,
        ]);

        $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'active',
            'start_date' => now(),
            'end_date' => now()->addDays(30),
        ]);

        return $business;
    }

    /** A well-formed document (one text layer). */
    private function design(string $text = 'سلام', int $x = 40): array
    {
        return [
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => '#f6f8fb',
            'layers' => [
                [
                    'id' => 't1', 'kind' => 'text',
                    'x' => $x, 'y' => 40, 'width' => 400, 'height' => 60,
                    'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                    'z' => 0, 'color' => '#0b1c33', 'background' => null,
                    'text' => $text, 'fontSize' => 40, 'fontWeight' => 700,
                    'align' => 'start', 'fontFamily' => 'vazir',
                ],
            ],
        ];
    }

    private function enforce(bool $on = true): void
    {
        SiteSetting::updateOrCreate(
            ['key' => 'studio_designer_only'],
            ['value' => $on ? '1' : '0'],
        );
    }

    private function saveCard(User $user, Business $business, array $payload)
    {
        return $this->actingAs($user)->putJson(
            "/api/businesses/{$business->id}/card",
            $payload + ['template' => 'classic'],
        );
    }

    // ------------------------------------------------------------------
    // Rollout switch
    // ------------------------------------------------------------------

    public function test_gate_is_dormant_until_the_rollout_switch_is_on(): void
    {
        $owner = $this->user(['business_owner']); // NOT an approved designer
        $business = $this->business($owner, ['card_editor' => true]);

        // Switch absent → legacy behaviour: anyone with card_editor may save.
        $this->assertFalse(\App\Services\StudioAccess::enforced());
        $this->saveCard($owner, $business, ['design_json' => $this->design()])->assertOk();

        // Flip the switch → a MUTATION is now blocked for a non-designer.
        $this->enforce();
        $this->saveCard($owner->fresh(), $business, ['design_json' => $this->design('متن دیگر')])
            ->assertStatus(403)
            ->assertJsonPath('studio_errors.studio', 'not_approved');
    }

    // ------------------------------------------------------------------
    // Level B: the AND of designer approval + per-business capability
    // ------------------------------------------------------------------

    public function test_approved_designer_with_capability_can_mutate_the_document(): void
    {
        $designer = $this->user(['business_owner', 'designer'], 'approved');
        $business = $this->business($designer, ['card_editor' => true, 'designer_studio' => true]);
        $this->enforce();

        $this->saveCard($designer, $business, ['design_json' => $this->design()])
            ->assertOk()
            ->assertJsonPath('studio.allowed', true)
            ->assertJsonPath('studio.reason', 'designer');

        $this->assertNotNull(DB::table('business_cards')->where('business_id', $business->id)->value('design_json'));
    }

    public function test_approved_designer_without_the_capability_is_blocked(): void
    {
        $designer = $this->user(['business_owner', 'designer'], 'approved');
        $business = $this->business($designer, ['card_editor' => true]); // no designer_studio
        $this->enforce();

        $this->saveCard($designer, $business, ['design_json' => $this->design()])
            ->assertStatus(403)
            ->assertJsonPath('studio_errors.studio', 'no_capability');
    }

    public function test_capability_without_designer_approval_is_blocked(): void
    {
        $owner = $this->user(['business_owner']); // designer_status = none
        $business = $this->business($owner, ['card_editor' => true, 'designer_studio' => true]);
        $this->enforce();

        $this->saveCard($owner, $business, ['design_json' => $this->design()])
            ->assertStatus(403)
            ->assertJsonPath('studio_errors.studio', 'not_approved');
    }

    public function test_the_capability_is_never_inherited_across_businesses(): void
    {
        $designer = $this->user(['business_owner', 'designer'], 'approved');
        $studioBusiness = $this->business($designer, ['card_editor' => true, 'designer_studio' => true], 'studio-yes');
        $plainBusiness = $this->business($designer, ['card_editor' => true], 'studio-no');
        $this->enforce();

        // The business whose plan grants the capability: open.
        $this->saveCard($designer, $studioBusiness, ['design_json' => $this->design()])->assertOk();

        // The other business: 403 — the second business' card does NOT inherit
        // the designer's studio access.
        $this->saveCard($designer, $plainBusiness, ['design_json' => $this->design()])
            ->assertStatus(403)
            ->assertJsonPath('studio_errors.studio', 'no_capability');
    }

    // ------------------------------------------------------------------
    // Canonical grandfathering (amendment 3)
    // ------------------------------------------------------------------

    public function test_grandfathering_ignores_key_order_and_numeric_notation(): void
    {
        $owner = $this->user(['business_owner']); // never approved
        $business = $this->business($owner, ['card_editor' => true]);

        // Save the baseline while the gate is dormant.
        $this->saveCard($owner, $business, ['design_json' => $this->design()])->assertOk();
        $this->enforce();

        // Reordered keys + float notation + only-touched-everything-else:
        // canonicalization makes this the SAME document → allowed.
        $reordered = [
            'layers' => [[
                'text' => 'سلام', 'fontFamily' => 'vazir', 'align' => 'start',
                'fontWeight' => 700.0, 'fontSize' => 40.0,
                'background' => null, 'color' => '#0b1c33',
                'z' => 0.0, 'hidden' => false, 'locked' => false,
                'opacity' => 1.0, 'angle' => 0.0,
                'height' => 60.0, 'width' => 400.0, 'y' => 40.0, 'x' => 40.0,
                'kind' => 'text', 'id' => 't1',
            ]],
            'background' => '#f6f8fb',
            'artboard' => ['height' => 600, 'width' => 1050],
            'version' => 1,
        ];

        $this->saveCard($owner->fresh(), $business, ['design_json' => $reordered])->assertOk();

        // A SEMANTIC change is a mutation → 403 for the same user.
        $this->saveCard($owner->fresh(), $business, ['design_json' => $this->design('متن تغییر کرد')])
            ->assertStatus(403);
    }

    // ------------------------------------------------------------------
    // Admin bypass (amendment 5)
    // ------------------------------------------------------------------

    public function test_admin_bypass_is_capability_scoped_and_audited(): void
    {
        $owner = $this->user(['business_owner']);
        $business = $this->business($owner, ['card_editor' => true]);
        $admin = $this->user(['admin']);
        $this->enforce();

        $this->actingAs($admin)
            ->putJson("/api/businesses/{$business->id}/card", [
                'template' => 'classic',
                'design_json' => $this->design('مدیر'),
            ])
            ->assertOk()
            ->assertJsonPath('studio.bypass', true)
            ->assertJsonPath('studio.reason', 'admin_bypass');

        $row = DB::table('audit_events')->where('event', 'admin.studio_bypass')->first();
        $this->assertNotNull($row);
        $this->assertSame($admin->id, (int) $row->actor_id);
        $this->assertSame('business', $row->subject_type);
        $this->assertSame($business->id, (int) $row->subject_id);

        $metadata = json_decode($row->metadata, true);
        $this->assertSame('design_json.save', $metadata['action']);
        $this->assertSame('designer_studio', $metadata['capability']);
        $this->assertTrue($metadata['enforced']);
    }

    public function test_admin_bypass_does_not_bypass_the_template_validator(): void
    {
        $owner = $this->user(['business_owner']);
        $business = $this->business($owner, ['card_editor' => true]);
        $admin = $this->user(['admin']);
        $this->enforce();

        // Structurally invalid document: the bypass never touches validation.
        $this->actingAs($admin)
            ->putJson("/api/businesses/{$business->id}/card", [
                'template' => 'classic',
                'design_json' => ['version' => 99, 'layers' => 'garbage'],
            ])
            ->assertStatus(422);
    }

    // ------------------------------------------------------------------
    // Level A is never locked
    // ------------------------------------------------------------------

    public function test_level_a_writes_stay_open_to_non_designers(): void
    {
        Storage::fake('card_files');
        Storage::fake('public');

        $owner = $this->user(['business_owner']);
        $business = $this->business($owner, [
            'card_editor' => true,
            'card_templates' => ['classic', 'local'],
            'card_themes' => ['navy', 'emerald'],
            'card_fonts' => ['vazir', 'sans'],
            'card_exports' => ['png'],
            'print_file' => true,
        ]);
        $this->enforce();

        // Scalars + theme/font/export + images + a FIRST print file (no
        // layered card exists yet) — all Level A.
        $this->actingAs($owner)
            ->putJson("/api/businesses/{$business->id}/card", [
                'template' => 'local',
                'theme' => 'emerald',
                'font_family' => 'sans',
                'font_size' => 'large',
                'export_format' => 'png',
                'front_image' => UploadedFile::fake()->image('front.png', 600, 400),
                'print_file' => UploadedFile::fake()->create('print.pdf', 50, 'application/pdf'),
            ])
            ->assertOk();

        // Reads stay open too.
        $this->actingAs($owner)
            ->getJson("/api/businesses/{$business->id}/card")
            ->assertOk()
            ->assertJsonPath('studio.enforced', true)
            ->assertJsonPath('studio.allowed', false)
            ->assertJsonPath('studio.designer_status', 'none');
    }

    public function test_print_file_replacement_on_a_layered_card_is_level_b(): void
    {
        Storage::fake('card_files');

        $owner = $this->user(['business_owner']);
        $business = $this->business($owner, [
            'card_editor' => true,
            'print_file' => true,
            'designer_studio' => true,
        ]);

        // Create the layered card while the gate is dormant.
        $this->saveCard($owner, $business, ['design_json' => $this->design()])->assertOk();
        $this->enforce();

        // Non-designer: replacing the print file of a LAYERED card → 403.
        $this->actingAs($owner)
            ->putJson("/api/businesses/{$business->id}/card", [
                'template' => 'classic',
                'print_file' => UploadedFile::fake()->create('print.pdf', 50, 'application/pdf'),
            ])
            ->assertStatus(403);

        // Approved designer + capability → allowed.
        $owner->forceFill(['designer_status' => 'approved'])->save();
        $this->actingAs($owner->fresh())
            ->putJson("/api/businesses/{$business->id}/card", [
                'template' => 'classic',
                'print_file' => UploadedFile::fake()->create('print2.pdf', 50, 'application/pdf'),
            ])
            ->assertOk();
    }

    public function test_studio_block_reflects_a_designers_access(): void
    {
        $designer = $this->user(['business_owner', 'designer'], 'approved');
        $business = $this->business($designer, ['card_editor' => true, 'designer_studio' => true]);
        $this->enforce();

        $this->actingAs($designer)
            ->getJson("/api/businesses/{$business->id}/card")
            ->assertOk()
            ->assertJsonPath('studio.enforced', true)
            ->assertJsonPath('studio.allowed', true)
            ->assertJsonPath('studio.capability', true)
            ->assertJsonPath('studio.reason', 'designer');

        $this->actingAs($designer)
            ->getJson("/api/businesses/{$business->id}/entitlements")
            ->assertOk()
            ->assertJsonPath('studio.allowed', true);
    }
}
