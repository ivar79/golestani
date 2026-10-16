<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Designer-commission rate per plan (wallet system, manual settlement era).
 *
 * `commission_percent` is the ONLY place the referral percentage lives: the
 * accrual service reads it from the plan row at accrual time and multiplies it
 * by the subscription's own money snapshot (`price_amount`, which is TOMAN —
 * see Plan::priceRial() for the single ×10 unit conversion to RIAL).
 *
 * Default 0 = the feature is dormant: every existing plan keeps paying zero
 * commission until the admin sets a real percentage, so nothing about the
 * current pricing behaviour changes with this migration.
 *
 * Range 0..100 is enforced in the request layer (SubscriptionController
 * storePlan/updatePlan) — the column stays a plain unsigned integer so a later
 * change of the range needs no migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('plans') || Schema::hasColumn('plans', 'commission_percent')) {
            return;
        }

        Schema::table('plans', function (Blueprint $table): void {
            $table->unsignedInteger('commission_percent')->default(0)->after('price');
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('plans') || ! Schema::hasColumn('plans', 'commission_percent')) {
            return;
        }

        Schema::table('plans', function (Blueprint $table): void {
            $table->dropColumn('commission_percent');
        });
    }
};
