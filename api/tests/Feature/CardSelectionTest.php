<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\Plan;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Unified card-selection contract (P1 of the corrective plan).
 *
 *   show()  → the current (latest) card, whose `id` the client echoes back.
 *   save()  → an explicit `card_id` MUST belong to the business (403) and is
 *             the exact target; without it the legacy behavior is preserved.
 *   apply() → the same optional `card_id`.
 *
 * A card that is not the target is NEVER touched, and a foreign card_id can
 * never be used to write into another business' card.
 */
class CardSelectionTest extends TestCase
{
    use RefreshDatabase;

    private const CATALOG_ID = 'free-classic-navy';

    private function business(): Business
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');

        $business = $owner->businesses()->create([
            'name' => 'کسب‌وکار انتخاب کارت',
            'slug' => 'sel-'.fake()->unique()->regexify('[a-z0-9]{8}'),
            'category' => 'آز',
            'phone' => '09120000000',
            'status' => 'approved',
        ]);

        $plan = Plan::create([
            'name' => 'Select Plan',
            'price' => 100,
            'duration_days' => 30,
            'features' => [
                'card_editor' => true,
                'designer_studio' => true,
                'card_templates' => [self::CATALOG_ID],
                'max_cards' => 5,
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

    private function design(string $text = 'سلام'): array
    {
        return [
            'version' => 1,
            'artboard' => ['width' => 1050, 'height' => 600],
            'background' => '#f6f8fb',
            'layers' => [
                [
                    'id' => 't1', 'kind' => 'text',
                    'x' => 40, 'y' => 40, 'width' => 400, 'height' => 60,
                    'angle' => 0, 'opacity' => 1, 'locked' => false, 'hidden' => false,
                    'z' => 0, 'color' => '#0b1c33', 'background' => null,
                    'text' => $text, 'fontSize' => 40, 'fontWeight' => 700,
                    'align' => 'start', 'fontFamily' => 'vazir',
                ],
            ],
        ];
    }

    public function test_save_with_card_id_targets_only_that_card(): void
    {
        $business = $this->business();
        $owner = $business->owner;
        $first = $business->cards()->create(['template' => 'classic', 'theme' => 'navy', 'font_size' => 'medium', 'font_family' => 'sans']);
        $second = $business->cards()->create(['template' => 'local', 'theme' => 'navy', 'font_size' => 'medium', 'font_family' => 'sans']);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'card_id' => $first->id,
            'template' => 'classic',
            'design_json' => $this->design(),
        ])->assertOk();

        $this->assertNotNull($first->fresh()->design_json);
        $this->assertNull($second->fresh()->design_json);
    }

    public function test_save_with_a_foreign_card_id_is_forbidden(): void
    {
        $business = $this->business();
        $owner = $business->owner;
        $otherBusiness = $this->business();
        $foreign = $otherBusiness->cards()->create(['template' => 'classic']);

        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'card_id' => $foreign->id,
            'template' => 'classic',
            'design_json' => $this->design(),
        ])->assertStatus(403);

        $this->assertNull($foreign->fresh()->design_json);
    }

    public function test_apply_with_card_id_targets_only_that_card(): void
    {
        $business = $this->business();
        $owner = $business->owner;
        $first = $business->cards()->create(['template' => 'classic', 'theme' => 'navy', 'font_size' => 'medium', 'font_family' => 'sans']);
        $second = $business->cards()->create(['template' => 'local', 'theme' => 'navy', 'font_size' => 'medium', 'font_family' => 'sans']);

        $this->actingAs($owner)->postJson("/api/businesses/{$business->id}/card/template-apply", [
            'source' => 'builtin',
            'template_id' => self::CATALOG_ID,
            'card_id' => $second->id,
        ])->assertOk();

        $this->assertNull($first->fresh()->design_json);
        $this->assertNotNull($second->fresh()->design_json);
    }

    public function test_apply_with_a_foreign_card_id_is_forbidden(): void
    {
        $business = $this->business();
        $owner = $business->owner;
        $otherBusiness = $this->business();
        $foreign = $otherBusiness->cards()->create(['template' => 'classic']);

        $this->actingAs($owner)->postJson("/api/businesses/{$business->id}/card/template-apply", [
            'source' => 'builtin',
            'template_id' => self::CATALOG_ID,
            'card_id' => $foreign->id,
        ])->assertStatus(403);

        $this->assertNull($foreign->fresh()->design_json);
    }

    public function test_save_without_card_id_preserves_the_legacy_default(): void
    {
        $business = $this->business();
        $owner = $business->owner;
        $business->cards()->create(['template' => 'classic', 'theme' => 'navy', 'font_size' => 'medium', 'font_family' => 'sans']);

        // Same template as the stored row → updates it, creates nothing new.
        $this->actingAs($owner)->putJson("/api/businesses/{$business->id}/card", [
            'template' => 'classic',
            'design_json' => $this->design(),
        ])->assertOk();

        $this->assertSame(1, $business->cards()->count());
        $this->assertNotNull($business->cards()->first()->design_json);
    }
}
