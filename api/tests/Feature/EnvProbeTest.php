<?php

namespace Tests\Feature;

use Tests\TestCase;

class EnvProbeTest extends TestCase
{
    public function test_probe(): void
    {
        fwrite(STDERR, "\nPROBE env(DB_CONNECTION)=".var_export(env('DB_CONNECTION'), true));
        fwrite(STDERR, " config(database.default)=".var_export(config('database.default'), true));
        fwrite(STDERR, " config(DB_DATABASE)=".var_export(config('database.connections.'.config('database.default').'.database'), true)."\n");
        $this->assertTrue(true);
    }
}
