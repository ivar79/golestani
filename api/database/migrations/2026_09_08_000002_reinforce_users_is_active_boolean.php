<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Production incident hardening (SQLSTATE[42804] "column is_active is of
 * type boolean but expression is of type integer").
 *
 * The 2026_08_28_000001 migration already created users.is_active as a
 * boolean with a default of true, so on every correctly migrated database
 * this migration is a no-op. It exists because the incident above proved
 * that a drifted/hand-edited database (is_active created as integer, or
 * its default lost) fails user registration at runtime.
 *
 * Behavior:
 *  - PostgreSQL: verifies the column type via information_schema and, only
 *    when it is NOT boolean, converts it in-place (USING is_active::int <> 0
 *    is not used — if the type is wrong the values are integer truthiness and
 *    are mapped to true/false explicitly). It then re-asserts the default.
 *    If the column is already boolean, only the default is re-asserted.
 *  - SQLite (test suite): nothing to fix; Laravel stores booleans as 0/1
 *    integers and accepts them natively. The migration is a no-op.
 *  - Existing rows and data are never modified on a healthy database.
 *  - down() is a no-op: restoring the pre-incident drifted state is not a
 *    goal, and dropping/re-adding the column would destroy data.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::getConnection()->getDriverName() !== 'pgsql') {
            return;
        }

        $column = DB::selectOne(
            "SELECT data_type, column_default
               FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'users'
                AND column_name = 'is_active'"
        );

        // Table missing entirely (fresh database that will run the base
        // migrations right after) — nothing to reinforce here.
        if ($column === null) {
            return;
        }

        if ($column->data_type !== 'boolean') {
            // Drifted/hand-edited database: convert integer values to real
            // booleans in-place, preserving row data.
            DB::statement(
                'ALTER TABLE users
                    ALTER COLUMN is_active DROP DEFAULT,
                    ALTER COLUMN is_active TYPE boolean
                        USING CASE WHEN is_active::int = 0 THEN false ELSE true END,
                    ALTER COLUMN is_active SET DEFAULT TRUE'
            );
        } elseif (! str_contains(strtolower((string) $column->column_default), 'true')) {
            // Correct type but the default was lost/drifted (e.g. NULL or a
            // non-true default): restore the registration-safe default.
            DB::statement('ALTER TABLE users ALTER COLUMN is_active SET DEFAULT TRUE');
        }
    }

    public function down(): void
    {
        // Intentionally irreversible: the boolean type and TRUE default are
        // the correct state; the pre-incident drift must not be restored.
    }
};
