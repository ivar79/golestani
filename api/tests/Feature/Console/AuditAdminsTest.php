<?php

namespace Tests\Feature\Console;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * `php artisan admin:audit` — the read-only inventory that proves the
 * installation has exactly ONE administrator (the operator-provisioned
 * identity) and never leaks the phone number it inspects.
 */
class AuditAdminsTest extends TestCase
{
    use RefreshDatabase;

    private function admin(string $phone = '09361234567'): User
    {
        $user = User::factory()->create(['phone' => $phone, 'name' => 'مدیر سامانه']);
        $user->assignRole('admin');

        return $user;
    }

    public function test_exactly_one_admin_passes_and_masks_the_phone(): void
    {
        $this->admin('09120000001');

        // The full number must never be printed (logs/CI artifacts), but the
        // operator still sees enough to recognise the account.
        $this->artisan('admin:audit')
            ->expectsOutputToContain('Administrator accounts: 1')
            ->expectsOutputToContain('093****6800')
            ->doesntExpectOutputToContain('09120000001')
            ->assertSuccessful();
    }

    public function test_more_than_one_admin_fails_unless_explicitly_allowed(): void
    {
        $this->admin('09120000001');
        $this->admin('09120000009');

        $this->artisan('admin:audit')->assertFailed();

        $this->artisan('admin:audit', ['--allow-multiple' => true])
            ->expectsOutputToContain('Administrator accounts: 2')
            ->assertSuccessful();
    }

    public function test_no_admin_at_all_fails(): void
    {
        User::factory()->create(['phone' => '09120000001'])->assignRole('user');

        $this->artisan('admin:audit')
            ->expectsOutputToContain('No administrator exists')
            ->assertFailed();
    }

    public function test_it_never_prints_credentials_only_whether_they_are_set(): void
    {
        $admin = $this->admin();
        $admin->forceFill(['password' => bcrypt('a-very-secret-password'), 'recovery_code' => bcrypt('recovery-secret')])->save();
        $admin->createToken('admin-token');

        $this->artisan('admin:audit')
            ->expectsOutputToContain('yes')
            ->doesntExpectOutputToContain('a-very-secret-password')
            ->doesntExpectOutputToContain('recovery-secret')
            ->assertSuccessful();
    }
}
