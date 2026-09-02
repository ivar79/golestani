<?php
namespace Tests\Feature;
use Tests\TestCase;
class PhaseThreeCompletionTest extends TestCase { public function test_public_search_route_exists(): void { $routes=collect(app('router')->getRoutes())->map(fn($route)=>$route->uri()); $this->assertTrue($routes->contains('api/search/businesses')); } }
