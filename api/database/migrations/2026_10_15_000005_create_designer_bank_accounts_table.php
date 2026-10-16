<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One registered bank account per designer (شبا + نام صاحب حساب).
 *
 * The sheba is stored NORMALIZED (uppercase `IR` + 24 ASCII digits) and is
 * validated with the Iranian mod-97 check digit in App\Support\Sheba (and
 * mirrored client-side in web/src/lib/wallet.ts) — a request may only ever be
 * paid to the designer's OWN registered account.
 *
 * Keeping it in its own table (rather than columns on users/designers) means
 * the bank identity is a first-class, independently auditable record and a
 * future "multiple accounts / default account" change is a schema change to
 * this table only. `user_id` is unique for now: the product supports one
 * account per designer (decision 6).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('designer_bank_accounts')) {
            return;
        }

        Schema::create('designer_bank_accounts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('sheba', 26);
            $table->string('owner_name', 120);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('designer_bank_accounts');
    }
};
