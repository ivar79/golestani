<?php

namespace Tests\Feature;

use App\Models\CardTemplate;
use App\Models\Plan;
use App\Models\SiteSetting;
use App\Models\TemplateAsset;
use App\Models\User;
use App\Models\UserCardTemplate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The data-driven Template System contract:
 *   - ONE server-side apply pipeline for builtin + DB + personal templates
 *     (authorize → clone + new ids → placeholder fill → consumer limits);
 *   - the asset REGISTRY as the canonical boundary (path checks are depth);
 *   - strict personal-template privacy (owner-only, private door only);
 *   - explicit lifecycle (status = business state, deleted_at = trash);
 *   - designer program + custom_templates as INDEPENDENT gates;
 *   - whitelisted admin settings.
 */
class TemplateSystemTest extends TestCase
{
    use RefreshDatabase;

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private function owner(): User
    {
        $user = User::factory()->create();
        $user->assignRole('user');

        return $user;
    }

    private function business(User $user, string $slug = 'tpl-biz'): \App\Models\Business
    {
        return $user->businesses()->create([
            'name' => 'کسب‌وکار قالب',
            'slug' => $slug,
            'status' => 'approved',
            'category' => 'آز',
            'phone' => '09120000000',
            'address' => 'تهران',
        ]);
    }

