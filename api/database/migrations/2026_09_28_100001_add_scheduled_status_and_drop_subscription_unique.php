<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Subscription REBUY/UPGRADE/DOWNGRADE era (schema):
 *
 *  1. subscriptions.status gains the `scheduled` value: a paid subscription
 *     whose lifetime STARTS at the current active subscription's expires_at
 *     (downgrade/end-of-period scheduling). Until that instant it grants
 *     NOTHING — FeatureGate only ever reads `active` rows.
 *
 *  2. payment_transactions.subscription_id drops its UNIQUE index: with
 *     renewals a subscription is the ONE active row that MANY payments
 *     extend — each payment keeps its own audited row, all pointing at the
 *     same subscription (the "Business → Active Subscription → Payments"
 *     model). Double-CONSUMPTION of a single payment remains impossible:
 *     each row is bound at most once, behind the business row lock inside
 *     the activation transaction.
 *
 *  3. plans gains a nullable `tier` (int): the admin-set difficulty order
 *     used to classify a purchase as upgrade / downgrade / switch. NULL tier
 *     falls back to comparing price.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ---- 1. subscriptions.status CHECK constraint + `scheduled` -------
        if (Schema::hasTable('subscriptions') && ! $this->checkContains('subscriptions', 'scheduled')) {
            $driver = Schema::getConnection()->getDriverName();

            if ($driver === 'pgsql') {
                // pgsql: the original table created a native enum type with
                // the 4 receipt-era values. Convert to text and re-constrain
                // with a renamed CHECK (idempotent: drop-if-exists by name
                // before adding, so a partially applied run never wedges).
                DB::statement('ALTER TABLE subscriptions ALTER COLUMN status TYPE text USING status::text');
                DB::statement('DROP TYPE IF EXISTS subscriptions_status_enum');
                DB::statement('ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check');
                DB::statement("ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('pending_receipt','active','rejected','expired','scheduled'))");
            } elseif ($driver === 'sqlite') {
                // SQLite CHECK constraints are inline in CREATE TABLE — the
                // only way to change one is rebuilding the table. Laravel
                // migrations run inside a TRANSACTION; sqlite answers DDL
                // inside a transaction by writing to a TEMP rollback journal,
                // so RE-creating `subscriptions` here would land in temp and
                // vanish after COMMIT. Instead: create the new-shape table
                // under a PERMANENT name (`subscriptions_v2`), copy rows,
                // drop the old table, rename — the rename of a permanent
                // table to `subscriptions` DOES persist. FKs are not
                // re-declared (a RENAME would retarget them to a non-existent
                // table); referential integrity stays with the application
                // layer exactly as it was for receipt-era rows.
                DB::statement('DROP TABLE IF EXISTS subscriptions_v2');
                DB::statement(<<<'SQL'
CREATE TABLE subscriptions_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    business_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    status VARCHAR CHECK (status IN ('pending_receipt','active','rejected','expired','scheduled')) NOT NULL DEFAULT 'pending_receipt',
    receipt_reference VARCHAR NULL,
    receipt_path VARCHAR NULL,
    receipt_name VARCHAR NULL,
    receipt_mime VARCHAR NULL,
    start_date DATETIME NULL,
    end_date DATETIME NULL,
    started_at DATETIME NULL,
    expires_at DATETIME NULL,
    plan_name VARCHAR NULL,
    price_amount INTEGER NULL,
    price_currency VARCHAR NULL,
    duration_days INTEGER NULL,
    entitlements CLOB NULL,
    admin_note CLOB NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL
)
SQL);
                DB::statement('INSERT INTO subscriptions_v2 (id, business_id, plan_id, status, receipt_reference, receipt_path, receipt_name, receipt_mime, start_date, end_date, started_at, expires_at, plan_name, price_amount, price_currency, duration_days, entitlements, admin_note, created_at, updated_at)
                    SELECT id, business_id, plan_id, status, receipt_reference, receipt_path, receipt_name, receipt_mime, start_date, end_date, started_at, expires_at, plan_name, price_amount, price_currency, duration_days, entitlements, admin_note, created_at, updated_at FROM subscriptions');
                DB::statement('DROP TABLE subscriptions');
                DB::statement('ALTER TABLE subscriptions_v2 RENAME TO subscriptions');
                // Same composite index the original migration declared.
                DB::statement('CREATE INDEX IF NOT EXISTS subscriptions_business_id_status_end_date_index ON subscriptions (business_id, status, end_date)');
            } else {
                Schema::table('subscriptions', function (Blueprint $table): void {
                    $table->enum('status', ['pending_receipt', 'active', 'rejected', 'expired', 'scheduled'])->default('pending_receipt')->change();
                });
            }
        }

        // ---- 2. payment_transactions.subscription_id: UNIQUE → INDEX ------
        if (Schema::hasTable('payment_transactions')) {
            Schema::table('payment_transactions', function (Blueprint $table): void {
                $table->dropUnique('payment_transactions_subscription_id_unique');
            });
            Schema::table('payment_transactions', function (Blueprint $table): void {
                $table->index('subscription_id', 'payment_transactions_subscription_id_index');
            });
        }

        // ---- 3. plans.tier -------------------------------------------------
        if (Schema::hasTable('plans') && ! Schema::hasColumn('plans', 'tier')) {
            Schema::table('plans', function (Blueprint $table): void {
                $table->unsignedInteger('tier')->nullable()->after('is_public');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('payment_transactions')) {
            Schema::table('payment_transactions', function (Blueprint $table): void {
                $table->dropIndex('payment_transactions_subscription_id_index');
            });
            // Re-unique only when no multi-payment subscription exists.
            $multi = Schema::hasTable('payment_transactions') && Schema::hasTable('subscriptions')
                ? (int) DB::table('payment_transactions')->whereNotNull('subscription_id')->count()
                    - (int) DB::table('payment_transactions')->whereNotNull('subscription_id')->distinct()->count('subscription_id')
                : 0;
            if ($multi === 0) {
                Schema::table('payment_transactions', function (Blueprint $table): void {
                    $table->unique('subscription_id');
                });
            }
        }

        if (Schema::hasTable('plans') && Schema::hasColumn('plans', 'tier')) {
            Schema::table('plans', function (Blueprint $table): void {
                $table->dropColumn('tier');
            });
        }

        // `scheduled` rows cannot map back onto the 4-value enum — the
        // downgrade is refused rather than corrupting paid state (no-op).
    }

    /** Does any CHECK constraint (or column def) on the table mention the value? */
    private function checkContains(string $table, string $value): bool
    {
        try {
            $connection = Schema::getConnection();
            if ($connection->getDriverName() === 'pgsql') {
                $row = $connection->selectOne(
                    "SELECT 1 FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE ?",
                    [$table, "%{$value}%"]
                );

                return $row !== null;
            }

            if ($connection->getDriverName() === 'sqlite') {
                $row = $connection->selectOne("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [$table]);

                return $row !== null && str_contains((string) ($row->sql ?? ''), "'{$value}'");
            }
        } catch (Throwable) {
            return false;
        }

        return false;
    }
};
