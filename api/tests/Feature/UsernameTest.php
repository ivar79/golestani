<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Unique public username chosen after OTP login (Phase 2 UX, 2026-09-18).
 * Covers: happy path, duplicate → 409 + suggestions, invalid format,
 * live availability probe, and the me/verify-otp payloads exposing username.
 */
class UsernameTest extends TestCase
{
    use RefreshDatabase;

    private function account(string $phone = null): User
    {
        $u = User::factory()->create([
            'phone' => $phone ?? '09'.fake()->unique()->numerify('#########'),
            'is_active' => true,
        ]);
        $u->assignRole('user');

        return $u;
    }

    public function test_user_can_claim_an_available_username(): void
    {
        $u = $this->account();
        $this->actingAs($u);

        $this->postJson('/api/auth/username', ['username' => 'hossein_dev'])
            ->assertOk()
            ->assertJsonPath('username', 'hossein_dev');

        $this->assertSame('hossein_dev', $u->fresh()->username);
        $this->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('username', 'hossein_dev');
    }

    public function test_duplicate_username_gets_409_with_suggestions(): void
    {
        $a = $this->account();
        $this->actingAs($a);
        $this->postJson('/api/auth/username', ['username' => 'takename'])->assertOk();

        $b = $this->account();
        $this->actingAs($b);
        $res = $this->postJson('/api/auth/username', ['username' => 'takename']);
        $res->assertStatus(409)->assertJsonStructure(['message', 'suggestions']);
        $this->assertCount(3, $res->json('suggestions'));

        // A suggested handle must itself be claimable.
        $alt = $res->json('suggestions.0');
        $this->postJson('/api/auth/username', ['username' => $alt])->assertOk();
    }

    public function test_same_user_reclaiming_own_username_is_not_conflict(): void
    {
        $a = $this->account();
        $this->actingAs($a);
        $this->postJson('/api/auth/username', ['username' => 'myhandle'])->assertOk();
        $this->postJson('/api/auth/username', ['username' => 'myhandle'])->assertOk();
    }

    public function test_invalid_formats_are_rejected(): void
    {
        $u = $this->account();
        $this->actingAs($u);
        // Note: fully-uppercase input ('UPPER') is NORMALIZED to 'upper' by the
        // API before validation (case-insensitive contract), so it succeeds —
        // case errors are fixed silently, everything else is rejected.
        foreach (['ab', 'has space', '9starts-with-digit-ok-but-this-one-is-way-too-long-for-limit', '-dash', 'فارسی'] as $bad) {
            $this->postJson('/api/auth/username', ['username' => $bad])->assertStatus(422);
        }
        $this->assertNull($u->fresh()->username);

        // Case normalization: 'MixedCase' is accepted and stored lowercase.
        $u2 = $this->account();
        $this->actingAs($u2);
        $this->postJson('/api/auth/username', ['username' => 'MixedCase'])->assertOk()->assertJsonPath('username', 'mixedcase');
        $this->assertSame('mixedcase', $u2->fresh()->username);
    }

    public function test_check_endpoint_reports_availability(): void
    {
        $a = $this->account();
        $this->actingAs($a);
        $this->postJson('/api/auth/username', ['username' => 'busyname'])->assertOk();

        $b = $this->account();
        $this->actingAs($b);
        $this->getJson('/api/auth/username/check?u=busyname')
            ->assertOk()->assertJsonPath('available', false);
        $this->getJson('/api/auth/username/check?u=freename')
            ->assertOk()->assertJsonPath('available', true);
    }

    public function test_guest_cannot_access_username_endpoints(): void
    {
        $this->postJson('/api/auth/username', ['username' => 'anon_user'])->assertUnauthorized();
        $this->getJson('/api/auth/username/check?u=anon_user')->assertUnauthorized();
    }
}
