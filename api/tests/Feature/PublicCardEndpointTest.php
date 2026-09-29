<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Public card read path (Phase 4 layered editor).
 *
 * Contract under test:
 *   - an APPROVED business publishes its card document, unauthenticated
 *   - a business that is not approved publishes nothing (404)
 *   - the payload is NARROW: render fields only, never owner/payment/entitlement data
 *   - resolution is by slug, so one business can never read another's document
 *   - a stored document that no longer validates degrades to null (legacy
 *     template) instead of 500-ing a public page
 */
class PublicCardEndpointTest extends TestCase
{
    use RefreshDatabase;

    private function owner(): User
    {
        $user = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $user->assignRole('business_owner');

        return $user;
    }

    private function business(User $owner, string $slug, string $status = 'approved'): Business
    {
        return $owner->businesses()->create(['name' => "کسب‌وکار {$slug}", 'slug' => $slug, 'status' => $status]);
    }

    private function attachPlan(Business $business): void
    {
        $plan = Plan::create([
            'name' => 'Editor Plan',
            'price' => 100,
            'duration_days' => 30,
            'features' => [
                'card_editor' => true,
                'card_layer_kinds' => ['text', 'image', 'qr', 'badge', 'shape', 'path'],
                // Scalars are entitlement-gated too, so the plan must grant the
                // template/theme/font the test publishes.
                'card_templates' => ['classic', 'midnight'],
                'card_themes' => ['navy', 'emerald'],
                'card_fonts' => ['sans', 'vazir', 'serif'],
            ],
        ]);
        $business->subscriptions()->create([
            'plan_id' => $plan->id,
            'status' => 'active',
            'start_date' => now(),
            'end_date' => now()->addDays(30),
        ]);
    }

    /** A minimally valid document as the validator expects it back. */
    private function design(string $text): array
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
                'text' => $text,
                'fontSize' => 40, 'fontWeight' => 800, 'align' => 'start',
                'fontFamily' => 'vazir',
                'italic' => false, 'underline' => false, 'strikethrough' => false,
                'lineHeight' => 1.25, 'letterSpacing' => 0,
            ]],
        ];
    }

    public function test_approved_business_publishes_its_card_document(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner, 'public-card-1');
        $this->attachPlan($business);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'midnight',
            'theme' => 'emerald',
            'font_size' => 'large',
            'font_family' => 'serif',
            'design_json' => $this->design('کارت عمومی'),
        ])->assertOk();

        // Unauthenticated read — a visitor has no token.
        $response = $this->getJson('/api/public/businesses/public-card-1/card')->assertOk();

        $this->assertSame('midnight', $response->json('template'));
        $this->assertSame('emerald', $response->json('theme'));
        $this->assertSame('large', $response->json('font_size'));
        $this->assertSame('serif', $response->json('font_family'));
        $this->assertSame(1, $response->json('design_json.version'));
        $this->assertSame('کارت عمومی', $response->json('design_json.layers.0.text'));
    }

    public function test_unapproved_business_card_is_not_publicly_readable(): void
    {
        $owner = $this->owner();
        $this->business($owner, 'public-card-draft', 'pending');

        $this->getJson('/api/public/businesses/public-card-draft/card')->assertNotFound();
    }

    public function test_business_without_a_card_returns_renderable_defaults(): void
    {
        $owner = $this->owner();
        $this->business($owner, 'public-card-nocard');

        $response = $this->getJson('/api/public/businesses/public-card-nocard/card')->assertOk();

        // The legacy template renderer needs usable scalars; the design is null
        // so the public page keeps rendering the pre-editor card.
        $this->assertSame('classic', $response->json('template'));
        $this->assertSame('navy', $response->json('theme'));
        $this->assertSame('medium', $response->json('font_size'));
        $this->assertSame('sans', $response->json('font_family'));
        $this->assertNull($response->json('design_json'));
    }

    public function test_malformed_stored_document_degrades_to_legacy_instead_of_failing(): void
    {
        $owner = $this->owner();
        $business = $this->business($owner, 'public-card-broken');

        // Force an unrenderable document past the write validator, exactly like
        // a row written by an older/newer schema version would be.
        $card = $business->cards()->create(['template' => 'classic', 'theme' => 'navy', 'font_size' => 'medium']);
        $card->forceFill(['design_json' => ['version' => 99, 'layers' => 'nope']])->save();

        $response = $this->getJson('/api/public/businesses/public-card-broken/card')->assertOk();

        // Degraded, not crashed, and the template scalars still render.
        $this->assertNull($response->json('design_json'));
        $this->assertSame('classic', $response->json('template'));
    }

    public function test_public_card_payload_exposes_only_render_fields(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $business = $this->business($owner, 'public-card-narrow');
        $this->attachPlan($business);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'design_json' => $this->design('محرمانه'),
        ])->assertOk();

        $keys = array_keys($this->getJson('/api/public/businesses/public-card-narrow/card')->json());
        sort($keys);

        // Payments, subscriptions, entitlements, owner ids and print files must
        // never travel through the public surface.
        $this->assertSame(
            ['design_json', 'font_family', 'font_size', 'template', 'theme'],
            $keys
        );
    }

    public function test_card_documents_are_isolated_per_slug(): void
    {
        Storage::fake('card_files');
        $owner = $this->owner();
        $first = $this->business($owner, 'public-card-iso-a');
        $second = $this->business($owner, 'public-card-iso-b');
        $this->attachPlan($first);
        $this->attachPlan($second);

        $this->actingAs($owner)->putJson("/api/businesses/{$first->id}/card", [
            'design_json' => $this->design('کارت الف'),
        ])->assertOk();
        $this->actingAs($owner)->putJson("/api/businesses/{$second->id}/card", [
            'design_json' => $this->design('کارت ب'),
        ])->assertOk();

        $this->assertSame('کارت الف', $this->getJson('/api/public/businesses/public-card-iso-a/card')->json('design_json.layers.0.text'));
        $this->assertSame('کارت ب', $this->getJson('/api/public/businesses/public-card-iso-b/card')->json('design_json.layers.0.text'));
    }
}
