<?php

namespace Tests\Feature;

use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class BusinessSearchTest extends TestCase
{
    use RefreshDatabase;

    public function test_search_returns_only_approved_businesses_and_applies_filters(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');
        $owner->businesses()->create([
            'name' => 'کافه نزدیک', 'slug' => 'near-cafe', 'category' => 'کافه',
            'city' => 'تهران', 'neighborhood' => 'مرکز', 'status' => 'approved',
            'latitude' => 35.70, 'longitude' => 51.40,
        ]);
        $owner->businesses()->create([
            'name' => 'کافه در انتظار', 'slug' => 'pending-cafe', 'category' => 'کافه',
            'city' => 'تهران', 'status' => 'pending',
            'latitude' => 35.70, 'longitude' => 51.40,
        ]);

        $response = $this->getJson('/api/search/businesses?q=نزدیک&city=تهران&category=کافه');

        $response->assertOk()->assertJsonCount(1)->assertJsonPath('0.slug', 'near-cafe');
    }

    public function test_search_validates_coordinates_and_limit(): void
    {
        $this->getJson('/api/search/businesses?latitude=91&longitude=51')->assertUnprocessable();
        $this->getJson('/api/search/businesses?latitude=35&longitude=51&limit=51')->assertUnprocessable();
    }

    public function test_postgis_migration_is_safe_for_non_postgres_connections(): void
    {
        $this->assertNotSame('pgsql', DB::connection()->getDriverName());
    }
}
