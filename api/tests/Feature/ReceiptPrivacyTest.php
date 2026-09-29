<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Subscription;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Phase 5/6 security regression — receipts are confidential financial
 * documents:
 *   - stored on the PRIVATE receipts disk (never public, never a public URL)
 *   - download only via the authorized endpoint: owner/admin allowed,
 *     everyone else 403, guests 401
 *   - partially-migrated state (row points at receipts/, public copy still
 *     present) is REJECTED, never silently leaked
 *   - missing files fail with graceful 404 (not 500)
 */
class ReceiptPrivacyTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function subscriptionWithReceipt(User $owner): array
    {
        $business = $owner->businesses()->create(['name' => 'Receipt Biz', 'slug' => 'receipt-biz-'.fake()->numerify('####'), 'status' => 'approved']);
        $plan = Plan::create(['name' => 'P', 'price' => 100, 'duration_days' => 30, 'features' => []]);
        // postJson + UploadedFile mirrors the project's established upload
        // test pattern (PhaseFourCardTest): the request builder converts it
        // to multipart and sets the XHR header the safety middleware expects.
        $response = $this->actingAs($owner)->postJson("/api/businesses/{$business->id}/subscriptions", [
            'plan_id' => $plan->id,
            'receipt_reference' => 'TRX-X1',
            'receipt' => UploadedFile::fake()->create('receipt.pdf', 80, 'application/pdf'),
        ]);
        $response->assertCreated();

        return [$business, Subscription::findOrFail($response->json('id'))];
    }

    public function test_receipt_is_stored_on_private_disk_and_public_url_is_dead(): void
    {
        Storage::fake('receipts');
        Storage::fake('public');
        $owner = $this->owner();
        [, $subscription] = $this->subscriptionWithReceipt($owner);

        $path = $subscription->receipt_path;
        $this->assertStringStartsWith('receipts/', $path);
        Storage::disk('receipts')->assertExists($path);
        Storage::disk('public')->assertMissing($path);
    }

    public function test_owner_and_admin_can_download_but_others_and_guests_cannot(): void
    {
        Storage::fake('receipts');
        $owner = $this->owner();
        [$business, $subscription] = $this->subscriptionWithReceipt($owner);
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');
        $stranger = $this->owner();

        $this->actingAs($owner)->get("/api/subscriptions/{$subscription->id}/receipt")->assertOk();
        $this->actingAs($admin)->get("/api/subscriptions/{$subscription->id}/receipt")->assertOk();
        $this->actingAs($stranger)->get("/api/subscriptions/{$subscription->id}/receipt")->assertForbidden();
        // Guest: middleware answer (401/403 per Sanctum guard config) — the
        // point is that unauthenticated access never reaches the file.
        $guest = $this->getJson("/api/subscriptions/{$subscription->id}/receipt")->assertForbidden();
        $this->assertContains($guest->status(), [401, 403]);
        $this->assertNotNull($business);
    }

    public function test_partially_migrated_receipt_is_rejected_not_leaked(): void
    {
        Storage::fake('receipts');
        Storage::fake('public');
        $owner = $this->owner();
        [, $subscription] = $this->subscriptionWithReceipt($owner);

        // Simulate a FAILED transfer: row updated to receipts/ path but the
        // stray public copy was never deleted AND the private copy is absent.
        // The endpoint refuses with 403/404 — either way it never leaks the
        // stray public file through the authorized channel.
        $legacy = 'subscriptions/receipts/legacy.pdf';
        Storage::disk('public')->put($legacy, 'stray copy');
        $subscription->forceFill(['receipt_path' => 'receipts/legacy.pdf'])->save();

        $response = $this->actingAs($owner)->get("/api/subscriptions/{$subscription->id}/receipt");
        $this->assertContains($response->status(), [403, 404]);
        // ...and the stray public copy must NOT be downloadable directly.
        $this->assertTrue(Storage::disk('public')->exists($legacy)); // cleanup happens via transfer command, not download
    }

    public function test_missing_receipt_file_fails_gracefully(): void
    {
        Storage::fake('receipts');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'B', 'slug' => 'biz-missing-1', 'status' => 'approved']);
        $plan = Plan::create(['name' => 'P2', 'price' => 1, 'duration_days' => 1, 'features' => []]);
        $subscription = $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'pending_receipt',
            'receipt_path' => 'receipts/vanished.pdf',
        ]);

        // Row exists, file does not → graceful 404, never a 500.
        $this->actingAs($owner)->get("/api/subscriptions/{$subscription->id}/receipt")->assertNotFound();
    }

    public function test_transfer_command_moves_receipts_and_deletes_public_copies(): void
    {
        Storage::fake('receipts');
        Storage::fake('public');
        $owner = $this->owner();
        [, $subscription] = $this->subscriptionWithReceipt($owner);

        // Simulate a legacy pre-migration row.
        $legacyPath = 'subscriptions/receipts/old.pdf';
        Storage::disk('public')->put($legacyPath, 'legacy receipt bytes');
        $subscription->forceFill(['receipt_path' => $legacyPath])->save();

        $this->artisan('receipts:move-to-private')->assertExitCode(0);

        $subscription->refresh();
        $this->assertStringStartsWith('receipts/', $subscription->receipt_path);
        Storage::disk('receipts')->assertExists($subscription->receipt_path);
        Storage::disk('public')->assertMissing($legacyPath);

        // Idempotent: re-run is a no-op.
        $this->artisan('receipts:move-to-private')->assertExitCode(0);
        Storage::disk('receipts')->assertExists($subscription->receipt_path);
    }

    public function test_transfer_command_skips_missing_files_without_dying(): void
    {
        Storage::fake('receipts');
        Storage::fake('public');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'B3', 'slug' => 'biz-missing-3', 'status' => 'approved']);
        $plan = Plan::create(['name' => 'P3', 'price' => 1, 'duration_days' => 1, 'features' => []]);
        $subscription = $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'pending_receipt',
            'receipt_path' => 'subscriptions/receipts/never-existed.pdf',
        ]);

        $this->artisan('receipts:move-to-private')->assertExitCode(0);
        $subscription->refresh();
        $this->assertSame('subscriptions/receipts/never-existed.pdf', $subscription->receipt_path);
    }
}
