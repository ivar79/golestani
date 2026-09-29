<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Phase 4 capability hardening — the LAYERED document under entitlement:
 *   card_layer_kinds / max_layers / card_premium_layer_kinds / max_premium_elements
 *
 * Contracts under test:
 *   - Disallowed kind / over-limit layer counts → 403 with machine-readable
 *     entitlement_errors (NEVER 422 — the document itself is well-formed).
 *   - GRANDFATHERING: the stored document is the baseline. Re-saving it
 *     verbatim is always allowed; only GROWTH beyond the current capability
 *     set is rejected (POLICY expired_card_access=readonly spirit).
 *   - Free-tier defaults mirror the pre-hardening behaviour exactly (all
 *     kinds allowed, 60 layers), so existing plans/tests keep passing.
 */
class CardCapabilityTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function businessWithFeatures(array $features): array
    {
        $owner = $this->owner();
        $business = $owner->businesses()->create([
            'name' => 'Cap', 'slug' => 'cap-'.fake()->unique()->regexify('[a-z0-9]{8}'), 'status' => 'approved',
        ]);
        $plan = Plan::create([
            'name' => 'Cap Plan', 'price' => 100, 'duration_days' => 30, 'features' => $features,
        ]);
        $business->subscriptions()->create([
            'plan_id' => $plan->id, 'status' => 'active',
            'start_date' => now(), 'end_date' => now()->addDays(30),
        ]);

        return [$owner, $business];
    }

    /** A well-formed document with $textLayers text layers and one QR layer. */
    private function design(int $textLayers = 1, ?string $extraKind = null): array
    {
        $layers = [];
        for ($i = 1; $i <= $textLayers; $i++) {
            $layers[] = [
                'id' => "t{$i}", 'kind' => 'text',
                'x' => 40, 'y' => 30 + $i, 'width' => 400, 'height' => 60,
                'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                'z' => 0, 'color' => '#0b1c33', 'background' => null,
                'text' => "متن {$i}", 'fontSize' => 40, 'fontWeight' => 700,
                'align' => 'start', 'fontFamily' => 'vazir',
            ];
        }
        if ($extraKind !== null) {
            $layers[] = $this->layerOf($extraKind, 'x1');
        }

        return [
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => '#f6f8fb',
            'layers' => $layers,
        ];
    }

    private function layerOf(string $kind, string $id): array
    {
        return match ($kind) {
            'qr' => [
                'id' => $id, 'kind' => 'qr', 'x' => 880, 'y' => 420, 'width' => 120, 'height' => 120,
                'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false, 'z' => 0,
                'color' => null, 'background' => null, 'text' => '',
                'payload' => 'demo', 'dark' => '#000000', 'light' => '#ffffff',
            ],
            'badge' => [
                'id' => $id, 'kind' => 'badge', 'x' => 40, 'y' => 500, 'width' => 160, 'height' => 40,
                'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false, 'z' => 0,
                'color' => '#ffffff', 'background' => '#0ea5e9',
                'style' => 'verified', 'text' => 'تأییدشده',
            ],
            'shape' => [
                'id' => $id, 'kind' => 'shape', 'x' => 500, 'y' => 500, 'width' => 120, 'height' => 60,
                'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false, 'z' => 0,
                'color' => null, 'background' => '#0ea5e9', 'shape' => 'rect', 'radius' => 8,
            ],
            'image' => [
                'id' => $id, 'kind' => 'image', 'x' => 600, 'y' => 40, 'width' => 200, 'height' => 120,
                'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false, 'z' => 0,
                'color' => null, 'background' => null,
                'src' => '/storage/cards/images/a.png', 'radius' => 12, 'objectFit' => 'cover',
            ],
            default => [
                'id' => $id, 'kind' => 'text', 'x' => 40, 'y' => 40, 'width' => 400, 'height' => 60,
                'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false, 'z' => 0,
                'color' => '#0b1c33', 'background' => null, 'text' => 'متن',
                'fontSize' => 40, 'fontWeight' => 700, 'align' => 'start', 'fontFamily' => 'vazir',
            ],
        };
    }

    private function saveDesign(User $owner, Business $business, array $design, array $extra = []): TestResponse
    {
        return $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", $extra + [
            'template' => 'classic', 'design_json' => $design,
        ]);
    }

    // ------------------------------------------------------------------
    // card_layer_kinds
    // ------------------------------------------------------------------

    public function test_disallowed_layer_kind_is_rejected_with_entitlement_error(): void
    {
        [$owner, $business] = $this->businessWithFeatures([
            'card_editor' => true,
            'card_layer_kinds' => ['text', 'qr'], // image/badge/shape NOT granted
        ]);

        $this->saveDesign($owner, $business, $this->design(1, 'badge'))
            ->assertStatus(403)
            ->assertJsonPath('entitlement_errors.design_layer_kinds', 'locked');
    }

    public function test_allowed_layer_kind_saves(): void
    {
        [$owner, $business] = $this->businessWithFeatures([
            'card_editor' => true,
            'card_layer_kinds' => ['text', 'qr', 'badge'],
        ]);

        $this->saveDesign($owner, $business, $this->design(1, 'badge'))->assertOk();
    }

    public function test_free_tier_defaults_allow_all_kinds(): void
    {
        // NO explicit kinds in the plan → free-tier default grants all five.
        [$owner, $business] = $this->businessWithFeatures(['card_editor' => true]);

        $design = $this->design(1);
        foreach (['image', 'badge', 'shape'] as $kind) {
            $design['layers'][] = $this->layerOf($kind, "k-{$kind}");
        }

        $this->saveDesign($owner, $business, $design)->assertOk();
    }

    public function test_stored_disallowed_kind_is_grandfathered_but_growth_is_blocked(): void
    {
        [$owner, $business] = $this->businessWithFeatures([
            'card_editor' => true,
            'card_layer_kinds' => ['text', 'image'],
        ]);

        // Save a document with ONE image layer while it is still allowed.
        $design = $this->design(1, 'image');
        $this->saveDesign($owner, $business, $design)->assertOk();

        // Plan no longer grants image kinds (snapshot frozen at activation —
        // emulate by a NEW subscription with tighter kinds, superseding).
        $tightPlan = Plan::create([
            'name' => 'Tight', 'price' => 100, 'duration_days' => 30,
            'features' => ['card_editor' => true, 'card_layer_kinds' => ['text']],
        ]);
        $business->subscriptions()->create([
            'plan_id' => $tightPlan->id, 'status' => 'active',
            'start_date' => now(), 'end_date' => now()->addDays(30),
        ]);

        // Verbatim re-save: allowed (grandfathering).
        $this->saveDesign($owner, $business, $design)->assertOk();

        // Growth: a SECOND image layer → rejected.
        $grown = $design;
        $grown['layers'][] = $this->layerOf('image', 'img-2');
        $this->saveDesign($owner, $business, $grown)
            ->assertStatus(403)
            ->assertJsonPath('entitlement_errors.design_layer_kinds', 'locked');
    }

    // ------------------------------------------------------------------
    // max_layers
    // ------------------------------------------------------------------

    public function test_max_layers_cap_blocks_growth(): void
    {
        [$owner, $business] = $this->businessWithFeatures([
            'card_editor' => true, 'max_layers' => 2,
        ]);

        $this->saveDesign($owner, $business, $this->design(2))->assertOk(); // exactly at cap
        $this->saveDesign($owner, $business, $this->design(3))
            ->assertStatus(403)
            ->assertJsonPath('entitlement_errors.max_layers', 'limit_reached');
    }

    public function test_null_max_layers_means_unlimited(): void
    {
        [$owner, $business] = $this->businessWithFeatures([
            'card_editor' => true, 'max_layers' => null,
        ]);

        $this->saveDesign($owner, $business, $this->design(5))->assertOk();
    }

    public function test_over_limit_stored_document_resaves_but_cannot_grow(): void
    {
        // Grant 5 layers, save a 5-layer document, then tighten to 3.
        [$owner, $business] = $this->businessWithFeatures([
            'card_editor' => true, 'max_layers' => 5,
        ]);
        $design = $this->design(5);
        $this->saveDesign($owner, $business, $design)->assertOk();

        $tightPlan = Plan::create([
            'name' => 'Tight Layers', 'price' => 100, 'duration_days' => 30,
            'features' => ['card_editor' => true, 'max_layers' => 3],
        ]);
        $business->subscriptions()->create([
            'plan_id' => $tightPlan->id, 'status' => 'active',
            'start_date' => now(), 'end_date' => now()->addDays(30),
        ]);

        // Verbatim re-save of the over-limit stored doc: grandfathered.
        $this->saveDesign($owner, $business, $design)->assertOk();

        // ANY growth (even back to 6) is rejected.
        $grown = $design;
        $grown['layers'][] = $this->layerOf('text', 't-extra');
        $this->saveDesign($owner, $business, $grown)
            ->assertStatus(403)
            ->assertJsonPath('entitlement_errors.max_layers', 'limit_reached');
    }

    // ------------------------------------------------------------------
    // max_premium_elements / card_premium_layer_kinds
    // ------------------------------------------------------------------

    public function test_premium_element_cap_blocks_growth(): void
    {
        [$owner, $business] = $this->businessWithFeatures([
            'card_editor' => true,
            'card_premium_layer_kinds' => ['badge'],
            'max_premium_elements' => 1,
        ]);

        $this->saveDesign($owner, $business, $this->design(1, 'badge'))->assertOk(); // 1 premium

        // Same document PLUS a second badge → 2 premium elements.
        $two = $this->design(1, 'badge');
        $two['layers'][] = $this->layerOf('badge', 'badge-2');
        $this->saveDesign($owner, $business, $two)
            ->assertStatus(403)
            ->assertJsonPath('entitlement_errors.max_premium_elements', 'limit_reached');
    }

    public function test_no_premium_kinds_configured_means_cap_dormant(): void
    {
        [$owner, $business] = $this->businessWithFeatures([
            'card_editor' => true,
            'card_premium_layer_kinds' => [], // dormant
            'max_premium_elements' => 0,
        ]);

        $design = $this->design(1);
        $design['layers'][] = $this->layerOf('badge', 'b1');
        $this->saveDesign($owner, $business, $design)->assertOk();
    }

    // ------------------------------------------------------------------
    // Structural vs entitlement separation
    // ------------------------------------------------------------------

    public function test_structurally_invalid_document_stays_422_not_403(): void
    {
        [$owner, $business] = $this->businessWithFeatures([
            'card_editor' => true, 'card_layer_kinds' => ['text'],
        ]);

        $bad = $this->design(1);
        $bad['version'] = 99;
        $this->saveDesign($owner, $business, $bad)->assertStatus(422);
    }

    // ------------------------------------------------------------------
    // lockedFields contract surface
    // ------------------------------------------------------------------

    public function test_show_reports_layer_capability_mirrors(): void
    {
        [$owner, $business] = $this->businessWithFeatures([
            'card_editor' => true,
            'card_layer_kinds' => ['text', 'qr'],
            'max_layers' => 12,
            'max_premium_elements' => null,
        ]);

        $locked = $this->actingAs($owner)
            ->getJson("/api/businesses/{$business->id}/card")
            ->assertOk()
            ->json('locked');

        $this->assertSame(['text', 'qr'], $locked['layer_kinds']);
        $this->assertSame(12, $locked['max_layers']);
        $this->assertNull($locked['max_premium_elements']);
    }
}
