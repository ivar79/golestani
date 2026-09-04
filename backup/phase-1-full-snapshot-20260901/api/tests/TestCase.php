<?php

namespace Tests;

use Database\Seeders\RoleSeeder;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Cache;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Clear cache between tests to prevent rate limiter / OTP bleed.
        Cache::flush();

        // RBAC tests rely on the four fixed roles existing.
        $this->seed(RoleSeeder::class);
    }
}
