<?php

namespace App\Console\Commands;

use App\Models\Role;
use App\Models\User;
use App\Services\AuditTrail;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Canonical grandfathering for the DESIGNER IDENTITY, run before the studio
 * gate is switched on.
 *
 * The legacy `designers.status` column was the only designer approval before
 * users.designer_status existed. This command copies it into the CANONICAL
 * field for users who never had a canonical status ('none'), so existing
 * approved designers keep studio access:
 *
 *   designers.status = approved → users.designer_status = approved + designer role
 *   designers.status = pending  → users.designer_status = pending
 *   rejected / suspended        → copied as-is
 *
 * Divergences where the canonical status is ALREADY set are only REPORTED
 * (never overwritten): the canonical field is the source of truth and an
 * admin decides. Users holding the designer role without any approval are
 * reported too — they are NOT auto-approved.
 *
 * SAFETY: --dry-run is the DEFAULT (nothing is written). The real run needs
 * --apply and an interactive confirmation (--force skips the prompt).
 */
class StudioBackfillDesigners extends Command
{
    protected $signature = 'studio:backfill-designers
        {--review-only : Explicit human-review pass — identical to the default dry run}
        {--dry-run : Report only — this is the DEFAULT behaviour}
        {--apply : Actually write the canonical designer_status + role}
        {--force : Skip the interactive confirmation (with --apply)}';

    protected $description = 'Backfill users.designer_status from the legacy designers table (dry-run by default)';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');

        if ($apply && ($this->option('dry-run') || $this->option('review-only'))) {
            $this->error('--apply is mutually exclusive with --dry-run / --review-only.');

            return self::FAILURE;
        }

        $candidates = [];
        $divergent = [];
        $roleOnly = [];

        foreach (User::query()->with(['roles:id,name', 'designer'])->get() as $user) {
            $canonical = (string) ($user->designer_status ?? 'none');
            $legacy = $user->designer?->status;

            if ($legacy !== null && $canonical !== 'none' && $legacy !== $canonical) {
                $divergent[] = ['user' => $user, 'canonical' => $canonical, 'legacy' => $legacy];

                continue;
            }

            if ($legacy !== null && $canonical === 'none') {
                $candidates[] = ['user' => $user, 'canonical' => $canonical, 'legacy' => $legacy];

                continue;
            }

            if ($legacy === null && $canonical === 'none' && $user->hasRole('designer')) {
                $roleOnly[] = $user;
            }
        }

        $this->info('studio:backfill-designers — ' . ($apply ? 'APPLY' : 'REVIEW / DRY RUN (default)'));
        $this->line('Backfill is based ONLY on the legacy `designers.status` for users whose canonical');
        $this->line('users.designer_status is still unset ("none"). A designer ROLE or a subscription is');
        $this->line('NEVER treated as approval, and a legacy approval is a WEAK basis that should be');
        $this->line('reviewed by a human before --apply.');
        $this->newLine();
        $this->line('Candidates (' . count($candidates) . ') — canonical is unset, legacy decided:');
        foreach ($candidates as $candidate) {
            $this->line('  user ' . $candidate['user']->id
                . ': canonical=' . $candidate['canonical']
                . ' legacy=' . $candidate['legacy']
                . ' role=' . ($candidate['user']->hasRole('designer') ? 'yes' : 'no')
                . ' → ' . $this->proposedAction($candidate['legacy']));
        }
        $this->line('Divergent (canonical already set — reported only, never overwritten): ' . count($divergent));
        foreach ($divergent as $row) {
            $this->line('  user ' . $row['user']->id . ': canonical=' . $row['canonical'] . ' legacy=' . $row['legacy']);
        }
        $this->line('Designer role without any approval (reported only, never auto-approved): ' . count($roleOnly));
        foreach ($roleOnly as $user) {
            $this->line('  user ' . $user->id);
        }

        if (! $apply) {
            $this->newLine();
            $this->line('Nothing was written. Review the candidate list, then re-run with --apply to backfill.');

            return self::SUCCESS;
        }

        if ($candidates === []) {
            $this->info('Nothing to backfill.');

            return self::SUCCESS;
        }

        if (! $this->option('force') && ! $this->confirm('Write users.designer_status for ' . count($candidates) . ' user(s)?', false)) {
            $this->warn('Aborted — no changes were written.');

            return self::FAILURE;
        }

        $designerRoleId = Role::query()->where('name', 'designer')->value('id');
        $applied = 0;

        foreach ($candidates as $candidate) {
            DB::transaction(function () use ($candidate, $designerRoleId, &$applied): void {
                /** @var User $user */
                $user = User::query()->whereKey($candidate['user']->id)->lockForUpdate()->first();
                if ($user === null || (string) ($user->designer_status ?? 'none') !== 'none') {
                    return; // someone else changed it meanwhile
                }

                $user->forceFill(['designer_status' => $candidate['legacy']])->save();

                if ($candidate['legacy'] === 'approved' && $designerRoleId !== null && ! $user->hasRole('designer')) {
                    $user->roles()->attach($designerRoleId);
                }

                AuditTrail::record(null, 'studio.backfill_designers', 'user', $user->id, [
                    'from' => 'none',
                    'to' => $candidate['legacy'],
                    'legacy_status' => $candidate['legacy'],
                    'designer_role' => $candidate['legacy'] === 'approved' ? 'assigned' : 'preserved',
                    'actor' => 'console',
                    'source' => 'designers.status',
                    'reason' => 'legacy-approved-backfill',
                ]);

                $applied++;
            });
        }

        $this->info("Backfilled {$applied} user(s).");

        return self::SUCCESS;
    }

    /** Human-readable action the --apply path would take for a candidate. */
    private function proposedAction(?string $legacy): string
    {
        return match ($legacy) {
            'approved' => 'approve + assign designer role',
            'pending' => 'set designer_status=pending',
            'rejected' => 'set designer_status=rejected',
            'suspended' => 'set designer_status=suspended',
            default => 'skip (unrecognized legacy status)',
        };
    }
}
