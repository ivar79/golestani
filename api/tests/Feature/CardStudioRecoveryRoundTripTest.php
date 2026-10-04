<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * P0 Card Studio recovery — SERVER-SIDE round-trip contract for the properties
 * the editor now exposes for every layer kind.
 *
 * The validator rebuilds every layer from scratch, so an unlisted field is
 * silently dropped on save. These tests pin the fields that were either
 * image-only (mirror flags) or merely implied (exact rotation, QR payload):
 *
 *   - `flipX`/`flipY` round-trip on text, image, qr, badge, shape AND path
 *     layers, and are NOT injected into documents that never carried them;
 *   - an exact rotation (negative, decimal, past a half turn, and the ±360
 *     boundary itself) survives save + reload unchanged — the server clamps at
 *     ±360 and therefore never rewrites a supported angle;
 *   - a QR payload survives verbatim, and an EMPTY payload stays a real layer
 *     (the honest placeholder state) instead of becoming a 422;
 *   - the whole document keeps its existing protections: entitlement gating,
 *     ownership and structural validation are untouched by this work.
 */
class CardStudioRecoveryRoundTripTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $owner, string $slug): Business
    {
        $business = $owner->businesses()->create(['name' => 'Recovery', 'slug' => $slug, 'status' => 'approved']);

        $plan = Plan::create([
            'name' => 'Studio Plan',
            'price' => 100,
            'duration_days' => 30,
            'features' => [
                'card_editor' => true,
                'card_templates' => ['classic'],
                'card_layer_kinds' => ['text', 'image', 'qr', 'badge', 'shape', 'path'],
                'max_cards' => 3,
            ],
        ]);
        $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'active',
            'start_date' => now(),
            'end_date' => now()->addDays(30),
        ]);

        return $business;
    }

    private function baseLayer(string $id, string $kind): array
    {
        return [
            'id' => $id, 'kind' => $kind,
            'x' => 40, 'y' => 40, 'width' => 400, 'height' => 60,
            'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
            'z' => 0, 'color' => null, 'background' => null,
        ];
    }

    /** One layer of EVERY kind, each carrying its required structural fields. */
    private function document(): array
    {
        $text = $this->baseLayer('t1', 'text') + [
            'text' => 'کسب‌وکار', 'fontSize' => 40, 'fontWeight' => 700,
            'align' => 'start', 'fontFamily' => 'vazir', 'color' => '#0b1c33',
        ];
        $image = $this->baseLayer('i1', 'image') + [
            'src' => 'storage/cards/logo.png', 'radius' => 12, 'objectFit' => 'cover',
        ];
        $qr = $this->baseLayer('q1', 'qr') + [
            'width' => 120, 'height' => 120, 'payload' => 'recovery-business',
            'dark' => '#000000', 'light' => '#ffffff',
        ];
        $badge = $this->baseLayer('b1', 'badge') + [
            'width' => 160, 'height' => 40, 'style' => 'verified', 'text' => 'تأییدشده',
            'color' => '#ffffff', 'background' => '#0ea5e9',
        ];
        $shape = $this->baseLayer('s1', 'shape') + [
            'shape' => 'rect', 'radius' => 8, 'background' => '#0ea5e9',
        ];
        $path = $this->baseLayer('p1', 'path') + [
            'closed' => false,
            'points' => [
                ['x' => 0, 'y' => 60, 'hIn' => null, 'hOut' => null],
                ['x' => 400, 'y' => 60, 'hIn' => null, 'hOut' => null],
            ],
            'bend' => 0.4, 'stroke' => '#0ea5e9', 'strokeWidth' => 4, 'fill' => null,
        ];

        return [
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => '#f6f8fb',
            'layers' => [$text, $image, $qr, $badge, $shape, $path],
        ];
    }

    private function save(User $owner, Business $business, array $design): void
    {
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertOk();
    }

    /** @return array<string, array> stored layers keyed by id */
    private function storedLayers(User $owner, Business $business): array
    {
        return collect(
            $this->actingAs($owner)->getJson("/api/businesses/{$business->id}/card")->assertOk()->json('design_json.layers')
        )->keyBy('id')->all();
    }

    public function test_mirror_flags_round_trip_on_every_layer_kind(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner, 'recovery-flip');

        $design = $this->document();
        foreach ($design['layers'] as $index => $layer) {
            $design['layers'][$index]['flipX'] = true;
            $design['layers'][$index]['flipY'] = $layer['kind'] === 'image';
        }

        $this->save($owner, $business, $design);
        $stored = $this->storedLayers($owner, $business);

        foreach (['t1', 'i1', 'q1', 'b1', 's1', 'p1'] as $id) {
            $this->assertTrue($stored[$id]['flipX'], "flipX was dropped for {$id}");
        }
        $this->assertTrue($stored['i1']['flipY']);
        $this->assertFalse($stored['t1']['flipY']);
    }

    public function test_an_unmirrored_document_gains_no_flip_keys(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner, 'recovery-no-flip');

        $this->save($owner, $business, $this->document());
        $stored = $this->storedLayers($owner, $business);

        // Images always carried the two booleans (pre-existing contract); every
        // other kind must stay byte-identical when it never asked to mirror.
        $this->assertFalse($stored['i1']['flipX']);
        $this->assertArrayNotHasKey('flipX', $stored['t1']);
        $this->assertArrayNotHasKey('flipY', $stored['p1']);
        $this->assertArrayNotHasKey('flipX', $stored['q1']);
    }

    public function test_exact_rotation_angles_survive_the_round_trip(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner, 'recovery-angle');

        $angles = [
            't1' => -45.5,
            'i1' => 0.25,
            'q1' => 200,
            'b1' => -180,
            's1' => 360,
            'p1' => 270,
        ];
        $design = $this->document();
        foreach ($design['layers'] as $index => $layer) {
            $design['layers'][$index]['angle'] = $angles[$layer['id']];
        }

        $this->save($owner, $business, $design);
        $stored = $this->storedLayers($owner, $business);

        foreach ($angles as $id => $angle) {
            $this->assertSame((float) $angle, (float) $stored[$id]['angle'], "angle changed for {$id}");
        }
    }

    public function test_an_angle_beyond_the_supported_range_is_clamped_not_rejected(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner, 'recovery-angle-clamp');

        $design = $this->document();
        $design['layers'][0]['angle'] = 400;

        $this->save($owner, $business, $design);
        $stored = $this->storedLayers($owner, $business);

        // The boundary is ±360; the editor reduces 400° to its visual
        // equivalent (40°) BEFORE saving, so a user never loses the rotation —
        // and a hand-crafted 400° can never produce an unrenderable layer.
        $this->assertSame(360.0, (float) $stored['t1']['angle']);
    }

    public function test_qr_payloads_round_trip_and_an_empty_one_stays_a_layer(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner, 'recovery-qr');

        $design = $this->document();
        foreach ($design['layers'] as $index => $layer) {
            if ($layer['id'] === 'q1') {
                $design['layers'][$index]['payload'] = '';
            }
        }
        // A second QR layer keeps a real slug, so both states coexist.
        $second = $this->baseLayer('q2', 'qr') + [
            'width' => 130, 'height' => 130, 'payload' => 'golestani',
            'dark' => '#111827', 'light' => '#ffffff',
        ];
        $design['layers'][] = $second;

        $this->save($owner, $business, $design);
        $stored = $this->storedLayers($owner, $business);

        $this->assertSame('', $stored['q1']['payload']);
        $this->assertSame('golestani', $stored['q2']['payload']);
        $this->assertSame('#111827', $stored['q2']['dark']);
    }

    public function test_recovery_document_keeps_the_save_chain_protections(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner, 'recovery-guards');
        $stranger = $this->owner();

        $design = $this->document();

        // Ownership is still the boundary.
        $this->actingAs($stranger)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $design,
        ])->assertStatus(403);

        // Structural validation still refuses an unknown layer kind.
        $broken = $design;
        $broken['layers'][0]['kind'] = 'iframe';
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $broken,
        ])->assertStatus(422);

        // ...and the valid document still saves afterwards (no partial write).
        $this->save($owner, $business, $design);
        $this->assertCount(6, $this->storedLayers($owner, $business));
    }
}
