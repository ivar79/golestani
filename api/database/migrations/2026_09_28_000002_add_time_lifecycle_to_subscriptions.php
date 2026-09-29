<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Subscription TIME lifecycle (requirement: source of truth = timestamps).
 *
 * Adds UTC timestamp columns alongside the existing day-granular
 * start_date/end_date (which stay as the report/display mirror for the
 * manual/receipt era rows):
 *   - started_at: the exact purchase/activation moment (server clock, UTC).
 *   - expires_at: started_at + plan duration. Remaining time is ALWAYS
 *     derived (expires_at − now) — never a stored/decremented counter.
 *
 * Nullable + no backfill: legacy rows (receipt-era) keep their previous
 * day-granular behaviour through the FeatureGate/Subscription fallbacks —
 * nothing changes retroactively (lowest-change compatible with the current
 * architecture).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('subscriptions')) {
            return;
        }

        Schema::table('subscriptions', function (Blueprint $table): void {
            if (! Schema::hasColumn('subscriptions', 'started_at')) {
                $table->timestamp('started_at')->nullable()->after('start_date');
            }
            if (! Schema::hasColumn('subscriptions', 'expires_at')) {
                $table->timestamp('expires_at')->nullable()->after('started_at');
            }
        });

        // Expiry sweeps and read-path queries filter on (status, expires_at).
        if (! $this->indexExists('subscriptions', 'subscriptions_status_expires_at_index')) {
            Schema::table('subscriptions', function (Blueprint $table): void {
                $table->index(['status', 'expires_at'], 'subscriptions_status_expires_at_index');
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('subscriptions')) {
            return;
        }

        Schema::table('subscriptions', function (Blueprint $table): void {
            if (Schema::hasColumn('subscriptions', 'expires_at')) {
                $table->dropIndex('subscriptions_status_expires_at_index');
            }
            $cols = array_filter(
                ['started_at', 'expires_at'],
                fn (string $c) => Schema::hasColumn('subscriptions', $c)
            );
            if (! empty($cols)) {
                $table->dropColumn($cols);
            }
        });
    }

    private function indexExists(string $table, string $index): bool
    {
        if (! Schema::hasColumn($table, 'expires_at')) {
            return false;
        }

        try {
            $connections = Schema::getConnection();
            $driver = $connections->getDriverName();

            if ($driver === 'sqlite') {
                $rows = $connections->select(
                    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name = ?",
                    [$table, $index]
                );

                return count($rows) > 0;
            }

            if ($driver === 'pgsql') {
                $rows = $connections->select(
                    'SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?',
                    [$index]
                );

                return count($rows) > 0;
            }
        } catch (Throwable) {
            return false;
        }

        return false;
    }
};
