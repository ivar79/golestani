<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Designer;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Phase 4 layered-editor regression — design_json persistence:
 *   - owner saves and reloads the exact document (round-trip)
 *   - non-owner 403, unauthenticated 401
 *   - structurally invalid documents are 422 (whitelist, not blind storage)
 *   - free-tier card_editor gate: false → 403 with entitlement_errors
 *   - NULL design_json cards are returned verbatim (existing cards unaffected)
 */
class CardDesignJsonTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function attachPlan(Business $business, array $features): void
    {
        $plan = Plan::create([
            'name' => 'Editor Plan',
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
    }

    /**
     * The normalized document shape the validator returns (whitelisted
     * fields, defaults filled). Tests compare against THIS, not the raw
     * input — the contract is that the stored document is the clean one.
     */
    private function validDesign(): array
    {
        return [
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => '#f6f8fb',
            'layers' => [
                [
                    'id' => 'layer-1', 'kind' => 'text',
                    'x' => 48, 'y' => 40, 'width' => 500, 'height' => 60,
                    'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                    'z' => 0, 'color' => '#0b1c33', 'background' => null,
                    'text' => 'کسب‌وکار نمونه',
                    'fontSize' => 40, 'fontWeight' => 800, 'align' => 'start',
                    'fontFamily' => 'vazir',
                    'italic' => false, 'underline' => false, 'strikethrough' => false,
                    'lineHeight' => 1.25, 'letterSpacing' => 0,
                ],
                [
                    'id' => 'layer-2', 'kind' => 'qr',
                    'x' => 880, 'y' => 420, 'width' => 120, 'height' => 120,
                    'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                    'z' => 0, 'color' => null, 'background' => null,
                    'text' => '',
                    'payload' => 'https://inkart.test/b/demo',
                    'dark' => '#000000', 'light' => '#ffffff',
                ],
            ],
        ];
    }

    public function test_design_json_round_trips_for_owner(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D', 'slug' => 'design-json-1', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true, 'card_templates' => ['classic'], 'max_cards' => 3]);

        $design = $this->validDesign();
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertOk();

        $fetched = $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk();
        $this->assertSame($design, $fetched->json('design_json'));
    }

    public function test_non_owner_and_guest_cannot_save_design(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D2', 'slug' => 'design-json-2', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);
        $stranger = $this->owner();

        $this->actingAs($stranger)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $this->validDesign(),
        ])->assertForbidden();
        // Guest: the middleware/role stack answers 401/403 — the invariant is
        // that unauthenticated writers never reach the resource.
        $guest = $this->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $this->validDesign(),
        ]);
        $this->assertContains($guest->status(), [401, 403]);
    }

    public function test_invalid_design_documents_are_rejected(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D3', 'slug' => 'design-json-3', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        // Wrong version.
        $bad = $this->validDesign();
        $bad['version'] = 99;
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", ['design_json' => $bad])->assertStatus(422);

        // Unknown layer kind.
        $bad = $this->validDesign();
        $bad['layers'][0]['kind'] = 'iframe';
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", ['design_json' => $bad])->assertStatus(422);

        // Non-system image source (remote URL / data URI).
        $bad = $this->validDesign();
        $bad['layers'][] = ['id' => 'x9', 'kind' => 'image', 'x' => 0, 'y' => 0, 'width' => 10, 'height' => 10, 'src' => 'https://evil.example/x.png'];
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", ['design_json' => $bad])->assertStatus(422);

        // Non-hex color (XSS / url() payloads).
        $bad = $this->validDesign();
        $bad['layers'][0]['color'] = 'url(javascript:alert(1))';
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", ['design_json' => $bad])->assertStatus(422);
    }

    public function test_design_json_requires_card_editor_entitlement(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D4', 'slug' => 'design-json-4', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => false]); // paid plan but editor disabled

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $this->validDesign(),
        ])->assertStatus(403)->assertJsonPath('entitlement_errors.card_editor', 'locked');
    }

    public function test_path_layer_round_trips(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D6', 'slug' => 'design-json-6', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true, 'card_layer_kinds' => ['text', 'image', 'qr', 'badge', 'shape', 'path']]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'stroke-1', 'kind' => 'path',
            'x' => 98, 'y' => 98, 'width' => 54, 'height' => 14,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 5, 'color' => null, 'background' => null,
            // The validator normalizes a text key onto every layer.
            'text' => '',
            'closed' => false,
            'points' => [
                ['x' => 0, 'y' => 7, 'hIn' => null, 'hOut' => ['x' => 10, 'y' => 0]],
                ['x' => 25, 'y' => 0, 'hIn' => ['x' => 15, 'y' => 0], 'hOut' => ['x' => 35, 'y' => 7]],
                ['x' => 50, 'y' => 7, 'hIn' => ['x' => 40, 'y' => 7], 'hOut' => null],
            ],
            'stroke' => '#0ea5e9', 'strokeWidth' => 6,
            // Vector stroke decorations (order matches the validator's build order).
            'strokeStyle' => 'solid', 'strokeLinecap' => 'round', 'strokeLinejoin' => 'round', 'strokeOpacity' => 1,
            'fill' => null,
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertOk();

        $fetched = $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk();
        $this->assertSame($design, $fetched->json('design_json'));
    }

    /**
     * The VECTOR upgrade: polygon shapes and the full stroke decoration set
     * (dash pattern, cap, join, stroke alpha) must survive the whitelist.
     *
     * This is the test that fails if the validator is not extended — an
     * unlisted field is dropped on save, so the control would look broken after
     * a reload even though it worked in the browser.
     */
    public function test_vector_stroke_and_polygon_round_trip(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D10', 'slug' => 'design-json-10', 'status' => 'approved']);
        $this->attachPlan($business, [
            'card_editor' => true,
            'card_layer_kinds' => ['text', 'image', 'qr', 'badge', 'shape', 'path'],
        ]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'hex', 'kind' => 'shape',
            'x' => 100, 'y' => 100, 'width' => 200, 'height' => 200,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 6, 'color' => null, 'background' => 'linear-gradient(90deg, #0ea5e9 0%, #10b981 100%)',
            'text' => '',
            'shape' => 'polygon', 'radius' => 0, 'sides' => 7,
            'stroke' => '#0b1c33', 'strokeWidth' => 8,
            'strokeStyle' => 'dashed', 'strokeLinecap' => 'square',
            'strokeLinejoin' => 'bevel', 'strokeOpacity' => 0.5,
        ];
        $design['layers'][] = [
            'id' => 'curve', 'kind' => 'path',
            'x' => 300, 'y' => 300, 'width' => 120, 'height' => 60,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 7, 'color' => null, 'background' => null,
            'text' => '',
            'closed' => true,
            'points' => [
                ['x' => 4, 'y' => 4, 'hIn' => null, 'hOut' => ['x' => 40, 'y' => 4]],
                ['x' => 100, 'y' => 4, 'hIn' => ['x' => 70, 'y' => 4], 'hOut' => null],
                ['x' => 52, 'y' => 50, 'hIn' => null, 'hOut' => null],
            ],
            'stroke' => '#e11d48', 'strokeWidth' => 3,
            'strokeStyle' => 'dotted', 'strokeLinecap' => 'round',
            'strokeLinejoin' => 'miter', 'strokeOpacity' => 0.35,
            'fill' => '#fbbf24',
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertOk();

        $stored = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk()->json('design_json.layers')
        )->keyBy('id');

        $this->assertSame('polygon', $stored['hex']['shape']);
        $this->assertSame(7, $stored['hex']['sides']);
        $this->assertSame('dashed', $stored['hex']['strokeStyle']);
        $this->assertSame('square', $stored['hex']['strokeLinecap']);
        $this->assertSame('bevel', $stored['hex']['strokeLinejoin']);
        $this->assertSame(0.5, $stored['hex']['strokeOpacity']);
        $this->assertSame('linear-gradient(90deg, #0ea5e9 0%, #10b981 100%)', $stored['hex']['background']);

        $this->assertTrue($stored['curve']['closed']);
        $this->assertSame('dotted', $stored['curve']['strokeStyle']);
        $this->assertSame('miter', $stored['curve']['strokeLinejoin']);
        $this->assertSame(0.35, $stored['curve']['strokeOpacity']);
        $this->assertSame('#fbbf24', $stored['curve']['fill']);
        $this->assertCount(3, $stored['curve']['points']);
    }

    /** Unknown stroke values are NORMALIZED server-side, never stored as-is. */
    public function test_unknown_stroke_values_are_normalized(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D11', 'slug' => 'design-json-11', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'odd', 'kind' => 'shape',
            'x' => 0, 'y' => 0, 'width' => 100, 'height' => 100,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 1, 'color' => null, 'background' => '#0ea5e9',
            'shape' => 'polygon', 'radius' => 0, 'sides' => 99,
            'stroke' => '#000000', 'strokeWidth' => 4,
            'strokeStyle' => 'zigzag', 'strokeLinecap' => 'pointy',
            'strokeLinejoin' => 'curly', 'strokeOpacity' => 8,
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertOk();

        $stored = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->json('design_json.layers')
        )->keyBy('id')['odd'];

        $this->assertSame(12, $stored['sides']);
        $this->assertSame('solid', $stored['strokeStyle']);
        $this->assertSame('round', $stored['strokeLinecap']);
        $this->assertSame('round', $stored['strokeLinejoin']);
        $this->assertSame(1, $stored['strokeOpacity']);
    }

    /**
     * Phase 3 save-integrity: the luxury-material `effect` field must survive
     * the whitelist. This is the partial-save regression — the previous
     * validator dropped the field silently, so a gold/glass/neon material
     * vanished after save + reload while the canvas preview kept it.
     */
    public function test_luxury_effect_round_trips_and_unknown_values_are_dropped(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D11', 'slug' => 'design-json-11', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['layers'][0]['effect'] = 'gold';
        $design['layers'][1]['effect'] = 'glass';

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertOk();

        $stored = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->json('design_json.layers')
        )->values();

        $this->assertSame('gold', $stored[0]['effect']);
        $this->assertSame('glass', $stored[1]['effect']);

        // A hostile/typo'd value is dropped (not stored verbatim, not a 422 —
        // same contract as the other normalized decorations).
        $design['layers'][0]['effect'] = 'url(javascript:alert(1))';
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertOk();

        $second = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->json('design_json.layers')
        )->values();
        $this->assertArrayNotHasKey('effect', $second[0]);
        $this->assertSame('glass', $second[1]['effect']);
    }

    /**
     * A committed freehand ribbon that exceeds the OLD 20KB rawD cap must
     * still save: the structural cap was sized for Q→C-expanded ribbons
     * (60KB) and an unlimited tier never decimates geometry silently.
     */
    public function test_large_freehand_ribbon_within_structural_cap_round_trips(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D12', 'slug' => 'design-json-12', 'status' => 'approved']);
        $this->attachPlan($business, [
            'card_editor' => true,
            'card_layer_kinds' => ['text', 'image', 'qr', 'badge', 'shape', 'path'],
            'max_layers' => null,
        ]);

        // ~25KB of path data — over the old 20KB cap, under the structural 60KB.
        $points = [];
        for ($i = 0; $i < 900; $i++) {
            $points[] = sprintf('%s %s', 10 + $i * 7.25, 20 + sin($i) * 13);
        }
        $rawD = 'M 10.5 20.5 L '.implode(' ', $points);
        $this->assertGreaterThan(20_000, strlen($rawD));
        $this->assertLessThanOrEqual(60_000, strlen($rawD));

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'ribbon-1', 'kind' => 'path',
            'x' => 10, 'y' => 10, 'width' => 100, 'height' => 60,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 5, 'color' => null, 'background' => null, 'text' => '',
            'closed' => false, 'points' => [], 'rawD' => $rawD,
            'stroke' => '#0ea5e9', 'strokeWidth' => 6,
            'strokeStyle' => 'solid', 'strokeLinecap' => 'round', 'strokeLinejoin' => 'round', 'strokeOpacity' => 1,
            'fill' => null,
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertOk();

        $stored = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->json('design_json.layers')
        )->keyBy('id')['ribbon-1'];
        $this->assertSame($rawD, $stored['rawD']);
    }

    public function test_path_layer_rejects_too_few_and_too_many_points(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D7', 'slug' => 'design-json-7', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $base = [
            'id' => 'stroke-x', 'kind' => 'path',
            'x' => 0, 'y' => 0, 'width' => 10, 'height' => 10,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 1, 'color' => null, 'background' => null,
            'closed' => false, 'stroke' => '#0ea5e9', 'strokeWidth' => 6, 'fill' => null,
        ];

        // One point only.
        $bad = $this->validDesign();
        $bad['layers'][] = array_merge($base, ['points' => [['x' => 0, 'y' => 0]]]);
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", ['design_json' => $bad])->assertStatus(422);

        // Over the cap.
        $bad = $this->validDesign();
        $bad['layers'][] = array_merge($base, [
            'points' => array_fill(0, 501, ['x' => 0, 'y' => 0]),
        ]);
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", ['design_json' => $bad])->assertStatus(422);
    }

    public function test_legacy_card_without_design_json_is_returned_verbatim(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D5', 'slug' => 'design-json-5', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true, 'card_templates' => ['classic', 'midnight'], 'card_themes' => ['navy', 'warm']]);

        // Pre-editor card: scalars only, no design_json ever saved.
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'midnight', 'theme' => 'warm',
        ])->assertOk();

        $fetched = $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk();
        $this->assertSame('midnight', $fetched->json('template'));
        $this->assertSame('warm', $fetched->json('theme'));
        $this->assertNull($fetched->json('design_json'));
    }

    public function test_portfolio_file_is_deleted_with_the_record(): void
    {
        Storage::fake('public');
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('designer');
        $user->forceFill(['designer_status' => 'approved'])->save();
        $designer = Designer::create([
            'user_id' => $user->id,
            'display_name' => 'طراح تست',
            'slug' => 'designer-test-1',
            'referral_code' => 'DES-TST01',
            'status' => 'pending',
        ]);

        $path = UploadedFile::fake()->create('work.pdf', 50, 'application/pdf')->store('portfolios', 'public');
        $portfolio = $designer->portfolios()->create([
            'title' => 'نمونه', 'file_path' => $path, 'mime_type' => 'application/pdf',
            'file_size' => 50, 'status' => 'pending',
        ]);
        Storage::disk('public')->assertExists($path);

        $this->actingAs($user)->deleteJson("/api/designer/portfolios/{$portfolio->id}")->assertOk();
        Storage::disk('public')->assertMissing($path);
    }

    /**
     * The full editor workflow document: gradient background, advanced
     * typography, the new shape kinds with strokes, image mirror flags and a
     * freehand path — all must round-trip through the whitelist validator.
     */
    public function test_full_editor_design_round_trips(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D8', 'slug' => 'design-json-8', 'status' => 'approved']);
        $this->attachPlan($business, [
            'card_editor' => true,
            'card_layer_kinds' => ['text', 'image', 'qr', 'badge', 'shape', 'path'],
        ]);

        $design = [
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => 'linear-gradient(135deg, #0b1c33 0%, #0ea5e9 100%)',
            'layers' => [
                [
                    'id' => 'accent', 'kind' => 'shape',
                    'x' => 64, 'y' => 200, 'width' => 300, 'height' => 12,
                    'angle' => 0, 'opacity' => 0.9, 'locked' => false, 'hidden' => false,
                    'z' => 3, 'color' => null, 'background' => '#0ea5e9',
                    'shape' => 'arrow', 'radius' => 0, 'stroke' => '#0b1c33', 'strokeWidth' => 2,
                ],
                [
                    'id' => 'star', 'kind' => 'shape',
                    'x' => 700, 'y' => 420, 'width' => 80, 'height' => 80,
                    'angle' => 15, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                    'z' => 4, 'color' => null, 'background' => '#fbbf24',
                    'shape' => 'star', 'radius' => 0, 'stroke' => null, 'strokeWidth' => 0,
                ],
                [
                    'id' => 'divider', 'kind' => 'shape',
                    'x' => 64, 'y' => 500, 'width' => 600, 'height' => 4,
                    'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                    'z' => 5, 'color' => null, 'background' => 'rgba(255,255,255,0.4)',
                    'shape' => 'line', 'radius' => 0, 'stroke' => null, 'strokeWidth' => 0,
                ],
                [
                    'id' => 'title', 'kind' => 'text',
                    'x' => 64, 'y' => 88, 'width' => 620, 'height' => 90,
                    'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                    'z' => 2, 'color' => '#ffffff', 'background' => null,
                    'text' => 'کسب‌وکار حرفه‌ای',
                    'fontSize' => 56, 'fontWeight' => 800, 'align' => 'start',
                    'fontFamily' => 'vazir',
                    'italic' => true, 'underline' => false, 'strikethrough' => false,
                    'lineHeight' => 1.3, 'letterSpacing' => -1.5,
                ],
                [
                    'id' => 'logo', 'kind' => 'image',
                    'x' => 850, 'y' => 80, 'width' => 136, 'height' => 136,
                    'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                    'z' => 1, 'color' => null, 'background' => null,
                    'src' => '/storage/logos/test.png', 'radius' => 24, 'objectFit' => 'cover',
                    'flipX' => true, 'flipY' => false,
                ],
            ],
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertOk();

        $fetched = $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk();
        $stored = $fetched->json('design_json');
        $this->assertSame($design['background'], $stored['background']);

        $byId = collect($stored['layers'])->keyBy('id');
        $this->assertSame('arrow', $byId['accent']['shape']);
        $this->assertSame('#0b1c33', $byId['accent']['stroke']);
        $this->assertSame(2, $byId['accent']['strokeWidth']);
        $this->assertSame('star', $byId['star']['shape']);
        $this->assertSame('line', $byId['divider']['shape']);
        $this->assertSame('rgba(255,255,255,0.4)', $byId['divider']['background']);
        $this->assertTrue($byId['title']['italic']);
        $this->assertSame(1.3, $byId['title']['lineHeight']);
        $this->assertSame(-1.5, $byId['title']['letterSpacing']);
        $this->assertTrue($byId['logo']['flipX']);
        $this->assertFalse($byId['logo']['flipY']);
    }

    /**
     * Gradients are the ONLY non-solid backgrounds allowed; a url() or
     * expression background is rejected as a 422 (never stored).
     */
    public function test_unsafe_background_is_rejected(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D9', 'slug' => 'design-json-9', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        foreach (['url(https://evil.com/x.png)', 'var(--x)', 'javascript:alert(1)'] as $bad) {
            $design = $this->validDesign();
            $design['background'] = $bad;
            $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
                'design_json' => $design,
            ])->assertStatus(422);
        }
    }

    /**
     * rawD PATH LAYERS — the freehand brush and the heritage ornaments carry
     * their geometry as SVG path data and legitimately have points: []. Before
     * the validator knew about rawD, every such save was a 422 ("تعداد نقاط
     * مسیر نامعتبر است") — a drawn stroke or an applied VIP template could
     * never be saved. This is the ROOT CAUSE of the reported 422.
     */
    public function test_raw_d_path_layer_round_trips(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D12', 'slug' => 'design-json-12', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true, 'card_layer_kinds' => ['text', 'image', 'qr', 'badge', 'shape', 'path']]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'brush', 'kind' => 'path', 'name' => 'قلم آزاد',
            'x' => 90, 'y' => 90, 'width' => 54, 'height' => 22,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 8, 'color' => '#22d3ee', 'background' => null,
            'text' => '',
            'closed' => true, 'points' => [],
            'rawD' => 'M 0 0 Q 10 22 27 11 Q 44 0 54 11 Q 40 22 27 22 Q 14 22 0 11 Z',
            'stroke' => null, 'strokeWidth' => 0, 'fill' => '#22d3ee',
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertOk();

        $stored = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk()->json('design_json.layers')
        )->keyBy('id')['brush'];

        $this->assertSame([], $stored['points']);
        $this->assertSame($design['layers'][2]['rawD'], $stored['rawD']);
        $this->assertSame('#22d3ee', $stored['fill']);
        $this->assertSame('قلم آزاد', $stored['name']);
    }

    /** A 2-point curved line persists the canonical `bend` (legacy `curvature` too). */
    public function test_curved_line_bend_round_trips(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D13', 'slug' => 'design-json-13', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true, 'card_layer_kinds' => ['text', 'image', 'qr', 'badge', 'shape', 'path']]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'arc', 'kind' => 'path', 'name' => 'خط منحنی',
            'x' => 100, 'y' => 280, 'width' => 500, 'height' => 100,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 9, 'color' => null, 'background' => null,
            'text' => '',
            'closed' => false,
            'points' => [
                ['x' => 0, 'y' => 100, 'hIn' => null, 'hOut' => null],
                ['x' => 500, 'y' => 100, 'hIn' => null, 'hOut' => null],
            ],
            'bend' => 0.5,
            'stroke' => '#0ea5e9', 'strokeWidth' => 4, 'fill' => null,
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertOk();

        $stored = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk()->json('design_json.layers')
        )->keyBy('id')['arc'];

        $this->assertSame(0.5, $stored['bend']);
        $this->assertSame('خط منحنی', $stored['name']);
    }

    /**
     * rawD is NEVER blind-trusted: it becomes the `d` attribute of an SVG
     * element in the canvas, the export and the PUBLIC card, so only the SVG
     * path grammar is accepted. Every one of these is a 422.
     */
    public function test_malformed_raw_d_is_rejected(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D14', 'slug' => 'design-json-14', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $badPaths = [
            'HTML/script injection' => 'M 0 0 L <script>alert(1)</script>',
            'external reference' => 'M 0 0 L 10 10 url(https://evil.com/x.svg)',
            'attribute breakout' => 'M 0 0 " onmouseover="alert(1)',
            'css expression' => 'M 0 0 L 10 10 ; } .x{fill:red}',
            'not starting with a moveto' => 'L 0 0 L 10 10',
            'arc without its 7 arguments' => 'M 0 0 A 50 50 0 0',
            'unbalanced curve arguments' => 'M 0 0 C 10 10 20 20',
            'unknown command' => 'M 0 0 X 10 10',
            'non-numeric garbage' => 'M abc def',
            'trailing junk after closepath' => 'M 0 0 L 10 10 Z 5 6',
        ];

        foreach ($badPaths as $label => $rawD) {
            $design = $this->validDesign();
            $design['layers'][] = [
                'id' => 'evil', 'kind' => 'path',
                'x' => 0, 'y' => 0, 'width' => 10, 'height' => 10,
                'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                'z' => 1, 'color' => null, 'background' => null,
                'text' => '',
                'closed' => true, 'points' => [],
                'rawD' => $rawD,
                'stroke' => null, 'strokeWidth' => 0, 'fill' => '#0ea5e9',
            ];

            $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
                'design_json' => $design,
            ])->assertStatus(422, "rawD must be rejected: {$label}");
        }
    }

    /** A path with neither anchors nor rawD is still nothing drawable. */
    public function test_path_without_geometry_is_still_rejected(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D15', 'slug' => 'design-json-15', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'empty', 'kind' => 'path',
            'x' => 0, 'y' => 0, 'width' => 10, 'height' => 10,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 1, 'color' => null, 'background' => null,
            'text' => '',
            'closed' => true, 'points' => [],
            'stroke' => null, 'strokeWidth' => 0, 'fill' => null,
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertStatus(422);
    }

    /** rawD is length-capped so one path cannot swallow the document budget.
     *  Sized against the RAISED structural cap (60KB) — the old 20KB cap
     *  rejected legitimate large freehand ribbons (422 partial saves). */
    public function test_oversized_raw_d_is_rejected(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D16', 'slug' => 'design-json-16', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'huge', 'kind' => 'path',
            'x' => 0, 'y' => 0, 'width' => 10, 'height' => 10,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 1, 'color' => null, 'background' => null,
            'text' => '',
            'closed' => true, 'points' => [],
            'rawD' => 'M 0 0 '.str_repeat('L 1 1 ', 20000), // ~120KB — well over the 60KB structural cap
            'stroke' => null, 'strokeWidth' => 0, 'fill' => '#0ea5e9',
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertStatus(422);
    }

    /**
     * Live-Paint region paint must survive the write boundary.
     *
     * Paint is attached to FACES produced by intersecting paths, so the
     * round-trip contract is: paths keep their own geometry, and the region
     * styles come back attached to the same topology keys. Losing this would
     * silently erase a user's colouring on reload.
     */
    public function test_region_paint_and_settings_round_trip(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D17', 'slug' => 'design-json-17', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['regions'] = [
            ['key' => 'divider+rect@26,50', 'fill' => 'solid', 'color' => '#d4af37'],
            ['key' => 'divider+rect@76,50', 'fill' => 'linear', 'color' => '#7c3aed', 'color2' => '#0ea5e9', 'angle' => 45, 'opacity' => 0.8],
        ];
        $design['regionSettings'] = ['gapTolerance' => 4, 'fillRule' => 'evenodd'];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertOk();

        $fetched = $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk();
        $stored = $fetched->json('design_json');

        $this->assertSame($design['regions'], $stored['regions']);
        // json_encode drops the trailing .0, so the stored ints are the wire format.
        $this->assertSame(['gapTolerance' => 4, 'fillRule' => 'evenodd'], $stored['regionSettings']);
        // Paths keep their own identity — paint is NOT baked into the geometry.
        $this->assertCount(count($design['layers']), $stored['layers']);
    }

    /** Documents saved before the region system must round-trip byte-identically. */
    public function test_design_without_regions_stays_unchanged(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D18', 'slug' => 'design-json-18', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertOk();

        $stored = $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->json('design_json');
        $this->assertArrayNotHasKey('regions', $stored);
        $this->assertArrayNotHasKey('regionSettings', $stored);
    }

    /** Hostile region payloads are rejected instead of stored. */
    public function test_invalid_region_payloads_are_rejected(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D19', 'slug' => 'design-json-19', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);
        $url = "/api/businesses/{$business->id}/card";

        // CSS injection through a region colour.
        $bad = $this->validDesign();
        $bad['regions'] = [['key' => 'a@0,0', 'fill' => 'solid', 'color' => 'url(javascript:alert(1))']];
        $this->actingAs($owner)->putJson($url, ['design_json' => $bad])->assertStatus(422);

        // Missing topology key.
        $bad = $this->validDesign();
        $bad['regions'] = [['fill' => 'solid', 'color' => '#ffffff']];
        $this->actingAs($owner)->putJson($url, ['design_json' => $bad])->assertStatus(422);

        // Unbounded region list.
        $bad = $this->validDesign();
        $bad['regions'] = array_map(
            fn ($i) => ['key' => "p@{$i},{$i}", 'fill' => 'solid', 'color' => '#ffffff'],
            range(1, 250),
        );
        $this->actingAs($owner)->putJson($url, ['design_json' => $bad])->assertStatus(422);
    }

    /** An unknown fill kind degrades to solid rather than aborting a save. */
    public function test_unknown_region_fill_kind_is_normalized(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D20', 'slug' => 'design-json-20', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['regions'] = [['key' => 'a@0,0', 'fill' => 'hologram', 'color' => '#d4af37', 'opacity' => 9]];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertOk();

        $stored = $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->json('design_json');
        $this->assertSame('solid', $stored['regions'][0]['fill']);
        // Clamped into 0..1 and serialised without a trailing .0.
        $this->assertSame(1, $stored['regions'][0]['opacity']);
    }

    /**
     * §4 — the parametric curve record is the ONLY thing that makes a curve
     * re-editable. If the validator drops it, the layer silently becomes a baked
     * path after a reload and every parameter control goes dead.
     */
    public function test_parametric_curve_record_round_trips(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D21', 'slug' => 'design-json-21', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'wave', 'kind' => 'path', 'pathMode' => 'curve', 'name' => 'منحنی',
            'x' => 200, 'y' => 260, 'width' => 620, 'height' => 180,
            'angle' => 12.5, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 11, 'color' => null, 'background' => null,
            'closed' => false,
            'points' => [
                ['x' => 0, 'y' => 90, 'hIn' => null, 'hOut' => ['x' => 20, 'y' => 60]],
                ['x' => 600, 'y' => 90, 'hIn' => ['x' => 580, 'y' => 60], 'hOut' => null],
            ],
            'curve' => [
                'kind' => 'sine',
                'length' => 600,
                'amplitude' => 80,
                'frequency' => 2.5,
                'phase' => 45.5,
                'symmetry' => 0.25,
                'startTangent' => null,
                'endTangent' => -30,
                'reversed' => true,
                'nodes' => 12,
                'chordAngle' => 17.3,
            ],
            'stroke' => '#0ea5e9', 'strokeWidth' => 4, 'fill' => null,
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertOk();

        $stored = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk()->json('design_json.layers')
        )->keyBy('id')['wave'];

        $this->assertSame('sine', $stored['curve']['kind']);
        $this->assertSame(600, $stored['curve']['length']);
        $this->assertSame(80, $stored['curve']['amplitude']);
        $this->assertSame(2.5, $stored['curve']['frequency']);
        $this->assertSame(45.5, $stored['curve']['phase']);
        $this->assertSame(0.25, $stored['curve']['symmetry']);
        // A null tangent means "natural" — it must NOT come back as 0, which
        // would flatten the end of the wave on the next edit.
        $this->assertNull($stored['curve']['startTangent']);
        $this->assertSame(-30, $stored['curve']['endTangent']);
        $this->assertTrue($stored['curve']['reversed']);
        // Editable node count and chord direction survive exactly. A fractional
        // rotation (17.3°) must not be rounded away, and the node count must not
        // drift off the ladder.
        $this->assertSame(12, $stored['curve']['nodes']);
        $this->assertSame(17.3, $stored['curve']['chordAngle']);
        $this->assertSame(12.5, $stored['angle']);
        $this->assertSame('curve', $stored['pathMode']);
    }

    /** A tampered node count snaps onto the ladder instead of exploding anchors. */
    public function test_curve_node_count_snaps_onto_the_ladder(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D23', 'slug' => 'design-json-23', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'nodes', 'kind' => 'path', 'pathMode' => 'curve',
            'x' => 0, 'y' => 0, 'width' => 10, 'height' => 10,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 1, 'color' => null, 'background' => null,
            'closed' => false,
            'points' => [
                ['x' => 0, 'y' => 0, 'hIn' => null, 'hOut' => null],
                ['x' => 10, 'y' => 10, 'hIn' => null, 'hOut' => null],
            ],
            'curve' => ['kind' => 'sine', 'nodes' => 9999, 'chordAngle' => 900],
            'stroke' => '#0ea5e9', 'strokeWidth' => 4, 'fill' => null,
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertOk();

        $stored = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk()->json('design_json.layers')
        )->keyBy('id')['nodes'];

        $this->assertSame(16, $stored['curve']['nodes']);
        $this->assertSame(360.0, (float) $stored['curve']['chordAngle']);
    }

    /** Impossible curve values are clamped; unknown keys never ride along. */
    public function test_curve_record_is_clamped_and_unknown_kind_falls_back(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D22', 'slug' => 'design-json-22', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'weird', 'kind' => 'path',
            'x' => 0, 'y' => 0, 'width' => 10, 'height' => 10,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 1, 'color' => null, 'background' => null,
            'closed' => false,
            'points' => [
                ['x' => 0, 'y' => 0, 'hIn' => null, 'hOut' => null],
                ['x' => 10, 'y' => 10, 'hIn' => null, 'hOut' => null],
            ],
            'curve' => [
                'kind' => 'hologram',
                'length' => 999999,
                'amplitude' => -20,
                'frequency' => 900,
                'phase' => 5000,
                'symmetry' => 3,
                'startTangent' => 'nan',
                'endTangent' => 9000,
                'reversed' => 'yes',
                'evil' => 'DROP TABLE',
            ],
            'stroke' => '#0ea5e9', 'strokeWidth' => 4, 'fill' => null,
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertOk();

        $curve = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk()->json('design_json.layers')
        )->keyBy('id')['weird']['curve'];

        $this->assertSame('sine', $curve['kind']);       // unknown kind → the default family
        $this->assertSame(20000, $curve['length']);      // clamped to the hard cap
        $this->assertSame(0, $curve['amplitude']);       // negatives floor at 0
        $this->assertSame(24, $curve['frequency']);
        $this->assertSame(360, $curve['phase']);
        $this->assertSame(0.95, $curve['symmetry']);
        $this->assertNull($curve['startTangent']);       // non-numeric → natural
        $this->assertSame(360, $curve['endTangent']);    // clamped, not rejected
        $this->assertFalse($curve['reversed']);          // only a real true is true
        $this->assertArrayNotHasKey('evil', $curve);
    }

    /** §14 — an explicit dash pattern must survive the save/reload cycle. */
    public function test_explicit_dash_pattern_and_offset_round_trip(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D23', 'slug' => 'design-json-23', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'dashed', 'kind' => 'path',
            'x' => 0, 'y' => 0, 'width' => 300, 'height' => 60,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 1, 'color' => null, 'background' => null,
            'closed' => false,
            'points' => [
                ['x' => 0, 'y' => 0, 'hIn' => null, 'hOut' => null],
                ['x' => 300, 'y' => 0, 'hIn' => null, 'hOut' => null],
            ],
            'stroke' => '#0ea5e9', 'strokeWidth' => 3,
            'strokeDasharray' => [12, 4.5, 0, 99999],
            'strokeDashoffset' => -7,
            'fill' => null,
        ];
        $design['layers'][] = [
            'id' => 'dashed-shape', 'kind' => 'shape', 'shape' => 'rect', 'radius' => 8,
            'x' => 0, 'y' => 0, 'width' => 100, 'height' => 40,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 2, 'color' => null, 'background' => '#ffffff',
            'stroke' => '#000000', 'strokeWidth' => 2,
            'strokeDasharray' => [6, 3],
            'strokeDashoffset' => 2,
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertOk();

        $layers = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk()->json('design_json.layers')
        )->keyBy('id');

        // Segments are clamped into 0.01..400 — including the 0 and the 99999.
        $this->assertSame([12, 4.5, 0.01, 400], $layers['dashed']['strokeDasharray']);
        $this->assertSame(-7, $layers['dashed']['strokeDashoffset']);
        // Shapes carry the same stroke model as paths.
        $this->assertSame([6, 3], $layers['dashed-shape']['strokeDasharray']);
        $this->assertSame(2, $layers['dashed-shape']['strokeDashoffset']);
    }

    /** §13 — the per-path fill rule round-trips, and the default is not written. */
    public function test_path_fill_rule_round_trips_and_default_is_omitted(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D24', 'slug' => 'design-json-24', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'donut', 'kind' => 'path',
            'x' => 0, 'y' => 0, 'width' => 200, 'height' => 200,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 1, 'color' => null, 'background' => null,
            'closed' => true,
            'points' => [
                ['x' => 0, 'y' => 0, 'hIn' => null, 'hOut' => null],
                ['x' => 200, 'y' => 0, 'hIn' => null, 'hOut' => null],
                ['x' => 200, 'y' => 200, 'hIn' => null, 'hOut' => null],
            ],
            'fillRule' => 'evenodd',
            'stroke' => null, 'strokeWidth' => 0.5, 'fill' => '#111827',
        ];
        $design['layers'][] = [
            'id' => 'plain', 'kind' => 'path',
            'x' => 0, 'y' => 0, 'width' => 200, 'height' => 200,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 2, 'color' => null, 'background' => null,
            'closed' => true,
            'points' => [
                ['x' => 0, 'y' => 0, 'hIn' => null, 'hOut' => null],
                ['x' => 200, 'y' => 0, 'hIn' => null, 'hOut' => null],
                ['x' => 200, 'y' => 200, 'hIn' => null, 'hOut' => null],
            ],
            'fillRule' => 'nonsense',
            'stroke' => null, 'strokeWidth' => 0.5, 'fill' => '#111827',
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertOk();

        $layers = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk()->json('design_json.layers')
        )->keyBy('id');

        $this->assertSame('evenodd', $layers['donut']['fillRule']);
        // An unrecognised rule is dropped rather than stored (SVG default applies).
        $this->assertArrayNotHasKey('fillRule', $layers['plain']);
    }

    /** Documents written before this upgrade gain no new keys. */
    public function test_documents_without_curve_dash_or_fill_rule_are_unchanged(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $owner->businesses()->create(['name' => 'D25', 'slug' => 'design-json-25', 'status' => 'approved']);
        $this->attachPlan($business, ['card_editor' => true]);

        $design = $this->validDesign();
        $design['layers'][] = [
            'id' => 'legacy', 'kind' => 'path',
            'x' => 0, 'y' => 0, 'width' => 300, 'height' => 60,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 1, 'color' => null, 'background' => null,
            'closed' => false,
            'points' => [
                ['x' => 0, 'y' => 0, 'hIn' => null, 'hOut' => null],
                ['x' => 300, 'y' => 0, 'hIn' => null, 'hOut' => null],
            ],
            'stroke' => '#0ea5e9', 'strokeWidth' => 3, 'fill' => null,
        ];

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $design,
        ])->assertOk();

        $stored = collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk()->json('design_json.layers')
        )->keyBy('id')['legacy'];

        foreach (['curve', 'strokeDasharray', 'strokeDashoffset', 'fillRule', 'pathMode'] as $key) {
            $this->assertArrayNotHasKey($key, $stored, "an untouched document must not gain " . $key);
        }
    }
}
