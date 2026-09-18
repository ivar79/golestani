<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Backfill: every active user must carry at least the base 'user' role.
 *
 * Found during the QR acceptance scenario (2026-09-18): a user registered
 * while the role tables were being re-seeded ended up with ZERO roles, so
 * `role:business_owner,user,admin` middleware rejected its first
 * POST /api/businesses with 403. New users get 'user' at verify-otp time
 * (AuthController); this migration only repairs existing rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        $roleId = DB::table('roles')->where('name', 'user')->value('id');
        if ($roleId === null) {
            // Roles not seeded yet (fresh install) — RoleSeeder will assign
            // roles to new users; nothing to backfill against.
            return;
        }

        DB::table('users')->whereNotExists(
            fn ($q) => $q->from('role_user')
                ->whereColumn('role_user.user_id', 'users.id')
        )->orderBy('id')->chunkById(500, function ($users) use ($roleId): void {
            $now = now();
            DB::table('role_user')->insertOrIgnore($users->map(
                fn ($u) => ['role_id' => $roleId, 'user_id' => $u->id, 'created_at' => $now, 'updated_at' => $now]
            )->all());
        });
    }

    public function down(): void
    {
        // Deliberately no-op: removing base roles would lock users out again.
    }
};