    private function attachPlan(\App\Models\Business $business, array $features): Plan
    {
        $plan = Plan::create([
            'name' => 'Template Plan',
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

        return $plan;
    }

    private function validDesign(): array
    {
        return [
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => '#101820',
            'layers' => [
                [
                    'id' => 'tpl-layer-1', 'kind' => 'text',
                    'x' => 40, 'y' => 40, 'width' => 500, 'height' => 60,
                    'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                    'color' => '#ffffff', 'background' => null,
                    'text' => '{{name}}', 'fontSize' => 44, 'fontWeight' => 800,
                    'align' => 'start', 'fontFamily' => 'vazir',
                ],
            ],
        ];
    }

    private function registerAsset(int $ownerId, string $scope = 'personal'): TemplateAsset
    {
        // Registry row without a real backing file: resolve() only reads the
        // DB row (the boundary under test), never the file itself.
        return TemplateAsset::create([
            'path' => "templates/users/{$ownerId}/art-test-v1.png",
            'scope' => $scope,
            'owner_id' => $ownerId,
            'mime' => 'image/png',
            'width' => 100,
            'height' => 100,
            'bytes' => 1234,
        ]);
    }

    private function designWithSrc(string $src): array
    {
        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'img-1', 'kind' => 'image',
            'x' => 600, 'y' => 60, 'width' => 200, 'height' => 200,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'color' => null, 'background' => null,
            'src' => $src, 'radius' => 0, 'objectFit' => 'cover',
        ];

        return $design;
    }

    // ------------------------------------------------------------------
    // Builtin apply — the ONE server-side contract
    // ------------------------------------------------------------------

    public function test_builtin_apply_requires_entitlement(): void
    {
        $user = $this->owner();
        $business = $this->business($user, 'builtin-no-ent');
        $this->attachPlan($business, ['card_editor' => true, 'card_templates' => ['classic']]);

        $this->actingAs($user)
            ->postJson("/api/card-templates/builtin/pro-persian-carpet-toranj/apply", ['business_id' => $business->id])
            ->assertStatus(403);
    }

    public function test_builtin_apply_clones_with_new_ids_and_fills_placeholders(): void
    {
        config(['entitlements.catalog' => config('entitlements.catalog')]);

        $user = $this->owner();
        $business = $this->business($user, 'builtin-apply');
        // Free tier defaults include card_templates [classic, local]; grant the
        // carpet template explicitly through a plan.
        $this->attachPlan($business, [
            'card_editor' => true,
            'card_templates' => ['classic', 'pro-persian-carpet-toranj'],
        ]);

        $res = $this->actingAs($user)
            ->postJson("/api/card-templates/builtin/pro-persian-carpet-toranj/apply", ['business_id' => $business->id])
            ->assertOk();

        $doc = $res->json('document');
        $this->assertNotEmpty($doc['background']);
        $this->assertNotEmpty($doc['layers']);

        // EVERY layer id is freshly generated (never the catalog's ids).
        foreach ($doc['layers'] as $layer) {
            $this->assertStringStartsWith('layer-', $layer['id']);
        }

        // Placeholders were filled from the business.
        $texts = collect($doc['layers'])->where('kind', 'text')->pluck('text')->implode(' ');
        $this->assertStringContainsString('کسب‌وکار قالب', $texts);
        $this->assertStringNotContainsString('{{name}}', $texts);
    }

    public function test_builtin_apply_is_unauthenticated_safe(): void
    {
        $this->postJson("/api/card-templates/builtin/classic/apply", ['business_id' => 1])
            ->assertStatus(401);
    }

    // ------------------------------------------------------------------
    // DB templates — pivot on stable plan_id
    // ------------------------------------------------------------------

    public function test_db_template_apply_gated_by_pivot_plan(): void
    {
        $user = $this->owner();
        $business = $this->business($user, 'db-apply');
        $plan = $this->attachPlan($business, ['card_editor' => true]);

        $template = CardTemplate::create([
            'slug' => 'admin-test-1',
            'name_fa' => 'قالب ادمین',
            'category' => 'general',
            'origin' => 'admin',
            'design_json' => json_encode($this->validDesign(), JSON_UNESCAPED_UNICODE),
            'status' => 'approved',
        ]);

        // Not assigned → 403.
        $this->actingAs($user)
            ->postJson("/api/card-templates/{$template->id}/apply", ['business_id' => $business->id])
            ->assertStatus(403);

        // Assign THIS plan through the pivot → 200.
        $template->plans()->sync([$plan->id]);
        $this->actingAs($user)
            ->postJson("/api/card-templates/{$template->id}/apply", ['business_id' => $business->id])
            ->assertOk()
            ->assertJsonPath('document.layers.0.text', 'کسب‌وکار قالب');
    }

    public function test_pending_rejected_archived_templates_never_apply_and_never_show(): void
    {
        $user = $this->owner();
        $business = $this->business($user, 'lifecycle');
        $plan = $this->attachPlan($business, ['card_editor' => true]);

        foreach (['pending', 'rejected', 'archived'] as $status) {
            $template = CardTemplate::create([
                'slug' => "admin-{$status}",
                'name_fa' => 'قالب',
                'category' => 'general',
                'origin' => 'admin',
                'design_json' => json_encode($this->validDesign(), JSON_UNESCAPED_UNICODE),
                'status' => $status,
            ]);
            $template->plans()->sync([$plan->id]);

            $this->actingAs($user)
                ->postJson("/api/card-templates/{$template->id}/apply", ['business_id' => $business->id])
                ->assertStatus(404);
        }

        // Soft-deleted approved template disappears from both surfaces.
        $template = CardTemplate::create([
            'slug' => 'admin-deleted',
            'name_fa' => 'قالب',
            'category' => 'general',
            'origin' => 'admin',
            'design_json' => json_encode($this->validDesign(), JSON_UNESCAPED_UNICODE),
            'status' => 'approved',
        ]);
        $template->plans()->sync([$plan->id]);
        $template->delete();

        $this->actingAs($user)
            ->postJson("/api/card-templates/{$template->id}/apply", ['business_id' => $business->id])
            ->assertStatus(404);

        $gallery = $this->getJson('/api/card-templates')->assertOk()->json('templates');
        $slugs = collect($gallery)->pluck('id');
        $this->assertNotContains('admin-deleted', $slugs);
    }

    // ------------------------------------------------------------------
    // Personal templates — privacy + registry + lifecycle
    // ------------------------------------------------------------------

    public function test_personal_templates_require_custom_templates_capability(): void
    {
        $user = $this->owner();
        $business = $this->business($user, 'personal-no-cap');
        $this->attachPlan($business, ['card_editor' => true]); // no custom_templates

        $this->actingAs($user)
            ->postJson('/api/my/templates', [
                'business_id' => $business->id,
                'name_fa' => 'قالب من',
                'design_json' => $this->validDesign(),
            ])
            ->assertStatus(403);
    }

    public function test_personal_template_owner_only_crud_and_apply(): void
    {
        $user = $this->owner();
        $business = $this->business($user, 'personal-owner');
        $this->attachPlan($business, ['card_editor' => true, 'custom_templates' => true]);

        $created = $this->actingAs($user)
            ->postJson('/api/my/templates', [
                'business_id' => $business->id,
                'name_fa' => 'قالب من',
                'design_json' => $this->validDesign(),
            ])
            ->assertCreated();
        $id = $created->json('template.id');

        // A stranger can neither see, apply, nor delete it.
        $stranger = $this->owner();
        $strangerBiz = $this->business($stranger, 'stranger-biz');
        $this->attachPlan($strangerBiz, ['custom_templates' => true]);

        $this->actingAs($stranger)
            ->postJson("/api/my/templates/{$id}/apply", ['business_id' => $strangerBiz->id])
            ->assertStatus(403);
        $this->actingAs($stranger)
            ->deleteJson("/api/my/templates/{$id}")
            ->assertStatus(403);

        // Owner applies: clone + new ids + placeholder fill.
        $res = $this->actingAs($user)
            ->postJson("/api/my/templates/{$id}/apply", ['business_id' => $business->id])
            ->assertOk();
        $this->assertStringStartsWith('layer-', $res->json('document.layers.0.id'));
        $this->assertStringContainsString('کسب‌وکار قالب', $res->json('document.layers.0.text'));

        // Owner deletes (soft) — the row is trashed, personal list shrinks.
        $this->actingAs($user)->deleteJson("/api/my/templates/{$id}")->assertOk();
        $this->actingAs($user)
            ->postJson("/api/my/templates/{$id}/apply", ['business_id' => $business->id])
            ->assertStatus(404);
    }

    public function test_personal_design_src_must_resolve_to_owned_registry_asset(): void
    {
        $user = $this->owner();
        $business = $this->business($user, 'personal-asset');
        $this->attachPlan($business, ['card_editor' => true, 'custom_templates' => true]);

        // Unregistered path → 422 (the validator's prefix check alone is NOT
        // enough — the registry is the boundary).
        $this->actingAs($user)
            ->postJson('/api/my/templates', [
                'business_id' => $business->id,
                'name_fa' => 'قالب',
                'design_json' => $this->designWithSrc('/storage/templates/users/999/art-fake-v1.png'),
            ])
            ->assertStatus(422);

        // ANOTHER user's registered asset → 422 (knowing the path is not enough).
        $other = $this->owner();
        $asset = $this->registerAsset($other->id);
        $this->actingAs($user)
            ->postJson('/api/my/templates', [
                'business_id' => $business->id,
                'name_fa' => 'قالب',
                'design_json' => $this->designWithSrc('/storage/' . $asset->path),
            ])
            ->assertStatus(422);

        // OWN asset → 201.
        $mine = $this->registerAsset($user->id);
        $this->actingAs($user)
            ->postJson('/api/my/templates', [
                'business_id' => $business->id,
                'name_fa' => 'قالب',
                'design_json' => $this->designWithSrc('/storage/' . $mine->path),
            ])
            ->assertCreated();
    }

    public function test_personal_template_delete_never_touches_assets(): void
    {
        $user = $this->owner();
        $business = $this->business($user, 'personal-asset-life');
        $this->attachPlan($business, ['card_editor' => true, 'custom_templates' => true]);

        $asset = $this->registerAsset($user->id);
        $template = $this->actingAs($user)
            ->postJson('/api/my/templates', [
                'business_id' => $business->id,
                'name_fa' => 'قالب',
                'design_json' => $this->designWithSrc('/storage/' . $asset->path),
            ])
            ->assertCreated();
        $id = $template->json('template.id');

        $this->actingAs($user)->deleteJson("/api/my/templates/{$id}")->assertOk();

        // Template trashed; the registry row (and its file) SURVIVE — applied
        // cards may still reference this immutable asset.
        $this->assertSoftDeleted('user_card_templates', ['id' => $id]);
        $this->assertDatabaseHas('template_assets', ['id' => $asset->id]);
    }

    public function test_personal_asset_upload_stores_and_registers(): void
    {
        $user = $this->owner();
        $business = $this->business($user, 'personal-upload');
        $this->attachPlan($business, ['card_editor' => true, 'custom_templates' => true]);
        Storage::fake('public');

        $image = UploadedFile::fake()->image('art.png', 800, 600);
        Storage::persistentFake('public');
        // Multipart contract (ApiRequestSafety): files go through the $files
        // slot with an explicit multipart Content-Type + the XHR header.
        $res = $this->actingAs($user)->call(
            'POST', '/api/my/templates-asset',
            [], [], ['image' => $image],
            ['HTTP_X-Requested-With' => 'XMLHttpRequest', 'CONTENT_TYPE' => 'multipart/form-data'],
        );
        $res->assertCreated();

        $path = $res->json('asset.path');
        $this->assertStringStartsWith("templates/users/{$user->id}/", $path);
        $this->assertDatabaseHas('template_assets', ['path' => $path, 'scope' => 'personal', 'owner_id' => $user->id]);

        // Without the capability → 403.
        $plain = $this->owner();
        $plainBiz = $this->business($plain, 'plain-biz');
        $this->attachPlan($plainBiz, ['card_editor' => true]);
        $this->actingAs($plain)
            ->call(
                'POST', '/api/my/templates-asset',
                [], [], ['image' => UploadedFile::fake()->image('x.png')],
                ['HTTP_X-Requested-With' => 'XMLHttpRequest', 'CONTENT_TYPE' => 'multipart/form-data'],
            )
            ->assertStatus(403);
    }

    // ------------------------------------------------------------------
    // Designer program + gallery submissions
    // ------------------------------------------------------------------

    public function test_designer_program_request_and_gate(): void
    {
        SiteSetting::updateOrCreate(['key' => 'designer_program_enabled'], ['value' => '1']);

        $user = $this->owner();
        $business = $this->business($user, 'designer-prog');
        $this->attachPlan($business, ['card_editor' => true, 'custom_templates' => true]);
        // Re-read after attachPlan so the acting model carries the DB defaults
        // (a stale in-memory model answers designer_status = null).
        $user = User::find($user->id);

        // Not approved yet → 403.
        $this->actingAs($user)
            ->postJson('/api/designer/templates', [
                'name_fa' => 'قالب طراح',
                'design_json' => $this->validDesign(),
            ])
            ->assertStatus(403);

        // Request → pending.
        $this->actingAs($user)
            ->postJson('/api/designer/program/request')
            ->assertOk()
            ->assertJsonPath('designer_status', 'pending');

        // Program DISABLED: request refused (but the status survives).
        SiteSetting::updateOrCreate(['key' => 'designer_program_enabled'], ['value' => '0']);
        $user2 = $this->owner();
        $this->actingAs($user2)->postJson('/api/designer/program/request')->assertStatus(403);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'designer_status' => 'pending']);
    }

    public function test_designer_submission_requires_status_capability_and_flag(): void
    {
        SiteSetting::updateOrCreate(['key' => 'designer_program_enabled'], ['value' => '1']);
        $user = $this->owner();
        $business = $this->business($user, 'designer-submit');
        $this->attachPlan($business, ['card_editor' => true, 'custom_templates' => true]);
        $user = User::find($user->id);

        // Approve the designer status server-side.
        $user->forceFill(['designer_status' => 'approved'])->save();
        $user = User::find($user->id);

        // Register an OWN asset for the artwork.
        $asset = $this->registerAsset($user->id, 'submission');

        $created = $this->actingAs($user)
            ->postJson('/api/designer/templates', [
                'name_fa' => 'اثر طراح',
                'category' => 'persian',
                'design_json' => $this->designWithSrc('/storage/' . $asset->path),
            ])
            ->assertCreated();

        $this->assertDatabaseHas('card_templates', [
            'id' => $created->json('template.id'),
            'origin' => 'designer',
            'status' => 'pending',
        ]);

        // Flag OFF closes submissions (status untouched).
        SiteSetting::updateOrCreate(['key' => 'designer_program_enabled'], ['value' => '0']);
        $this->actingAs($user)
            ->postJson('/api/designer/templates', [
                'name_fa' => 'اثر دوم',
                'design_json' => $this->validDesign(),
            ])
            ->assertStatus(403);
        $this->assertDatabaseHas('users', ['id' => $user->id, 'designer_status' => 'approved']);
    }

    public function test_admin_moderates_designer_submission_with_reason(): void
    {
        SiteSetting::updateOrCreate(['key' => 'designer_program_enabled'], ['value' => '1']);
        $user = $this->owner();
        $business = $this->business($user, 'designer-mod');
        $this->attachPlan($business, ['card_editor' => true, 'custom_templates' => true]);
        $user->forceFill(['designer_status' => 'approved'])->save();

        $template = CardTemplate::create([
            'slug' => 'designer-mod-1',
            'name_fa' => 'اثر',
            'category' => 'general',
            'origin' => 'designer',
            'design_json' => json_encode($this->validDesign(), JSON_UNESCAPED_UNICODE),
            'uploaded_by' => $user->id,
            'status' => 'pending',
        ]);

        $admin = User::factory()->create();
        $admin->assignRole('admin');

        // Reject without reason → 422.
        $this->actingAs($admin)
            ->patchJson("/api/admin/templates/{$template->id}/moderate", ['action' => 'reject'])
            ->assertStatus(422);

        $this->actingAs($admin)
            ->patchJson("/api/admin/templates/{$template->id}/moderate", [
                'action' => 'reject', 'reason' => 'کیفیت تصویر پایین است.',
            ])
            ->assertOk()
            ->assertJsonPath('template.status', 'rejected');

        $this->actingAs($admin)
            ->patchJson("/api/admin/templates/{$template->id}/moderate", ['action' => 'approve'])
            ->assertOk()
            ->assertJsonPath('template.status', 'approved');

        // Non-admin is refused.
        $this->actingAs($user)
            ->patchJson("/api/admin/templates/{$template->id}/moderate", ['action' => 'archive'])
            ->assertStatus(403);
    }

    // ------------------------------------------------------------------
    // Admin CRUD + settings whitelist + gallery
    // ------------------------------------------------------------------

    public function test_admin_crud_and_plan_assignment(): void
    {
        $admin = User::factory()->create();
        $admin->assignRole('admin');
        $plan = Plan::create(['name' => 'پلن X', 'price' => 1, 'duration_days' => 30]);

        $created = $this->actingAs($admin)
            ->postJson('/api/admin/templates', [
                'name_fa' => 'قالب مدیریتی',
                'slug' => 'admin-managed-1',
                'category' => 'business',
                'design_json' => $this->validDesign(),
                'plan_ids' => [$plan->id],
            ])
            ->assertCreated();

        $id = $created->json('template.id');
        $this->assertDatabaseHas('card_template_plans', ['card_template_id' => $id, 'plan_id' => $plan->id]);

        // Plan RENAME must not break the assignment (plan_id is the stable key).
        $plan->update(['name' => 'پلن ایکس تغییرنام']);
        $this->actingAs($admin)
            ->getJson("/api/admin/templates/{$id}/plans")
            ->assertOk()
            ->assertJsonPath('plan_ids.0', $plan->id);

        // Soft delete.
        $this->actingAs($admin)->deleteJson("/api/admin/templates/{$id}")->assertOk();
        $this->assertSoftDeleted('card_templates', ['id' => $id]);
    }

    public function test_settings_write_is_whitelisted(): void
    {
        $admin = User::factory()->create();
        $admin->assignRole('admin');

        // Unknown key → 422 (arbitrary setting writes are refused).
        $this->actingAs($admin)
            ->putJson('/api/admin/settings/evil.key', ['value' => 'x'])
            ->assertStatus(422);
        // Unknown key OUTSIDE the CMS prefixes → 422 too.
        $this->actingAs($admin)
            ->putJson('/api/admin/settings/blog.title', ['value' => 'x'])
            ->assertStatus(422);

        // Known key with a NON-bool value → 422.
        $this->actingAs($admin)
            ->putJson('/api/admin/settings/designer_program_enabled', ['value' => 'maybe'])
            ->assertStatus(422);

        // Proper bool values persist.
        $this->actingAs($admin)
            ->putJson('/api/admin/settings/designer_program_enabled', ['value' => true])
            ->assertOk();
        $this->assertDatabaseHas('site_settings', ['key' => 'designer_program_enabled', 'value' => '1']);
        $this->actingAs($admin)
            ->putJson('/api/admin/settings/designer_program_enabled', ['value' => false])
            ->assertOk();
        $this->assertDatabaseHas('site_settings', ['key' => 'designer_program_enabled', 'value' => '0']);

        // Pre-existing CMS keys stay writable (read-side whitelist unchanged).
        $this->actingAs($admin)
            ->putJson('/api/admin/settings/homepage.hero.title', ['value' => 'عنوان'])
            ->assertOk();
    }

    public function test_gallery_merges_builtin_and_approved_db_and_flags_entitlement(): void
    {
        $user = $this->owner();
        $business = $this->business($user, 'gallery-flags');
        $this->attachPlan($business, ['card_editor' => true, 'card_templates' => ['classic']]);

        // Approved + assigned → visible & entitled; pending designer → hidden.
        $planId = $business->subscriptions()->where('status', 'active')->value('plan_id');
        $approved = CardTemplate::create([
            'slug' => 'admin-gal-1',
            'name_fa' => 'گالری',
            'category' => 'general',
            'origin' => 'admin',
            'design_json' => json_encode($this->validDesign(), JSON_UNESCAPED_UNICODE),
            'status' => 'approved',
        ]);
        $approved->plans()->sync([$planId]);

        CardTemplate::create([
            'slug' => 'designer-gal-pending',
            'name_fa' => 'پنهان',
            'category' => 'general',
            'origin' => 'designer',
            'design_json' => json_encode($this->validDesign(), JSON_UNESCAPED_UNICODE),
            'uploaded_by' => $user->id,
            'status' => 'pending',
        ]);

        $gallery = $this->actingAs($user)
            ->getJson('/api/card-templates?business_id=' . $business->id)
            ->assertOk()
            ->json('templates');

        $byId = collect($gallery)->keyBy('id');
        // Legacy constrained-editor template keys surface as builtin rows too.
        $this->assertTrue($byId->has('classic'));
        $this->assertTrue($byId->get('classic')['entitled']);
        $this->assertTrue($byId->has('admin-gal-1'));
        $this->assertTrue($byId->get('admin-gal-1')['entitled']);
        $this->assertFalse($byId->get('pro-persian-carpet-toranj')['entitled']); // UX-only flag
        $this->assertFalse($byId->has('designer-gal-pending'));
    }
}
