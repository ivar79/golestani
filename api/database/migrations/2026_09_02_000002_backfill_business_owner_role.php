<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * DECISION-1 (approved): existing business owners never received the
     * business_owner role (nothing in the app assigned it), so their business
     * endpoints returned 403. Backfill the role for every user who owns at
     * least one business. Additive data change only; nothing is removed.
     */
    public function up(): void
    {
        $roleId = DB::table('roles')->where('name', 'business_owner')->value('id');
        if (! $roleId) {
            return;
        }

        $ownerIds = DB::table('businesses')
            ->distinct()
            ->pluck('user_id')
            ->filter();

        foreach ($ownerIds as $userId) {
            $exists = DB::table('role_user')
                ->where('user_id', $userId)
                ->where('role_id', $roleId)
                ->exists();

            if (! $exists) {
                DB::table('role_user')->insert([
                    'user_id' => $userId,
                    'role_id' => $roleId,
                ]);
            }
        }
    }

    public function down(): void
    {
        // Rollback intentionally keeps the additive role assignments; they are
        // harmless and removing them could lock real owners out again.
    }
};
