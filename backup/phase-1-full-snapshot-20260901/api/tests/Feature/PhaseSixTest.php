<?php

namespace Tests\Feature;

use Tests\TestCase;

class PhaseSixTest extends TestCase
{
    public function test_admin_routes_are_present(): void
    {
        $routes = collect(app('router')->getRoutes())->map(fn ($route) => $route->uri());
        $this->assertTrue($routes->contains('api/admin/overview'));
        $this->assertTrue($routes->contains('api/admin/users'));
    }
}
