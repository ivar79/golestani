<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Emergency Admin Recovery.
 *
 * Issues (or rotates) a single-use recovery code for an admin user. Run this
 * on the server while the owner still has access, and store the code safely.
 * If the SMS provider ever goes down, the owner can log in with
 * POST /api/auth/verify-recovery using this code instead of an OTP.
 */
class IssueRecoveryCode extends Command
{
    protected $signature = 'admin:recovery-code {phone : The admin phone number}';

    protected $description = 'Issue or rotate a single-use emergency recovery code for an admin';

    public function handle(): int
    {
        $phone = (string) $this->argument('phone');

        $user = User::where('phone', $phone)->first();

        if (! $user instanceof User || ! $user->hasRole('admin')) {
            $this->error('No admin user found with that phone number.');

            return self::FAILURE;
        }

        // Human-friendly grouped format, e.g. "AB3C-9F7K-2QMX".
        $code = strtoupper(Str::random(4)).'-'.strtoupper(Str::random(4)).'-'.strtoupper(Str::random(4));

        $user->recovery_code = Hash::make($code);
        $user->save();

        $this->info('Recovery code issued for '.$phone.':');
        $this->line('    '.$code);
        $this->warn('Store it safely now — it is shown only once and works a single time.');
        $this->line('Login: POST /api/auth/verify-recovery {"phone": "...", "code": "..."}');

        return self::SUCCESS;
    }
}
