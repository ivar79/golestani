<?php

namespace Tests\Security;

use App\Models\Business;
use App\Models\CardTemplate;
use App\Models\Plan;
use App\Models\TemplateAsset;
use App\Models\User;
use App\Services\TemplateAssetService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Regression suite for audit finding `private-template-asset-public-disk`:
 * personal template artwork was written to the web-served public disk, so
 * `GET /storage/templates/users/{id}/…` returned another principal's private
 * bytes to anyone, with no credential (the PoC got the exact file bytes at
 * HTTP 200 while the ownership-checked endpoint answered 404).
 *
 * The fix is storage-level: personal/submission scopes live on a PRIVATE disk
 * that is neither linked into public/ nor reachable through a static URL, and
 * every read goes through the ownership-checked endpoint. Submission artwork
 * of an APPROVED template is published by an explicit, idempotent step.
 *
 * Asserted boundaries:
 *   1. owner can read their own private asset through the authorized door;
 *   2. another user cannot;
 *   3. an unauthenticated caller cannot;
 *   4. public (system) assets stay publicly stored and are refused by the
 *      private door;
 *   5. alternate/traversal/look-alike paths and other HTTP methods cannot
 *      bypass authorization;
 *   6. uploads physically land on the private disk and NEVER on the public one
 *      (the direct replacement for the original static-URL PoC);
 *   7. publication happens only at approval and is idempotent/retryable.
 */
class PrivateTemplateAssetTest extends TestCase
{
    use RefreshDatabase;

    /** 1×1 PNG — identical bytes to the audit PoC fixture. */
    private const PNG_BYTES = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

    private function png(): string
    {
        return (string) base64_decode(self::PNG_BYTES, true);
    }

    private function user(?string $phone = null): User
    {
        $user = User::factory()->create(['phone' => $phone ?? '09'.fake()->numerify('#########')]);
        $user->assignRole('user');

        return $user;
    }

    private function admin(): User
    {
        // Unique phone: a test may need to act as an admin more than once.
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');

        return $admin;
    }

    private function business(User $user, string $slug = 'asset-biz'): Business
    {
        return $user->businesses()->create([
            'name' => 'کسب‌وکار دارایی', 'slug' => $slug, 'status' => 'approved',
            'category' => 'کافه', 'phone' => '09120000000', 'address' => 'تهران',
        ]);
    }

    private function attachPlan(Business $business, array $features): Plan
    {
        $plan = Plan::create(['name' => 'Asset Plan', 'price' => 100, 'duration_days' => 30, 'features' => $features]);
        $business->subscriptions()->create([
            'plan_id' => $plan->id, 'status' => 'active',
            'start_date' => now(), 'end_date' => now()->addDays(30),
        ]);

        return $plan;
    }

    /** Registry row + real file on the PRIVATE disk (the post-fix steady state). */
    private function privateAsset(int $ownerId, string $scope = 'personal'): TemplateAsset
    {
        $path = "templates/users/{$ownerId}/art-".bin2hex(random_bytes(4)).'-v1.png';
        Storage::disk(TemplateAssetService::PRIVATE_DISK)->put($path, $this->png());

        return TemplateAsset::create([
            'path' => $path, 'scope' => $scope, 'owner_id' => $ownerId,
            'mime' => 'image/png', 'width' => 1, 'height' => 1, 'bytes' => strlen($this->png()),
        ]);
    }

    /** @return array<string, mixed> */
    private function designJsonWithImage(string $src): string
    {
        return json_encode([
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => '#101820',
            'layers' => [[
                'id' => 'img-1', 'kind' => 'image', 'x' => 0, 'y' => 0, 'width' => 100, 'height' => 100,
                'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                'color' => null, 'background' => null, 'src' => $src, 'radius' => 0, 'objectFit' => 'cover',
            ]],
        ], JSON_UNESCAPED_UNICODE);
    }

    private function designerTemplate(User $designer, string $src, string $status = 'pending'): CardTemplate
    {
        return CardTemplate::create([
            'slug' => 'designer-'.$designer->id.'-'.bin2hex(random_bytes(3)),
            'name_fa' => 'قالب طراح',
            'category' => 'general',
            'origin' => 'designer',
            'design_json' => $this->designJsonWithImage($src),
            'uploaded_by' => $designer->id,
            'status' => $status,
        ]);
    }

    // ------------------------------------------------------------------
    // 1–3. The authorized door
    // ------------------------------------------------------------------

