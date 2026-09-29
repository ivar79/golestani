<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCard;
use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use App\Services\FeatureGate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Card editor entitlement enforcement — the backend is authoritative.
 *
 * Direct API bypass attempts (a free user hand-crafting premium requests)
 * must be rejected with 403 + machine-readable entitlement_errors. Saved
 * premium designs must survive expiry (grandfathering: same-value saves
 * stay legal, reads are verbatim, nothing is deleted or mutated).
 */
class CardEntitlementTest extends TestCase
{
    use RefreshDatabase;

    private const FULL_FEATURES = [
        'card_editor' => true,
        'card_templates' => ['classic', 'midnight', 'emerald', 'local', 'creative'],
        'card_themes' => ['navy', 'emerald', 'warm'],
        'card_fonts' => ['sans', 'vazir', 'serif'],
        'card_exports' => ['png', 'jpg'],
        'print_file' => true,
        'max_cards' => 5,
    ];

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $user, string $slug = 'card-ent'): Business
    {
        return $user->businesses()->create(['name' => 'Card Ent', 'slug' => $slug, 'status' => 'approved']);
    }

    /** Activate through the real admin flow → entitlement snapshot is written. */
    private function activate(Business $business, array $features = self::FULL_FEATURES): Subscription
    {
        $plan = Plan::create(['name' => 'Card Plan', 'slug' => 'card-plan-'.strtolower(bin2hex(random_bytes(3))), 'price' => 100, 'duration_days' => 30, 'features' => $features]);
        $subscription = $business->subscriptions()->create(['plan_id' => $plan->id, 'status' => 'pending_receipt']);
        $this->actingAs($this->adminUser())->patchJson("/api/admin/subscriptions/{$subscription->id}/moderate", ['status' => 'active'])->assertOk();

        return $subscription->refresh();
    }

    private function adminUser(): User
    {
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');

        return $admin;
    }

    /* ---------------------------------------------------------------
     | FREE user
     * --------------------------------------------------------------- */

    public function test_free_user_can_use_free_capabilities(): void
    {
        $business = $this->business($this->owner());

        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'local',
            'theme' => 'emerald',
            'font_family' => 'vazir',
        ])->assertOk()->assertJsonPath('template', 'local');
    }

    public function test_show_returns_entitlement_contract_and_locked_map(): void
    {
        $business = $this->business($this->owner());

        $response = $this->actingAs($business->owner)->getJson("/api/businesses/{$business->id}/card")->assertOk();

        $this->assertSame('Free', $response->json('entitlements.plan'));
        $this->assertSame('free', $response->json('entitlements.source'));
        $this->assertContains('midnight', $response->json('locked.template'));
        $this->assertContains('warm', $response->json('locked.theme'));
        $this->assertContains('jpg', $response->json('locked.export_format'));
        $this->assertTrue($response->json('locked.print_file'));
        $this->assertSame(1, $response->json('locked.max_cards'));
    }

    public function test_free_user_cannot_save_premium_template_direct_api_bypass(): void
    {
        $business = $this->business($this->owner());

        $response = $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'creative', // premium-only value
        ])->assertStatus(403);

        $this->assertSame('locked', $response->json('entitlement_errors.template'));
        $this->assertNotNull($response->json('entitlements.capabilities'));
        $this->assertDatabaseMissing('business_cards', ['business_id' => $business->id, 'template' => 'creative']);
    }

    public function test_free_user_cannot_export_jpg_bypass(): void
    {
        $business = $this->business($this->owner());

        $response = $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'export_format' => 'jpg',
        ])->assertStatus(403);

        $this->assertSame('locked', $response->json('entitlement_errors.export_format'));
    }

    public function test_free_user_cannot_upload_print_file(): void
    {
        Storage::fake('card_files');
        $business = $this->business($this->owner());

        $response = $this->actingAs($business->owner)->postJson("/api/businesses/{$business->id}/card", [
            '_method' => 'PUT',
            'template' => 'classic',
            'print_file' => UploadedFile::fake()->create('print.pdf', 100, 'application/pdf'),
        ])->assertStatus(403);

        $this->assertSame('locked', $response->json('entitlement_errors.print_file'));
        $this->assertSame(0, BusinessCard::where('business_id', $business->id)->whereNotNull('print_file_path')->count());
    }

    public function test_free_user_cannot_download_print_file(): void
    {
        $business = $this->business($this->owner());
        // Simulate a legacy row with a file (uploaded while subscription was active).
        Storage::fake('card_files');
        $card = $business->cards()->create(['template' => 'classic', 'print_file_path' => 'cards/print_files/x.pdf']);
        Storage::disk('card_files')->put('cards/print_files/x.pdf', '%PDF-1.4');

        $this->actingAs($business->owner)->get("/api/businesses/{$business->id}/card/print-file")->assertStatus(403);
    }

    public function test_max_cards_limit_blocks_second_card_for_free_user(): void
    {
        $business = $this->business($this->owner());

        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
        ])->assertOk();

        $response = $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'local',
        ])->assertStatus(403);

        $this->assertSame('limit_reached', $response->json('entitlement_errors.max_cards'));
        $this->assertSame(1, BusinessCard::where('business_id', $business->id)->count());
    }

    /* ---------------------------------------------------------------
     | PAID user
     * --------------------------------------------------------------- */

    public function test_paid_user_can_use_all_entitled_features(): void
    {
        $business = $this->business($this->owner());
        $this->activate($business);

        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'creative',
            'theme' => 'warm',
            'font_family' => 'serif',
        ])->assertOk()->assertJsonPath('template', 'creative');

        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'creative',
            'export_format' => 'jpg',
        ])->assertOk()->assertJsonPath('export_format', 'jpg');

        // Multiple cards within quota.
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
        ])->assertOk();

        $this->assertSame(2, BusinessCard::where('business_id', $business->id)->count());
    }

    public function test_paid_user_can_upload_and_download_print_file(): void
    {
        Storage::fake('card_files');
        $business = $this->business($this->owner());
        $this->activate($business);

        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'print_file' => UploadedFile::fake()->createWithContent('print.pdf', '%PDF-1.4'),
        ])->assertOk();

        $this->actingAs($business->owner)->get("/api/businesses/{$business->id}/card/print-file")->assertOk();
    }

    /* ---------------------------------------------------------------
     | EXPIRED subscription + grandfathering
     * --------------------------------------------------------------- */

    public function test_expired_user_cannot_switch_to_new_premium_template(): void
    {
        $business = $this->business($this->owner());
        $this->activate($business);
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", ['template' => 'creative'])->assertOk();

        // Expire.
        $business->subscriptions()->update(['status' => 'expired', 'end_date' => now()->subDay()]);

        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'midnight', // a DIFFERENT premium template
        ])->assertStatus(403);
    }

    public function test_expired_user_can_resave_existing_premium_design_unchanged(): void
    {
        $business = $this->business($this->owner());
        $this->activate($business);
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'creative', 'theme' => 'warm', 'font_family' => 'serif',
        ])->assertOk();

        $business->subscriptions()->update(['status' => 'expired', 'end_date' => now()->subDay()]);

        // GRANDFATHERING: identical values re-save fine — the design survives.
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'creative', 'theme' => 'warm', 'font_family' => 'serif', 'font_size' => 'large',
        ])->assertOk()->assertJsonPath('template', 'creative');

        // The stored design is intact and untouched.
        $this->assertDatabaseHas('business_cards', ['business_id' => $business->id, 'template' => 'creative', 'theme' => 'warm']);
    }

    public function test_expired_user_cannot_export_premium_design(): void
    {
        $business = $this->business($this->owner());
        $this->activate($business);
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", ['template' => 'creative', 'export_format' => 'jpg'])->assertOk();

        $business->subscriptions()->update(['status' => 'expired', 'end_date' => now()->subDay()]);

        // New export attempt (fresh submission) is blocked — POLICY
        // expired_card_access=readonly. TODO(business): confirm.
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'creative', 'export_format' => 'png',
        ])->assertStatus(403);
    }

    public function test_expired_user_print_file_download_is_locked(): void
    {
        Storage::fake('card_files');
        $business = $this->business($this->owner());
        $this->activate($business);
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'print_file' => UploadedFile::fake()->createWithContent('print.pdf', '%PDF-1.4'),
        ])->assertOk();

        $business->subscriptions()->update(['status' => 'expired', 'end_date' => now()->subDay()]);

        // POLICY expired_print_file_download=false: stored but locked.
        // TODO(business): confirm the file should NOT remain downloadable.
        $this->actingAs($business->owner)->get("/api/businesses/{$business->id}/card/print-file")->assertStatus(403);

        // Data is NOT destroyed.
        $this->assertDatabaseHas('business_cards', ['business_id' => $business->id]);
    }

    public function test_reupgrade_restores_full_access_without_data_loss(): void
    {
        $business = $this->business($this->owner());
        $this->activate($business);
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", ['template' => 'creative'])->assertOk();

        $business->subscriptions()->update(['status' => 'expired', 'end_date' => now()->subDay()]);
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", ['template' => 'midnight'])->assertStatus(403);

        // Re-purchase: new request → new activation → new snapshot.
        $this->activate($business);

        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", ['template' => 'midnight'])->assertOk();

        // Old design still exists, untouched, alongside the new one.
        $this->assertSame(2, BusinessCard::where('business_id', $business->id)->where('template', 'creative')->orWhere('template', 'midnight')->count());
    }

    /* ---------------------------------------------------------------
     | IDOR / cross-business isolation
     * --------------------------------------------------------------- */

    public function test_foreign_paid_user_cannot_use_another_business_card_endpoints(): void
    {
        $paidOwner = $this->owner();
        $paidBusiness = $this->business($paidOwner, 'paid-biz');
        $this->activate($paidBusiness);

        $victim = $this->owner();
        $victimBusiness = $this->business($victim, 'victim-biz');

        // The paid user cannot read/modify the victim's card...
        $this->actingAs($paidOwner)->getJson("/api/businesses/{$victimBusiness->id}/card")->assertForbidden();
        $this->actingAs($paidOwner)->putJson("/api/businesses/{$victimBusiness->id}/card", ['template' => 'creative'])->assertForbidden();
        $this->actingAs($paidOwner)->get("/api/businesses/{$victimBusiness->id}/card/print-file")->assertForbidden();

        // ...and the free victim cannot gain premium by being related to nothing.
        $this->actingAs($victim)->putJson("/api/businesses/{$victimBusiness->id}/card", ['template' => 'midnight'])->assertStatus(403);
    }

    /* ---------------------------------------------------------------
     | Document fonts are the SAME capability as the template font
     * --------------------------------------------------------------- */

    /** A minimally valid single-text-layer document using one font family. */
    private function designUsingFont(string $font): array
    {
        return [
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => '#f6f8fb',
            'layers' => [[
                'id' => 'layer-1', 'kind' => 'text',
                'x' => 48, 'y' => 40, 'width' => 500, 'height' => 60,
                'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                'z' => 0, 'color' => '#0b1c33', 'background' => null,
                'text' => 'متن',
                'fontSize' => 40, 'fontWeight' => 800, 'align' => 'start',
                'fontFamily' => $font,
            ]],
        ];
    }

    public function test_locked_document_font_is_rejected_server_side(): void
    {
        Storage::fake('card_files');
        $business = $this->business($this->owner(), 'card-font-free');

        // Free tier grants card_fonts = ['sans','vazir'] — the LAYERED document
        // must respect the same capability as the template font, so flipping
        // client state cannot unlock a premium family.
        $response = $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $this->designUsingFont('serif'),
        ])->assertStatus(403);

        $this->assertSame('locked', $response->json('entitlement_errors.design_fonts'));

        // An entitled family saves normally.
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $this->designUsingFont('vazir'),
        ])->assertOk();
    }

    public function test_stored_document_font_is_grandfathered_for_resave(): void
    {
        Storage::fake('card_files');
        $business = $this->business($this->owner(), 'card-font-grandfather');

        // A document written while the family WAS entitled (e.g. a lapsed plan).
        $card = $business->cards()->create(['template' => 'classic', 'theme' => 'navy', 'font_size' => 'medium']);
        $card->forceFill(['design_json' => $this->designUsingFont('serif')])->save();

        // Re-saving it verbatim is always allowed — grandfathering never locks
        // an owner out of their own existing design.
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $this->designUsingFont('serif'),
        ])->assertOk();
    }

    public function test_expired_user_cannot_export_a_design_whose_properties_are_locked(): void
    {
        Storage::fake('card_files');
        $business = $this->business($this->owner(), 'card-premium-export');
        $this->activate($business); // grants card_fonts incl. serif

        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $this->designUsingFont('serif'),
        ])->assertOk();

        $business->subscriptions()->update(['status' => 'expired', 'end_date' => now()->subDay()]);

        // POLICY expired_card_access=readonly must consider the LAYERED document
        // too: the design only exists because a premium font was entitled, so
        // exporting it after expiry has to be refused (this was the bug — only
        // the legacy scalar fields were inspected).
        $response = $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic', 'export_format' => 'png',
        ])->assertStatus(403);

        $this->assertSame('locked', $response->json('entitlement_errors.export_design'));
    }

    public function test_expired_user_can_still_export_a_design_with_only_entitled_properties(): void
    {
        Storage::fake('card_files');
        $business = $this->business($this->owner(), 'card-plain-export');
        $this->activate($business);

        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $this->designUsingFont('vazir'),
        ])->assertOk();

        $business->subscriptions()->update(['status' => 'expired', 'end_date' => now()->subDay()]);

        // Nothing in this design ever required the lapsed plan, so the readonly
        // export policy must not lock the owner out of their own card.
        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic', 'export_format' => 'png',
        ])->assertOk();
    }

    /* ---------------------------------------------------------------
     | Plan edit does not leak into active snapshot (UI parity with backend)
     * --------------------------------------------------------------- */

    public function test_show_entitlements_come_from_snapshot_not_live_plan(): void
    {
        $business = $this->business($this->owner());
        $subscription = $this->activate($business, ['card_editor' => true, 'card_templates' => ['classic', 'local', 'midnight'], 'max_cards' => 3]);

        // Admin tightens the plan AFTER activation.
        $admin = $this->adminUser();
        $this->actingAs($admin)->putJson("/api/admin/plans/{$subscription->plan_id}", [
            'features' => ['card_editor' => true, 'card_templates' => ['classic'], 'max_cards' => 1],
        ])->assertOk();

        // The active subscriber still sees midnight allowed (snapshot).
        $response = $this->actingAs($business->owner)->getJson("/api/businesses/{$business->id}/card")->assertOk();
        $this->assertSame('snapshot', $response->json('entitlements.source'));
        $this->assertNotContains('midnight', (array) $response->json('locked.template'));

        $this->actingAs($business->owner)->putJson("/api/businesses/{$business->id}/card", ['template' => 'midnight'])->assertOk();
    }
}
