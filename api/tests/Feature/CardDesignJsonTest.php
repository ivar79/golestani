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
        $user->assignRole('user');
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
}
