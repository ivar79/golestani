<?php

namespace App\Console\Commands;

// Aliased: this command class shares its name with the report builder.
use App\Services\StudioAccessReport as ReportBuilder;
use Illuminate\Console\Command;

/**
 * READ-ONLY studio rollout board. Reports, in one place:
 *   - whether the gate is enforced (site setting `studio_designer_only`);
 *   - users by canonical designer_status;
 *   - businesses whose CURRENT subscription snapshot grants designer_studio;
 *   - the divergence between users.designer_status and the legacy
 *     designers.status rows (the two designer concepts);
 *   - admin studio bypasses recorded in the audit trail.
 *
 * Nothing is written — safe to run against production at any time.
 */
class StudioAccessReport extends Command
{
    protected $signature = 'studio:access-report {--json : Emit the raw JSON report}';

    protected $description = 'Read-only Card Studio rollout report (gate, statuses, capabilities, divergence, bypasses)';

    public function handle(): int
    {
        $report = app(ReportBuilder::class)->build();

        if ($this->option('json')) {
            $this->line((string) json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

            return self::SUCCESS;
        }

        $this->info('Card Studio access report — ' . $report['generated_at']);
        $this->line('Gate enforcement (studio_designer_only): ' . ($report['gate']['enforced'] ? 'ON' : 'off (staged rollout)'));
        $this->line('Capability key: ' . $report['gate']['capability']);
        $this->newLine();

        $this->line('Users: ' . $report['users']['total']);
        foreach ($report['users']['by_designer_status'] as $status => $count) {
            $this->line('  designer_status=' . $status . ': ' . $count);
        }
        $this->line('  approved: ' . $report['users']['approved']);
        $this->line('  approved WITHOUT any business (studio unreachable): ' . $report['users']['approved_without_business']);
        $this->line('  approved WITHOUT a studio-capable business: ' . $report['users']['approved_without_studio_business']);
        $this->newLine();

        $this->line('Businesses: ' . $report['businesses']['total']
            . ' | card_editor: ' . $report['businesses']['with_card_editor']
            . ' | designer_studio: ' . $report['businesses']['with_designer_studio']);
        $this->line('Active subscriptions: ' . $report['subscriptions']['active']);
        $this->newLine();

        $this->line('Backfill candidates (canonical unset, legacy decided — review before apply): ' . count($report['users']['backfill_candidates']));
        foreach ($report['users']['backfill_candidates'] as $row) {
            $this->line('  user ' . $row['user_id'] . ': canonical=' . $row['designer_status'] . ' legacy=' . $row['legacy_status']
                . ' role=' . ($row['has_designer_role'] ? 'yes' : 'no'));
        }
        $this->line('Divergent (canonical already set — reported only): ' . count($report['users']['divergent']));
        foreach ($report['users']['divergent'] as $row) {
            $this->line('  user ' . $row['user_id'] . ': canonical=' . $row['designer_status'] . ' legacy=' . $row['legacy_status']);
        }
        $this->line('Designer role without approval: ' . count($report['users']['role_without_approval']));
        $this->newLine();

        $this->line('Admin studio bypasses: ' . $report['admin_bypasses']['total']);
        foreach ($report['admin_bypasses']['recent'] as $row) {
            $this->line('  #' . $row->id . ' actor=' . ($row->actor_id ?? '-') . ' business=' . ($row->subject_id ?? '-') . ' at ' . $row->created_at);
        }

        return self::SUCCESS;
    }
}
