<?php

namespace App\Console\Commands;

use App\Models\Role;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Non-interactive admin provisioning for environments without a shell
 * (staging on Render/Neon, seeded from a GitHub Actions workflow).
 *
 * All inputs come from environment variables so no secret ever appears in
 * argv or command output:
 *   ADMIN_PHONE    (required, 09xxxxxxxxx)
 *   ADMIN_PASSWORD (required, min 16 chars)
 *   ADMIN_EMAIL    (optional, default admin@golestani.ir)
 *
 * Idempotent: creates the admin if absent, otherwise rotates the password.
 * The interactive twin of this command is `admin:provision` (ProvisionAdmin).
 */
class ProvisionAdminFromEnv extends Command
{
    protected $signature = 'admin:provision-from-env';

    protected $description = 'Create or rotate a staging administrator from ADMIN_PHONE / ADMIN_PASSWORD / ADMIN_EMAIL environment variables';

    public function handle(): int
    {
        $phone = trim((string) getenv('ADMIN_PHONE'));
        $password = (string) getenv('ADMIN_PASSWORD');
        $email = trim((string) (getenv('ADMIN_EMAIL') !== false ? getenv('ADMIN_EMAIL') : 'admin@golestani.ir'));

        if (! preg_match('/^09[0-9]{9}$/', $phone)) {
            $this->error('ADMIN_PHONE is missing or not a valid Iranian mobile number (09xxxxxxxxx).');

            return self::FAILURE;
        }

        if (mb_strlen($password) < 16) {
            $this->error('ADMIN_PASSWORD is missing or shorter than 16 characters.');

            return self::FAILURE;
        }

        if ($email !== '' && ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('ADMIN_EMAIL is not a valid email address.');

            return self::FAILURE;
        }

        // Pre-flight guards (graceful errors before any write); the same
        // conditions are re-checked inside the transaction as race backstops.
        $existing = User::where('phone', $phone)->first();
        if ($existing && ! $existing->hasRole('admin')) {
            $this->error('An account with this phone exists but is not an admin; promotion is not allowed.');

            return self::FAILURE;
        }

        if (! $existing && $email !== '' && User::where('email', $email)->exists()) {
            $this->error('ADMIN_EMAIL already belongs to another account; provisioning stopped.');

            return self::FAILURE;
        }

        $created = false;

        DB::transaction(function () use ($phone, $password, $email, &$created): void {
            // Guard in case RoleSeeder has not run yet on this database.
            Role::firstOrCreate(['name' => 'admin'], ['display_name' => 'مدیر کل سیستم']);

            $user = User::where('phone', $phone)->lockForUpdate()->first();

            if ($user && ! $user->hasRole('admin')) {
                // Never silently promote an existing non-admin account.
                throw new \RuntimeException('An account with this phone exists but is not an admin; promotion is not allowed.');
            }

            if (! $user) {
                if ($email !== '' && User::where('email', $email)->exists()) {
                    // Guard against the unique email constraint: never touch
                    // an unrelated account that already owns this email.
                    throw new \RuntimeException('Another account already owns ADMIN_EMAIL; provisioning stopped.');
                }

                $user = new User([
                    'phone' => $phone,
                    'email' => $email !== '' ? $email : null,
                    'name' => 'مدیر سامانه',
                    'is_active' => true,
                ]);
                $created = true;
            }

            $user->password = Hash::make($password);
            $user->recovery_code = null;
            $user->save();
            $user->assignRole('admin');
            $user->tokens()->delete();

            DB::table('audit_events')->insert([
                'actor_id' => null,
                'event' => $created ? 'admin.credentials_provisioned' : 'admin.credentials_rotated',
                'subject_type' => 'user',
                'subject_id' => $user->id,
                'metadata' => json_encode(['source' => 'workflow'], JSON_THROW_ON_ERROR),
                'created_at' => now(),
            ]);
        });

        $this->info($created
            ? 'Staging administrator created. No secret was written to logs.'
            : 'Staging administrator password rotated. No secret was written to logs.');

        return self::SUCCESS;
    }
}