    public function test_owner_can_read_their_private_asset_through_the_authorized_door(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        $owner = $this->user();
        $asset = $this->privateAsset($owner->id);

        $response = $this->actingAs($owner)
            ->get("/api/assets/private/{$asset->path}")
            ->assertOk();

        $this->assertSame($this->png(), $response->streamedContent());
        $this->assertSame('image/png', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('private', (string) $response->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
    }

    public function test_another_user_cannot_read_it(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        $owner = $this->user('09120000002');
        $asset = $this->privateAsset($owner->id);

        $this->actingAs($this->user('09120000003'))
            ->get("/api/assets/private/{$asset->path}")
            ->assertNotFound();
    }

    public function test_an_unauthenticated_caller_cannot_read_it(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        $owner = $this->user('09120000004');
        $asset = $this->privateAsset($owner->id);

        $this->get("/api/assets/private/{$asset->path}")->assertUnauthorized();
    }

    public function test_an_admin_cannot_read_another_users_personal_asset(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        $owner = $this->user('09120000005');
        $asset = $this->privateAsset($owner->id);

        $this->actingAs($this->admin())
            ->get("/api/assets/private/{$asset->path}")
            ->assertNotFound();
    }

    // ------------------------------------------------------------------
    // 4–5. Scope, alternate paths and methods
    // ------------------------------------------------------------------

    public function test_the_private_door_refuses_non_private_scopes_and_unregistered_paths(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        $user = $this->user('09120000006');

        // A system (public) asset is served from the public disk — never here.
        $systemPath = 'templates/uploaded/sys-'.bin2hex(random_bytes(4)).'-v1.png';
        Storage::disk(TemplateAssetService::DISK)->put($systemPath, $this->png());
        TemplateAsset::create([
            'path' => $systemPath, 'scope' => 'system', 'owner_id' => null,
            'mime' => 'image/png', 'width' => 1, 'height' => 1, 'bytes' => strlen($this->png()),
        ]);

        $this->actingAs($user)->get("/api/assets/private/{$systemPath}")->assertNotFound();
        // Outside the templates/ namespace entirely.
        $this->actingAs($user)->get('/api/assets/private/media/secret.png')->assertNotFound();
        // Registered nowhere.
        $this->actingAs($user)->get('/api/assets/private/templates/users/'.$user->id.'/art-missing-v1.png')->assertNotFound();
    }

    public function test_alternate_and_traversal_forms_are_refused(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        $owner = $this->user('09120000007');
        $asset = $this->privateAsset($owner->id);
        $id = $owner->id;

        $hostile = [
            'templates/users/'.$id.'/../../users/'.$id.'/'.basename($asset->path),
            'templates/users/'.$id.'/%2e%2e/art.png',
            'templates//users/'.$id.'/'.basename($asset->path),
            'templates/users/'.$id.'/..%2f'.basename($asset->path),
            'templates/users/'.$id.'/'.$asset->path,
        ];

        foreach ($hostile as $path) {
            $this->actingAs($owner)
                ->get('/api/assets/private/'.$path)
                ->assertNotFound();
        }

        // The legitimate path still works after all of that.
        $this->actingAs($owner)->get("/api/assets/private/{$asset->path}")->assertOk();
    }

    public function test_private_asset_door_rejects_other_http_methods(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        $owner = $this->user('09120000008');
        $asset = $this->privateAsset($owner->id);
        $url = "/api/assets/private/{$asset->path}";

        $this->actingAs($owner)->post($url)->assertStatus(405);
        $this->actingAs($owner)->put($url)->assertStatus(405);
        $this->actingAs($owner)->delete($url)->assertStatus(405);
    }

    // ------------------------------------------------------------------
    // 6. Uploads land on the private disk — never on the public one
    // ------------------------------------------------------------------

    public function test_personal_upload_lands_on_the_private_disk_and_never_publicly(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        Storage::fake(TemplateAssetService::DISK);

        $user = $this->user('09120000010');
        $business = $this->business($user, 'private-upload-biz');
        $this->attachPlan($business, ['card_editor' => true, 'custom_templates' => true]);

        $response = $this->actingAs($user)->call(
            'POST', '/api/my/templates-asset',
            ['business_id' => $business->id], [],
            ['image' => UploadedFile::fake()->image('art.png', 800, 600)],
            ['HTTP_X-Requested-With' => 'XMLHttpRequest', 'CONTENT_TYPE' => 'multipart/form-data'],
        )->assertCreated();

        $path = $response->json('asset.path');
        $this->assertStringStartsWith("templates/users/{$user->id}/", $path);

        // THE regression: the file exists privately and does NOT exist in the
        // web-served root — so the original static-URL PoC 404s.
        Storage::disk(TemplateAssetService::PRIVATE_DISK)->assertExists($path);
        Storage::disk(TemplateAssetService::DISK)->assertMissing($path);
        $this->assertDatabaseHas('template_assets', ['path' => $path, 'scope' => 'personal', 'owner_id' => $user->id]);
    }

    public function test_submission_and_system_scopes_route_to_the_right_disks(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        Storage::fake(TemplateAssetService::DISK);

        $designer = $this->user('09120000011');
        $personal = TemplateAssetService::storeUpload(UploadedFile::fake()->image('p.png'), 'personal', $designer->id);
        $submission = TemplateAssetService::storeUpload(UploadedFile::fake()->image('s.png'), 'submission', $designer->id);
        // The scope decides the disk, not the folder or the owner column; the
        // uploader id is irrelevant for a system-scope file.
        $system = TemplateAssetService::storeUpload(UploadedFile::fake()->image('y.png'), 'system', $designer->id);

        foreach ([$personal, $submission] as $asset) {
            Storage::disk(TemplateAssetService::PRIVATE_DISK)->assertExists($asset->path);
            Storage::disk(TemplateAssetService::DISK)->assertMissing($asset->path);
        }

        // System artwork is public by design and stays on the public disk.
        Storage::disk(TemplateAssetService::DISK)->assertExists($system->path);
        Storage::disk(TemplateAssetService::PRIVATE_DISK)->assertMissing($system->path);
    }

    // ------------------------------------------------------------------
    // 7. Publication only at approval; idempotent and retryable
    // ------------------------------------------------------------------

    public function test_approval_publishes_submission_artwork_and_is_idempotent(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        Storage::fake(TemplateAssetService::DISK);

        $designer = $this->user('09120000012');
        $asset = $this->privateAsset($designer->id, 'submission');
        $template = $this->designerTemplate($designer, TemplateAssetService::srcForPath($asset->path));
        $url = "/api/admin/templates/{$template->id}/moderate";

        // Before approval: review-stage artwork is private only.
        Storage::disk(TemplateAssetService::DISK)->assertMissing($asset->path);

        $this->actingAs($this->admin())
            ->patchJson($url, ['action' => 'approve'])
            ->assertOk()
            ->assertJsonPath('template.status', 'approved')
            ->assertJsonPath('publication.published_count', 1)
            ->assertJsonPath('publication.unpublished_count', 0);

        // Published to the public disk AND the private master is preserved so
        // the owner's authorized endpoint keeps working.
        Storage::disk(TemplateAssetService::DISK)->assertExists($asset->path);
        Storage::disk(TemplateAssetService::PRIVATE_DISK)->assertExists($asset->path);

        // Idempotent: re-approving publishes nothing new and reports no drift.
        $this->actingAs($this->admin())
            ->patchJson($url, ['action' => 'approve'])
            ->assertOk()
            ->assertJsonPath('publication.published_count', 0)
            ->assertJsonPath('publication.unpublished_count', 0);
    }

    public function test_pending_and_rejected_templates_never_publish_their_artwork(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        Storage::fake(TemplateAssetService::DISK);

        $designer = $this->user('09120000013');
        $asset = $this->privateAsset($designer->id, 'submission');
        $template = $this->designerTemplate($designer, TemplateAssetService::srcForPath($asset->path));

        // Still pending → nothing published.
        $this->assertFalse(Storage::disk(TemplateAssetService::DISK)->exists($asset->path));

        $this->actingAs($this->admin())
            ->patchJson("/api/admin/templates/{$template->id}/moderate", ['action' => 'reject', 'reason' => 'کیفیت پایین'])
            ->assertOk()
            // The publication step is not even attempted for a non-approval.
            ->assertJsonPath('publication', null);

        // Rejected → still nothing published.
        Storage::disk(TemplateAssetService::DISK)->assertMissing($asset->path);
        // The backfill command only considers APPROVED templates, so it cannot
        // publish a rejected template's artwork either.
        $this->artisan('template-assets:publish')->assertExitCode(0);
        Storage::disk(TemplateAssetService::DISK)->assertMissing($asset->path);
    }

    public function test_approval_succeeds_and_reports_unpublished_when_a_source_file_is_missing(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        Storage::fake(TemplateAssetService::DISK);

        $designer = $this->user('09120000014');
        // Registry row without a backing file (drift / lost object).
        $path = "templates/users/{$designer->id}/art-lost-v1.png";
        TemplateAsset::create([
            'path' => $path, 'scope' => 'submission', 'owner_id' => $designer->id,
            'mime' => 'image/png', 'width' => 1, 'height' => 1, 'bytes' => 70,
        ]);
        $template = $this->designerTemplate($designer, TemplateAssetService::srcForPath($path));

        // Moderation must NOT fail because of a filesystem problem…
        $this->actingAs($this->admin())
            ->patchJson("/api/admin/templates/{$template->id}/moderate", ['action' => 'approve'])
            ->assertOk()
            ->assertJsonPath('template.status', 'approved')
            ->assertJsonPath('publication.unpublished_count', 1)
            ->assertJsonPath('publication.unpublished.0', $path);

        // …and the state stays detectable + retryable.
        Storage::disk(TemplateAssetService::DISK)->assertMissing($path);
        $this->assertSame(0, count(TemplateAssetService::publishSubmissionAssets($template->design_json)['published']));
        $this->assertSame(1, count(TemplateAssetService::publishSubmissionAssets($template->design_json)['unpublished']));
    }

    public function test_publish_never_touches_personal_scoped_artwork(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        Storage::fake(TemplateAssetService::DISK);

        $owner = $this->user('09120000015');
        $asset = $this->privateAsset($owner->id, 'personal');
        $design = $this->designJsonWithImage(TemplateAssetService::srcForPath($asset->path));

        $result = TemplateAssetService::publishSubmissionAssets($design);

        $this->assertSame([], $result['published']);
        $this->assertSame(1, $result['skipped']);
        Storage::disk(TemplateAssetService::DISK)->assertMissing($asset->path);
    }

    // ------------------------------------------------------------------
    // Deployment commands
    // ------------------------------------------------------------------

    public function test_move_to_private_command_relocates_legacy_public_copies_idempotently(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        Storage::fake(TemplateAssetService::DISK);

        $owner = $this->user('09120000016');
        $path = "templates/users/{$owner->id}/art-legacy-v1.png";
        Storage::disk(TemplateAssetService::DISK)->put($path, $this->png());
        TemplateAsset::create([
            'path' => $path, 'scope' => 'personal', 'owner_id' => $owner->id,
            'mime' => 'image/png', 'width' => 1, 'height' => 1, 'bytes' => strlen($this->png()),
        ]);

        // Dry run changes nothing.
        $this->artisan('template-assets:move-to-private', ['--dry-run' => true])->assertExitCode(0);
        Storage::disk(TemplateAssetService::DISK)->assertExists($path);
        Storage::disk(TemplateAssetService::PRIVATE_DISK)->assertMissing($path);

        $this->artisan('template-assets:move-to-private')->assertExitCode(0);
        Storage::disk(TemplateAssetService::PRIVATE_DISK)->assertExists($path);
        // The public copy is gone → the old static URL can never serve it again.
        Storage::disk(TemplateAssetService::DISK)->assertMissing($path);

        // Re-running is a no-op, not an error.
        $this->artisan('template-assets:move-to-private')->assertExitCode(0);
        Storage::disk(TemplateAssetService::PRIVATE_DISK)->assertExists($path);
    }

    public function test_publish_command_backfills_approved_templates_and_reports_failures(): void
    {
        Storage::fake(TemplateAssetService::PRIVATE_DISK);
        Storage::fake(TemplateAssetService::DISK);

        $designer = $this->user('09120000017');
        $published = $this->privateAsset($designer->id, 'submission');
        $approved = $this->designerTemplate($designer, TemplateAssetService::srcForPath($published->path), 'approved');

        // Detectable before the backfill (the state the audit described).
        $this->artisan('template-assets:publish', ['--dry-run' => true])->assertExitCode(0);
        Storage::disk(TemplateAssetService::DISK)->assertMissing($published->path);

        $this->artisan('template-assets:publish')->assertExitCode(0);
        Storage::disk(TemplateAssetService::DISK)->assertExists($published->path);

        // A second approved template whose file is missing → FAILURE exit code
        // so a retry is detectable, and the template stays approved.
        $lostPath = "templates/users/{$designer->id}/art-lost2-v1.png";
        TemplateAsset::create([
            'path' => $lostPath, 'scope' => 'submission', 'owner_id' => $designer->id,
            'mime' => 'image/png', 'width' => 1, 'height' => 1, 'bytes' => 70,
        ]);
        $this->designerTemplate($designer, TemplateAssetService::srcForPath($lostPath), 'approved');

        $this->artisan('template-assets:publish')->assertExitCode(1);
        $this->assertSame('approved', $approved->fresh()->status);
    }
}
