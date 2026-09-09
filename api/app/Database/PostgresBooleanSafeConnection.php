<?php

namespace App\Database;

use Illuminate\Database\PostgresConnection;
use PDO;

/**
 * PostgreSQL connection that binds PHP booleans as real SQL booleans.
 *
 * Why this exists (production incident, SQLSTATE[42804]):
 *
 *   1. Laravel's base Connection::prepareBindings() converts every PHP
 *      boolean binding to (int), and bindValues() then sends it as
 *      PDO::PARAM_INT.
 *   2. The pgsql connection runs with PDO::ATTR_EMULATE_PREPARES => true
 *      (enabled for compatibility with pooled Postgres endpoints such as
 *      Neon's pooler). With emulation ON, PDO interpolates the bound value
 *      into the SQL text instead of passing it through the wire protocol
 *      as a typed parameter.
 *   3. The interpolated literal "1" is an integer for PostgreSQL, which
 *      rejects it on strict `boolean` columns:
 *      "column "is_active" is of type boolean but expression is of type
 *      integer".
 *
 * SQLite (used by the test suite) silently accepts 1/0, which is why the
 * failure only ever surfaced against PostgreSQL.
 *
 * The fix is two-fold, because the pipeline is two-stage:
 *
 *   1. prepareBindings(): the base implementation converts every PHP boolean
 *      to (int) — this is where booleans were being destroyed. Here we KEEP
 *      booleans intact (only the DateTime formatting of the parent is
 *      re-implemented, one-to-one).
 *   2. bindValues(): with booleans intact, we type them as PDO::PARAM_BOOL.
 *
 * PARAM_BOOL travels as a real boolean both with emulated and with native
 * prepares, and is a no-op for MySQL/SQLite semantics. PDO::PARAM_BOOL
 * exists on every PHP version with pdo_pgsql, so no version sniffing is
 * needed.
 *
 * It is registered for the 'pgsql' driver in AppServiceProvider, which
 * also covers any database connection whose driver is 'pgsql' (including
 * read/write splits). No DB::raw('TRUE') anywhere — application code keeps
 * passing normal PHP booleans.
 */
class PostgresBooleanSafeConnection extends PostgresConnection
{
    /**
     * Prepare bindings for execution — but keep PHP booleans intact.
     *
     * Mirrors the base Connection::prepareBindings() one-to-one EXCEPT the
     * `is_bool($value) => (int) $value` branch is intentionally omitted:
     * dropping that cast is the whole point. bindValues() below then binds
     * the surviving booleans as PDO::PARAM_BOOL.
     *
     * @return array
     */
    public function prepareBindings(array $bindings)
    {
        $grammar = $this->getQueryGrammar();

        foreach ($bindings as $key => $value) {
            if ($value instanceof \DateTimeInterface) {
                $bindings[$key] = $value->format($grammar->getDateFormat());
            }
            // Booleans are deliberately NOT cast to int here.
        }

        return $bindings;
    }

    /**
     * Bind values to their parameters, typing PHP booleans correctly.
     *
     * Mirrors the parent implementation one-to-one except for the added
     * is_bool() branch, so null/int/string/resource behavior is identical
     * to stock Laravel.
     *
     * @param  \PDOStatement  $statement
     * @param  array  $bindings
     * @return void
     */
    public function bindValues($statement, $bindings)
    {
        foreach ($bindings as $key => $value) {
            $statement->bindValue(
                is_string($key) ? $key : $key + 1,
                $value,
                match (true) {
                    is_bool($value) => PDO::PARAM_BOOL,
                    is_int($value) => PDO::PARAM_INT,
                    is_resource($value) => PDO::PARAM_LOB,
                    default => PDO::PARAM_STR,
                },
            );
        }
    }
}
