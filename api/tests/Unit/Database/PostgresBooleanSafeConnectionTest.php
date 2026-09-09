<?php

namespace Tests\Unit\Database;

use App\Database\PostgresBooleanSafeConnection;
use PDO;
use PDOStatement;
use PHPUnit\Framework\TestCase;

class RecordingStatement extends PDOStatement
{
    /** @var array<int, array{0: int|string, 1: mixed, 2: int}> */
    public array $bound = [];

    public function bindValue($param, $value, $type = PDO::PARAM_STR): bool
    {
        $this->bound[] = [$param, $value, $type];

        return true;
    }
}

/**
 * Unit test for the production-incident fix (SQLSTATE[42804]): PHP booleans
 * must be bound as PDO::PARAM_BOOL on the pgsql driver, while every other
 * type keeps stock Laravel binding behavior.
 */
class PostgresBooleanSafeConnectionTest extends TestCase
{
    private PostgresBooleanSafeConnection $connection;

    private RecordingStatement $statement;

    protected function setUp(): void
    {
        parent::setUp();

        // The Connection constructor only stores the PDO handle and builds
        // grammars; a recording fake statement is sufficient here.
        $this->statement = new RecordingStatement;
        $this->connection = new PostgresBooleanSafeConnection($this->statement, 'golestani', 'prefix_', []);
    }

    public function test_php_booleans_are_bound_as_param_bool(): void
    {
        $this->connection->bindValues($this->statement, [true, false]);

        $this->assertSame([
            [1, true, PDO::PARAM_BOOL],
            [2, false, PDO::PARAM_BOOL],
        ], $this->statement->bound);
    }

    public function test_integers_strings_and_nulls_keep_stock_laravel_types(): void
    {
        $this->connection->bindValues($this->statement, [7, '09123456789', null]);

        $this->assertSame([
            [1, 7, PDO::PARAM_INT],
            [2, '09123456789', PDO::PARAM_STR],
            [3, null, PDO::PARAM_STR],
        ], $this->statement->bound);
    }

    public function test_named_keys_are_preserved_and_typed(): void
    {
        $this->connection->bindValues($this->statement, [
            'phone' => '09120000000',
            'is_active' => true,
        ]);

        $this->assertSame([
            ['phone', '09120000000', PDO::PARAM_STR],
            ['is_active', true, PDO::PARAM_BOOL],
        ], $this->statement->bound);
    }

    public function test_resources_are_bound_as_lob(): void
    {
        $stream = fopen('php://memory', 'rb');

        $this->connection->bindValues($this->statement, [$stream]);

        $this->assertSame([1, $stream, PDO::PARAM_LOB], $this->statement->bound[0]);
        fclose($stream);
    }

    public function test_the_string_1_is_never_typed_as_bool(): void
    {
        // Guards against a wrong fix that would type-check by value
        // (e.g. truthiness) instead of by PHP type.
        $this->connection->bindValues($this->statement, ['1', 1, 'true']);

        $this->assertSame([
            [1, '1', PDO::PARAM_STR],
            [2, 1, PDO::PARAM_INT],
            [3, 'true', PDO::PARAM_STR],
        ], $this->statement->bound);
    }
}
