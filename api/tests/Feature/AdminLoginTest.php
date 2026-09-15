<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Focused tests for POST /api/auth/admin/login (AuthController::loginAdmin).
 *
 * test_persian_digit_identifier_with_whitespace_succeeds documents the
 * approved normalization contract: identifiers containing Persian digits and
 * surrounding whitespace are normalized before lookup, so pasted input with
 * ۰-۹ digits and stray spaces logs in exactly like clean ASCII input.
 * Everything else in this file pins the existing behavior (ASCII success,
 * wrong password, non-admin rejection, inactive account, validation).
 */
class AdminLoginTest extends TestCase
{
    use RefreshDatabase;

    private const PASSWORD = 'Admin@Golestani2026!';

    private function adminUser(array $attributes = []): User
    {
        $user = User::create(array_merge([
            'phone' => '09121111111',
            'email' => 'admin@golestani.ir',
            'password' => Hash::make(self::PASSWORD),
            'is_active' => true,
        ], $attributes));

        $user->assignRole('admin');

        return $user;
    }

    public function test_ascii_email_identifier_login_succeeds(): void
    {
        $this->adminUser();

        $this->postJson('/api/auth/admin/login', [
            'identifier' => 'admin@golestani.ir',
            'password' => self::PASSWORD,
        ])
            ->assertOk()
            ->assertJsonStructure(['token', 'token_type', 'user' => ['id', 'roles']])
            ->assertJsonPath('user.roles.0', 'admin');
    }

    public function test_ascii_phone_identifier_login_succeeds(): void
    {
        $this->adminUser();

        $this->postJson('/api/auth/admin/login', [
            'identifier' => '09121111111',
            'password' => self::PASSWORD,
        ])->assertOk();
    }

    public function test_persian_digit_identifier_with_whitespace_succeeds(): void
    {
        $this->adminUser();

        // The admin pastes the phone with Persian digits and surrounding
        // spaces. Normalization must make this equivalent to 09121111111.
        $this->postJson('/api/auth/admin/login', [
            'identifier' => ' ۰۹۱۲۱۱۱۱۱۱۱ ',
            'password' => self::PASSWORD,
        ])
            ->assertOk()
            ->assertJsonPath('user.roles.0', 'admin');
    }

    public function test_whitespace_around_ascii_email_succeeds(): void
    {
        $this->adminUser();

        $this->postJson('/api/auth/admin/login', [
            'identifier' => '  admin@golestani.ir  ',
            'password' => self::PASSWORD,
        ])->assertOk();
    }

    public function test_wrong_password_is_rejected(): void
    {
        $this->adminUser();

        $this->postJson('/api/auth/admin/login', [
            'identifier' => 'admin@golestani.ir',
            'password' => 'definitely-wrong',
        ])->assertStatus(422);
    }

    public function test_non_admin_user_is_rejected(): void
    {
        $user = User::create([
            'phone' => '09120000000',
            'password' => Hash::make(self::PASSWORD),
            'is_active' => true,
        ]);
        $user->assignRole('user');

        $this->postJson('/api/auth/admin/login', [
            'identifier' => '09120000000',
            'password' => self::PASSWORD,
        ])->assertStatus(403);
    }

    public function test_inactive_admin_is_rejected(): void
    {
        $this->adminUser(['is_active' => false]);

        $this->postJson('/api/auth/admin/login', [
            'identifier' => 'admin@golestani.ir',
            'password' => self::PASSWORD,
        ])->assertStatus(403);
    }

    public function test_validation_requires_identifier_and_password(): void
    {
        $this->postJson('/api/auth/admin/login', [])->assertStatus(422);
    }
}
