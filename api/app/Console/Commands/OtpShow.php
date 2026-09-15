<?php

namespace App\Console\Commands;

use App\Services\Auth\OtpService;
use App\Services\Sms\Contracts\SmsServiceInterface;
use App\Services\Sms\Listeners\LastIssuedOtp;
use Illuminate\Console\Command;

/**
 * Dev-only helper: prints the latest demo OTP issued for a phone number so
 * local testing doesn't require opening storage/logs/laravel.log.
 *
 * Safety gate mirrors LogSmsDriver::shouldExposeOtp(): the code is shown only
 * when OTP_DEMO_MODE is explicitly enabled AND the environment is not
 * production. In production the command never reveals anything, even if the
 * flag was accidentally left on.
 */
class OtpShow extends Command
{
    protected $signature = 'otp:show {phone : Iranian mobile number} {--issue : Issue a fresh code instead of showing the last one}';

    protected $description = 'Show the latest issued demo OTP code (dev/preview only, never in production)';

    public function handle(OtpService $otp, LastIssuedOtp $last): int
    {
        if (! $this->demoModeEnabled()) {
            $this->error('OTP demo mode is disabled (or the environment is production) — the code is never exposed.');

            return self::FAILURE;
        }

        $phone = (string) $this->argument('phone');

        if (! preg_match('/^09\d{9}$/', $phone)) {
            $this->error('Invalid Iranian mobile number. Expected format: 09XXXXXXXXX');

            return self::FAILURE;
        }

        if ($this->option('issue')) {
            if (! $otp->canSend($phone)) {
                $this->error('Send limit reached for this number (3 per 10 minutes). Run: php artisan cache:clear');

                return self::FAILURE;
            }

            $code = $otp->generateCode();
            $otp->store($phone, $code);
            $otp->incrementSendCount($phone);
            app(SmsServiceInterface::class)->send($phone, "کد تأیید شما: {$code}");
        }

        $code = $last->forPhone($phone);

        if ($code === null) {
            $this->warn('No OTP has been issued for this number in the current server process.');
            $this->line('Options:');
            $this->line('  • Request a code on the login page, then run this command again.');
            $this->line('  • Or issue a fresh one right now:  php artisan otp:show '.$phone.' --issue');

            return self::FAILURE;
        }

        $age = time() - (int) $last->issuedAt;
        $remaining = max(0, OtpService::TTL_SECONDS - $age);

        $this->info('Latest OTP for '.substr($phone, 0, 4).'****'.substr($phone, -4).':');
        $this->line('    <fg=black;bg=green;options=bold> '.$code.' </>');
        $this->line("    Issued {$age}s ago — about {$remaining}s of its ".OtpService::TTL_SECONDS."s validity remains.");

        return self::SUCCESS;
    }

    private function demoModeEnabled(): bool
    {
        if ((string) config('app.env', 'production') === 'production') {
            return false;
        }

        return (bool) config('sms.otp_demo_mode', false);
    }
}
