<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * ADMINISTRATOR INVENTORY (read-only).
 *
 * Security requirement: the installation has exactly ONE administrator
 * identity, and that identity is provisioned out of band (never a phone
 * number committed to the repository). This command is the verification
 * tool for that rule — run it against staging/production and it fails when
 * the number of admins is not exactly one.
 *
 * Why it exists (standards):
 *  - NIST SP 800-53 AC-2 requires managing accounts through their lifecycle,
 *    including an inventory and periodic review of privileged accounts;
 *    CIS Controls v8.1 safeguard 5.1 asks for an account inventory (user,
 *    administrator and service accounts) validated on a recurring schedule.
 *  - A review is only meaningful if it can be run on demand and fails loudly
 *    when the expected number of administrators changed.
 *
 * Safety properties:
 *  - Read-only: no writes, no tokens touched, no secrets printed.
 *  - Phone numbers are MASKED in the output (first 3 + last 4 digits) so a
 *    pasted console log or CI artifact never becomes a directory of
 *    administrator contact data.
 *  - Never prints password hashes, recovery codes or access tokens — only
 *    whether such a credential is SET.
 */
class AuditAdmins extends Command
{
    protected $signature = 'admin:audit {--allow-multiple : Report more than one administrator without failing}';

    protected $description = 'List the accounts holding the admin role (masked) and fail unless exactly one exists';

    public function handle(): int
    {
        $admins = User::query()
            ->whereHas('roles', fn ($query) => $query->where('name', 'admin'))
            ->withCount(['tokens as admin_sessions_count' => fn ($query) => $query->where('name', 'admin-token')])
            ->orderBy('id')
            ->get(['id', 'name', 'phone', 'email', 'is_active', 'password', 'recovery_code', 'created_at']);

        $count = $admins->count();

        $this->line("Administrator accounts: {$count}");

        if ($count > 0) {
            $this->table(
                ['id', 'phone (masked)', 'name', 'active', 'password set', 'recovery code set', 'admin sessions', 'created'],
                $admins->map(fn (User $admin): array => [
                    $admin->id,
                    $this->mask((string) $admin->phone),
                    (string) $admin->name,
                    $admin->is_active ? 'yes' : 'NO',
                    $admin->password !== null && $admin->password !== '' ? 'yes' : 'no',
                    $admin->recovery_code !== null && $admin->recovery_code !== '' ? 'yes' : 'no',
                    (int) $admin->admin_sessions_count,
                    optional($admin->created_at)->toDateString() ?? '-',
                ])->all(),
            );
        }

        if ($count === 0) {
            $this->error('No administrator exists. Provision one with: php artisan admin:provision <PHONE>');

            return self::FAILURE;
        }

        if ($count > 1 && ! $this->option('allow-multiple')) {
            $this->error('More than one administrator exists. The installation is expected to have exactly one privileged identity; review the extra accounts and revoke the role out of band.');

            return self::FAILURE;
        }

        $inactive = $admins->where('is_active', false)->count();
        if ($inactive > 0) {
            $this->warn("{$inactive} administrator account(s) are NOT active — verify that an active admin still exists for recovery.");
        }

        return self::SUCCESS;
    }

    /** 09120000001 => 093****6800 (enough for an operator, useless in a leaked log). */
    private function mask(string $phone): string
    {
        if (mb_strlen($phone) < 8) {
            return $phone === '' ? '-' : str_repeat('*', mb_strlen($phone));
        }

        return mb_substr($phone, 0, 3).str_repeat('*', max(4, mb_strlen($phone) - 7)).mb_substr($phone, -4);
    }
}
