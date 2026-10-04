<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\CardTemplate;
use App\Models\Plan;
use App\Models\SiteSetting;
use App\Models\User;
use App\Models\UserCardTemplate;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * THE canonical studio apply pipeline (amendment 4):
 *
 *   POST /businesses/{business}/card/template-apply
 *     { source: builtin|db|personal, template_id }
 *
 * The client NEVER sends a document. Resolution → entitlement → materialize
 * (clone + FRESH layer ids + placeholder fill) → validation → design
 * entitlement accounting → persist, in one transaction.
 */
class StudioTemplateApplyTest extends TestCase
{
    use RefreshDatabase;

    private const CATALOG_ID = 'free-classic-navy';

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

    private function business(User $owner, array $features, string $prefix = 'apply'): Business
    {
        $business = $owner->businesses()->create([
            'name' => 'کسب‌وکار استودیو',
            'slug' => $prefix.'-'.fake()->unique()->regexify('[a-z0-9]{8}'),
            'category' => 'آز',
            'phone' => '09120000000',
            'status' => 'approved',
        ]);

        $plan = Plan::create([
            'name' => 'Apply Plan',
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

    private function approvedDesignerBusiness(array $extraFeatures = [], string $prefix = 'apply'): array
    {
        $designer = $this->user(['business_owner', 'designer'], 'approved');
        $business = $this->business($designer, $extraFeatures + [
            'card_editor' => true,
            'designer_studio' => true,
            'card_templates' => [self::CATALOG_ID],
        ], $prefix);

        return [$designer, $business];
    }

    private function enforce(bool $on = true): void
    {
        SiteSetting::updateOrCreate(['key' => 'studio_designer_only'], ['value' => $on ? '1' : '0']);
    }

    private function apply(User $user, Business $business, array $payload)
    {
        return $this->actingAs($user)->postJson(
            "/api/businesses/{$business->id}/card/template-apply",
            $payload,
        );
    }

    private function validDesign(string $text = 'سلام'): array
    {
        return [
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => '#101820',
            'layers' => [
                [
                    'id' => 'tpl-1', 'kind' => 'text',
                    'x' => 40, 'y' => 40, 'width' => 500, 'height' => 60,
                    'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                    'color' => '#ffffff', 'background' => null,
                    'text' => $text, 'fontSize' => 44, 'fontWeight' => 800,
                    'align' => 'start', 'fontFamily' => 'vazir',
                ],
            ],
        ];
    }

    // ------------------------------------------------------------------
    // Builtin
    // ------------------------------------------------------------------

    public function test_builtin_apply_clones_fills_and_persists(): void
    {
        [$designer, $business] = $this->approvedDesignerBusiness();
        $this->enforce();

        $response = $this->apply($designer, $business, [
            'source' => 'builtin',
            'template_id' => self::CATALOG_ID,
        ])->assertOk();

        // Materialized: placeholders filled, ids regenerated.
        $this->assertSame($business->name, $response->json('card.design_json.layers.1.text'));
        $this->assertStringStartsWith('layer-', (string) $response->json('document.layers.0.id'));
        $this->assertSame('builtin', $response->json('template.source'));
        $this->assertTrue($response->json('studio.bypass') === false);

        $stored = $business->cards()->latest('id')->first();
        $this->assertNotNull($stored);
        $this->assertIsArray($stored->design_json);
        $this->assertSame($business->name, $stored->design_json['layers'][1]['text']);
    }

    public function test_builtin_apply_requires_the_plan_template_list(): void
    {
        [$designer, $business] = $this->approvedDesignerBusiness(['card_templates' => ['classic']], 'apply-noent');
        $this->enforce();

        $this->apply($designer, $business, [
            'source' => 'builtin',
            'template_id' => self::CATALOG_ID,
        ])->assertStatus(403);
    }

    public function test_a_client_supplied_document_is_ignored(): void
    {
        [$designer, $business] = $this->approvedDesignerBusiness([], 'apply-ignore');
        $this->enforce();

        $this->apply($designer, $business, [
            'source' => 'builtin',
            'template_id' => self::CATALOG_ID,
            'design_json' => $this->validDesign('HACKED'),
        ])->assertOk();

        $stored = $business->cards()->latest('id')->first();
        $this->assertIsArray($stored->design_json);
        $this->assertNotSame('HACKED', $stored->design_json['layers'][0]['text'] ?? null);
        foreach ($stored->design_json['layers'] as $layer) {
            $this->assertNotSame('HACKED', $layer['text'] ?? null);
        }
    }

    // ------------------------------------------------------------------
    // DB template (plan pivot)
    // ------------------------------------------------------------------

    public function test_db_template_apply_requires_the_plan_pivot(): void
    {
        [$designer, $business] = $this->approvedDesignerBusiness([], 'apply-db');
        $this->enforce();
        $planId = $business->subscriptions()->value('plan_id');

        $template = CardTemplate::create([
            'slug' => 'admin-apply-1',
            'name_fa' => 'قالب ادمین',
            'category' => 'general',
            'origin' => 'admin',
            'design_json' => json_encode($this->validDesign('از قالب'), JSON_UNESCAPED_UNICODE),
            'status' => 'approved',
        ]);

        $this->apply($designer, $business, ['source' => 'db', 'template_id' => $template->id])
            ->assertStatus(403);

        $template->plans()->sync([$planId]);

        $this->apply($designer, $business, ['source' => 'db', 'template_id' => $template->slug])
            ->assertOk()
            ->assertJsonPath('template.source', 'db');

        $this->assertSame('از قالب', $business->cards()->latest('id')->first()->design_json['layers'][0]['text']);
    }

    // ------------------------------------------------------------------
    // Personal template (owner-only, never bypassed)
    // ------------------------------------------------------------------

    public function test_personal_apply_is_owner_only_even_for_admins(): void
    {
        [$designer, $business] = $this->approvedDesignerBusiness(['custom_templates' => true], 'apply-personal');
        $this->enforce();

        $template = UserCardTemplate::create([
            'user_id' => $designer->id,
            'name_fa' => 'قالب شخصی',
            'category' => 'general',
            'design_json' => json_encode($this->validDesign('شخصی'), JSON_UNESCAPED_UNICODE),
        ]);

        // Owner → allowed.
        $this->apply($designer, $business, ['source' => 'personal', 'template_id' => $template->id])
            ->assertOk()
            ->assertJsonPath('template.source', 'personal');

        // Another approved designer → 403 (ownership is never bypassed).
        [$otherDesigner, $otherBusiness] = $this->approvedDesignerBusiness(['custom_templates' => true], 'apply-other');
        $this->apply($otherDesigner, $otherBusiness, ['source' => 'personal', 'template_id' => $template->id])
            ->assertStatus(403);

        // Admin (acting for a business they own) → still 403: the admin
        // bypass covers the CAPABILITY gate, never template ownership.
        $admin = $this->user(['admin']);
        [, $adminBusiness] = $this->approvedDesignerBusiness(['custom_templates' => true], 'apply-admin');
        $this->apply($admin, $adminBusiness, ['source' => 'personal', 'template_id' => $template->id])
            ->assertStatus(403)
            ->assertJsonPath('message', 'این قالب متعلق به شما نیست.');
    }

    public function test_personal_apply_requires_the_custom_templates_capability(): void
    {
        [$designer, $business] = $this->approvedDesignerBusiness([], 'apply-nocustom');
        $this->enforce();

        $template = UserCardTemplate::create([
            'user_id' => $designer->id,
            'name_fa' => 'قالب شخصی',
            'category' => 'general',
            'design_json' => json_encode($this->validDesign(), JSON_UNESCAPED_UNICODE),
        ]);

        $this->apply($designer, $business, ['source' => 'personal', 'template_id' => $template->id])
            ->assertStatus(403);
    }

    // ------------------------------------------------------------------
    // Gates around the pipeline
    // ------------------------------------------------------------------

    public function test_apply_is_blocked_for_non_designers_when_enforced(): void
    {
        $owner = $this->user(['business_owner']); // not approved
        $business = $this->business($owner, [
            'card_editor' => true,
            'card_templates' => [self::CATALOG_ID],
            'designer_studio' => true,
        ], 'apply-nongate');
        $this->enforce();

        $this->apply($owner, $business, ['source' => 'builtin', 'template_id' => self::CATALOG_ID])
            ->assertStatus(403)
            ->assertJsonPath('studio_errors.studio', 'not_approved');

        $this->assertNull($business->cards()->latest('id')->first()?->design_json);
    }

    public function test_apply_works_while_the_gate_is_dormant(): void
    {
        $owner = $this->user(['business_owner']); // not approved
        $business = $this->business($owner, [
            'card_editor' => true,
            'card_templates' => [self::CATALOG_ID],
        ], 'apply-dormant');

        $this->apply($owner, $business, ['source' => 'builtin', 'template_id' => self::CATALOG_ID])
            ->assertOk();
    }

    public function test_apply_enforces_the_design_capability_set(): void
    {
        // card_layer_kinds excludes `qr`, and the catalog template contains a
        // QR layer → the pipeline refuses to persist it.
        [$designer, $business] = $this->approvedDesignerBusiness([
            'card_layer_kinds' => ['text', 'shape'],
        ], 'apply-kinds');
        $this->enforce();

        $this->apply($designer, $business, ['source' => 'builtin', 'template_id' => self::CATALOG_ID])
            ->assertStatus(403)
            ->assertJsonPath('entitlement_errors.design_layer_kinds', 'locked');
    }

    public function test_admin_apply_acts_as_self_with_an_audited_bypass(): void
    {
        [, $business] = $this->approvedDesignerBusiness([], 'apply-own');
        $admin = $this->user(['admin']);
        $this->enforce();

        // An admin may act on ANY business (the standard authorizeOwner rule),
        // as THEMSELVES with an audited studio bypass.
        $this->actingAs($admin)
            ->postJson("/api/businesses/{$business->id}/card/template-apply", [
                'source' => 'builtin',
                'template_id' => self::CATALOG_ID,
            ])
            ->assertOk();

        $this->assertDatabaseHas('audit_events', ['event' => 'admin.studio_bypass', 'actor_id' => $admin->id]);
    }
}
