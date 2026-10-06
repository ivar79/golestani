<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\BusinessCard;
use App\Models\Designer;
use App\Models\Plan;
use App\Models\Portfolio;
use App\Models\Subscription;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Phase 4 — Digital Business Card, private print-file security and designer flows.
 *
 * NOTE (entitlement contract): the print file is a PAID capability. Tests
 * that exercise print-file upload/download attach an active subscription
 * whose plan grants `print_file` — mirroring the real product requirement.
 */
class PhaseFourCardTest extends TestCase
{
    use RefreshDatabase;

    /** Attach an active subscription granting the full card capability set. */
    private function attachPaidPlan(Business $business, array $features = []): void
    {
        $plan = Plan::create([
            'name' => 'Card Pro',
            'price' => 100,
            'duration_days' => 30,
            'features' => $features ?: [
                'card_editor' => true,
                'card_templates' => ['classic', 'midnight', 'emerald', 'local', 'creative'],
                'card_themes' => ['navy', 'emerald', 'warm'],
                'card_fonts' => ['sans', 'vazir', 'serif'],
                'card_exports' => ['png', 'jpg'],
                'print_file' => true,
                'max_cards' => 10,
                'showcase' => false,
                'ads' => false,
            ],
        ]);
        $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'active',
            'start_date' => now(),
            'end_date' => now()->addDays(30),
        ]);
    }

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function admin(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('admin');

        return $user;
    }

    private function business(User $user, string $slug = 'demo-card'): Business
    {
        return $user->businesses()->create(['name' => 'Demo Card', 'slug' => $slug, 'status' => 'approved']);
    }

    /* ------------------------------------------------------------------
     | Card settings: save / show / authorization / validation
     ------------------------------------------------------------------ */

    public function test_owner_can_save_and_read_card_settings(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        // All five templates/themes/fonts are a paid capability set.
        $this->attachPaidPlan($business);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'midnight',
            'theme' => 'warm',
            'font_size' => 'large',
            'font_family' => 'serif',
        ])->assertOk()->assertJsonPath('template', 'midnight');

        $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")
            ->assertOk()
            ->assertJsonPath('template', 'midnight')
            ->assertJsonPath('theme', 'warm');
    }

    public function test_non_owner_cannot_modify_or_read_card(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $other = $this->owner();

        $this->actingAs($other)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'creative',
        ])->assertForbidden();

        $this->actingAs($other)->getJson("/api/businesses/{$business->id}/card")->assertForbidden();
    }

    public function test_admin_can_modify_card_of_any_business(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        $admin = $this->admin();

        $this->actingAs($admin)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'local',
        ])->assertOk()->assertJsonPath('template', 'local');
    }

    public function test_template_and_typography_validation_rejects_unknown_values(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'gold-luxury',
        ])->assertStatus(422);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'font_size' => 'huge',
        ])->assertStatus(422);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'font_family' => 'comic-sans',
        ])->assertStatus(422);
    }

    /* ------------------------------------------------------------------
     | Print file: private storage, replace, delete, authorized download
     ------------------------------------------------------------------ */

    public function test_print_file_is_stored_on_private_disk_and_hidden_from_public(): void
    {
        Storage::fake('card_files');
        Storage::fake('public');

        $owner = $this->owner();
        $business = $this->business($owner);
        $this->attachPaidPlan($business);

        $response = $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'print_file' => UploadedFile::fake()->create('print.pdf', 200, 'application/pdf'),
        ])->assertOk();

        $this->assertNotNull($response->json('print_file_path'));
        Storage::disk('card_files')->assertExists($response->json('print_file_path'));

        // PRIVATE: never on the public disk, never a public URL.
        Storage::disk('public')->assertMissing($response->json('print_file_path'));
        $this->assertNull($response->json('print_file_url'));
        $this->assertTrue($response->json('has_print_file'));
        $this->assertSame('print.pdf', $response->json('print_file_name'));
    }

    public function test_replacing_print_file_deletes_the_previous_private_file(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner);
        $this->attachPaidPlan($business);

        $first = $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'print_file' => UploadedFile::fake()->create('first.pdf', 100, 'application/pdf'),
        ])->assertOk()->json('print_file_path');

        $second = $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'print_file' => UploadedFile::fake()->create('second.pdf', 100, 'application/pdf'),
        ])->assertOk()->json('print_file_path');

        $this->assertNotSame($first, $second);
        Storage::disk('card_files')->assertMissing($first);
        Storage::disk('card_files')->assertExists($second);
    }

    public function test_delete_print_file_clears_file_and_fields(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner);
        $this->attachPaidPlan($business);

        $path = $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'print_file' => UploadedFile::fake()->create('bye.pdf', 100, 'application/pdf'),
        ])->assertOk()->json('print_file_path');

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'delete_print_file' => true,
        ])->assertOk();

        Storage::disk('card_files')->assertMissing($path);

        $card = BusinessCard::where('business_id', $business->id)->first();
        $this->assertNull($card->print_file_path);
        $this->assertNull($card->print_file_name);
        $this->assertNull($card->print_file_mime);
    }

    public function test_owner_and_admin_can_download_print_file_but_others_cannot(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner);
        $this->attachPaidPlan($business);
        $admin = $this->admin();
        $other = $this->owner();

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'print_file' => UploadedFile::fake()->createWithContent('authorized.pdf', '%PDF-1.4 test'),
        ])->assertOk();

        $this->actingAs($owner)
            ->get("/api/businesses/{$business->id}/card/print-file")
            ->assertOk()
            ->assertDownload('authorized.pdf');

        $this->actingAs($admin)
            ->get("/api/businesses/{$business->id}/card/print-file")
            ->assertOk();

        $this->actingAs($other)
            ->get("/api/businesses/{$business->id}/card/print-file")
            ->assertForbidden();

        // Guest: the role middleware denies all card routes for unauthenticated
        // users with 403 (consistent with the whole card route group).
        $this->getJson("/api/businesses/{$business->id}/card/print-file")->assertForbidden();
    }

    public function test_download_returns_404_when_no_print_file_exists(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner);
        // Entitled business, but no file stored: 404 (not 403).
        $this->attachPaidPlan($business);

        $this->actingAs($owner)
            ->get("/api/businesses/{$business->id}/card/print-file")
            ->assertNotFound();
    }

    public function test_invalid_print_file_type_is_rejected(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'print_file' => UploadedFile::fake()->create('evil.exe', 100, 'application/octet-stream'),
        ])->assertStatus(422);
    }

    public function test_oversized_print_file_is_rejected(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'print_file' => UploadedFile::fake()->create('big.pdf', 10241, 'application/pdf'), // > 10MB
        ])->assertStatus(422);
    }

    /* ------------------------------------------------------------------
     | Designer: profile, referral code, attribution, moderation
     ------------------------------------------------------------------ */

    /**
     * SECURITY REGRESSION (V1): the designer profile endpoint used to
     * self-assign the designer role to any OTP user with one GET request.
     * It is now designer-only and never grants the role.
     */
    public function test_plain_user_cannot_self_promote_via_designer_profile(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('user');

        $this->actingAs($user)->getJson('/api/designer/profile')->assertForbidden();
        $this->assertFalse($user->fresh()->hasRole('designer'));
    }

    public function test_designer_role_without_approved_status_cannot_use_designer_profile(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');

        $this->actingAs($user)->getJson('/api/designer/profile')->assertForbidden();
        $this->assertDatabaseMissing('designers', ['user_id' => $user->id]);
    }

    public function test_designer_role_without_approved_status_cannot_mutate_portfolios(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');
        $designer = Designer::create([
            'user_id' => $user->id,
            'display_name' => 'طراح در انتظار',
            'slug' => 'designer-pending-portfolio',
            'referral_code' => 'DES-PEND01',
            'status' => 'approved',
        ]);
        $portfolio = $designer->portfolios()->create([
            'title' => 'نمونه',
            'file_path' => 'portfolios/pending.pdf',
            'mime_type' => 'application/pdf',
            'file_size' => 100,
            'status' => 'pending',
        ]);

        $this->actingAs($user)
            ->deleteJson("/api/designer/portfolios/{$portfolio->id}")
            ->assertForbidden();
        $this->assertDatabaseHas('portfolios', ['id' => $portfolio->id]);
    }

    public function test_designer_gets_profile_with_referral_code(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');
        $user->forceFill(['designer_status' => 'approved'])->save();

        $response = $this->actingAs($user)->getJson('/api/designer/profile')->assertOk();

        $code = $response->json('referral_code');
        $this->assertMatchesRegularExpression('/^DES-[A-Z0-9]{6}$/', $code);
        $this->assertStringContainsString("ref={$code}", $response->json('referral_link'));
    }

    public function test_designer_profile_can_be_updated(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');
        $user->forceFill(['designer_status' => 'approved'])->save();

        $this->actingAs($user)->getJson('/api/designer/profile')->assertOk();

        $this->actingAs($user)->putJson('/api/designer/profile', [
            'display_name' => 'استودیو آوا',
            'bio' => 'طراحی کارت ویزیت و هویت بصری',
        ])->assertOk()->assertJsonPath('display_name', 'استودیو آوا');
    }

    public function test_referral_code_attribution_sets_and_clears_designer_id(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner, 'attr-demo');

        $designerUser = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $designerUser->assignRole('user');
        $designer = Designer::create([
            'user_id' => $designerUser->id,
            'display_name' => 'طراح تست',
            'slug' => 'designer-test-'.strtolower(bin2hex(random_bytes(4))),
            'referral_code' => 'DES-ATTR01',
            'status' => 'approved',
        ]);

        // Set via referral code (server-side resolution).
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}", [
            'name' => 'Demo Card',
            'designer_referral_code' => 'DES-ATTR01',
        ])->assertOk();

        $this->assertSame($designer->id, $business->fresh()->designer_id);

        // Clear via explicitly empty code.
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}", [
            'name' => 'Demo Card',
            'designer_referral_code' => '',
        ])->assertOk();

        $this->assertNull($business->fresh()->designer_id);
    }

    public function test_designer_id_cannot_be_set_directly_by_client(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner, 'tamper-demo');

        $designerUser = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $designerUser->assignRole('user');
        $designer = Designer::create([
            'user_id' => $designerUser->id,
            'display_name' => 'طراح تست',
            'slug' => 'designer-tamper-'.strtolower(bin2hex(random_bytes(4))),
            'referral_code' => 'DES-TAMPER',
            'status' => 'approved',
        ]);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}", [
            'name' => 'Demo Card',
            'designer_id' => $designer->id, // tampering attempt
        ])->assertOk();

        $this->assertNull($business->fresh()->designer_id);
    }

    public function test_unknown_referral_code_sets_no_attribution(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner, 'unknown-ref');

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}", [
            'name' => 'Demo Card',
            'designer_referral_code' => 'DES-NOPE404',
        ])->assertOk();

        $this->assertNull($business->fresh()->designer_id);
    }

    public function test_designer_id_is_ignored_without_referral_key_on_update(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner, 'keep-ref');

        $designerUser = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $designerUser->assignRole('user');
        $designer = Designer::create([
            'user_id' => $designerUser->id,
            'display_name' => 'طراح تست',
            'slug' => 'designer-keep-'.strtolower(bin2hex(random_bytes(4))),
            'referral_code' => 'DES-KEEP01',
            'status' => 'approved',
        ]);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}", [
            'name' => 'Demo Card',
            'designer_referral_code' => 'DES-KEEP01',
        ])->assertOk();
        $this->assertSame($designer->id, $business->fresh()->designer_id);

        // Update WITHOUT the referral key: attribution stays untouched.
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}", [
            'name' => 'Demo Card Two',
        ])->assertOk();
        $this->assertSame($designer->id, $business->fresh()->designer_id);
    }

    public function test_portfolio_upload_and_moderation_flow(): void
    {
        Storage::fake('public');
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');
        $user->forceFill(['designer_status' => 'approved'])->save();

        $this->actingAs($user)->getJson('/api/designer/profile')->assertOk();

        $response = $this->actingAs($user)->postJson('/api/designer/portfolios', [
            'title' => 'کارت ویزیت مینیمال',
            'file' => UploadedFile::fake()->create('work.pdf', 150, 'application/pdf'),
        ])->assertCreated();

        $portfolioId = $response->json('id');
        $this->assertSame('pending', $response->json('status'));

        $admin = $this->admin();
        $this->actingAs($admin)->patchJson("/api/admin/portfolios/{$portfolioId}/moderate", [
            'status' => 'approved',
        ])->assertOk()->assertJsonPath('status', 'approved');

        // Ownership: designer may delete own portfolio.
        $this->actingAs($user)->deleteJson("/api/designer/portfolios/{$portfolioId}")->assertOk();
    }

    public function test_non_owner_designer_cannot_delete_foreign_portfolio(): void
    {
        Storage::fake('public');
        $userA = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $userA->assignRole('designer');
        $userA->forceFill(['designer_status' => 'approved'])->save();
        $userB = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $userB->assignRole('designer');
        $userB->forceFill(['designer_status' => 'approved'])->save();

        $this->actingAs($userA)->getJson('/api/designer/profile')->assertOk();
        $portfolioId = $this->actingAs($userA)->postJson('/api/designer/portfolios', [
            'title' => 'طرح دیگران',
            'file' => UploadedFile::fake()->create('a.pdf', 100, 'application/pdf'),
        ])->assertCreated()->json('id');

        // userB first bootstraps their own designer profile (so they pass role gate).
        $this->actingAs($userB)->getJson('/api/designer/profile')->assertOk();

        $this->actingAs($userB)->deleteJson("/api/designer/portfolios/{$portfolioId}")->assertForbidden();
    }

    public function test_invalid_portfolio_type_is_rejected(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');
        $user->forceFill(['designer_status' => 'approved'])->save();
        $this->actingAs($user)->getJson('/api/designer/profile')->assertOk();

        $this->actingAs($user)->postJson('/api/designer/portfolios', [
            'title' => 'بد',
            'file' => UploadedFile::fake()->create('bad.gif', 100, 'image/gif'),
        ])->assertStatus(422);
    }

    public function test_admin_designer_moderation_changes_status(): void
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');
        $designer = Designer::create([
            'user_id' => $user->id,
            'display_name' => 'طراح تست',
            'slug' => 'designer-moderation-test',
            'referral_code' => 'DES-MOD001',
            'status' => 'pending',
        ]);

        $admin = $this->admin();
        $this->actingAs($admin)->patchJson("/api/admin/designers/{$designer->id}/moderate", [
            'status' => 'approved',
        ])->assertOk()->assertJsonPath('status', 'approved');
    }
}
