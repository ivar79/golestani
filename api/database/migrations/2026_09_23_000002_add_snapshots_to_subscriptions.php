<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Historical pricing + entitlement snapshots on subscriptions.
 *
 * 1) Money snapshot (written at REQUEST time, SubscriptionController@store):
 *    later price edits on the plan must never rewrite history or the revenue
 *    report.
 *
 * 2) Entitlement snapshot (written at ACTIVATION time,
 *    SubscriptionController@moderate — POLICY snapshot_entitlements):
 *    the subscription keeps the entitlements its plan had at activation.
 *    Later plan edits apply only to NEW purchases. Nullable column: legacy
 *    rows (and tests creating subscriptions directly) fall back to a live
 *    resolve of the plan's features — behaviour-preserving self-healing.
 *
 * Design note: chosen over a plan_versions table deliberately — one JSON
 * column per subscription is self-contained, audit-friendly, and matches the
 * existing architecture (plans.features is already JSON).
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasTable('subscriptions')) {
            return;
        }

        Schema::table('subscriptions', function (Blueprint $table): void {
            if (! Schema::hasColumn('subscriptions', 'plan_name')) {
                $table->string('plan_name', 100)->nullable()->after('plan_id');
            }
            if (! Schema::hasColumn('subscriptions', 'price_amount')) {
                $table->unsignedBigInteger('price_amount')->nullable()->after('plan_name');
            }
            if (! Schema::hasColumn('subscriptions', 'price_currency')) {
                $table->string('price_currency', 10)->nullable()->after('price_amount');
            }
            if (! Schema::hasColumn('subscriptions', 'duration_days')) {
                $table->unsignedInteger('duration_days')->nullable()->after('price_currency');
            }
            if (! Schema::hasColumn('subscriptions', 'entitlements')) {
                // POLICY snapshot_entitlements: frozen at activation. Never
                // written by client input; never mass-assignable.
                $table->json('entitlements')->nullable()->after('duration_days');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('subscriptions')) {
            return;
        }

        Schema::table('subscriptions', function (Blueprint $table): void {
            $cols = array_filter(
                ['plan_name', 'price_amount', 'price_currency', 'duration_days', 'entitlements'],
                fn (string $c) => Schema::hasColumn('subscriptions', $c)
            );
            if (! empty($cols)) {
                $table->dropColumn($cols);
            }
        });
    }
};
