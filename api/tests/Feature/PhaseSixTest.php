<?php

namespace Tests\Feature;

use App\Models\AdminTaxonomy;
use App\Models\User;
use App\Models\Designer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PhaseSixTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $admin = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin->assignRole('admin');
        return $admin;
    }

    public function test_admin_routes_are_present(): void
    {
        $routes = collect(app('router')->getRoutes())->map(fn ($route) => $route->uri());
        $this->assertTrue($routes->contains('api/admin/overview'));
        $this->assertTrue($routes->contains('api/admin/users'));
    }

    public function test_admin_can_manage_taxonomies_and_public_users_can_read_active_values(): void
    {
        $admin = $this->admin();

        $response = $this->actingAs($admin)->postJson('/api/admin/taxonomies', [
            'type' => 'category',
            'name' => 'خدمات دیجیتال',
            'slug' => 'digital-services',
        ])->assertCreated();

        $taxonomyId = $response->json('id');
        $this->getJson('/api/public/taxonomies?type=category')
            ->assertOk()
            ->assertJsonFragment(['slug' => 'digital-services']);

        $this->actingAs($admin)->putJson('/api/admin/taxonomies/'.$taxonomyId, ['is_active' => false])
            ->assertOk()->assertJsonPath('is_active', false);

        $this->getJson('/api/public/taxonomies?type=category')
            ->assertOk()
            ->assertJsonMissing(['slug' => 'digital-services']);
    }

    public function test_taxonomy_parent_cannot_be_deleted_while_children_exist(): void
    {
        $admin = $this->admin();
        $city = AdminTaxonomy::create(['type' => 'city', 'name' => 'تهران', 'slug' => 'tehran']);
        AdminTaxonomy::create(['type' => 'neighborhood', 'parent_id' => $city->id, 'name' => 'مرکز', 'slug' => 'center']);

        $this->actingAs($admin)->deleteJson('/api/admin/taxonomies/'.$city->id)->assertStatus(422);
    }

    public function test_admin_can_read_health_and_audit_endpoints(): void
    {
        $admin = $this->admin();

        $this->actingAs($admin)->getJson('/api/admin/health')
            ->assertOk()
            ->assertJsonStructure(['status', 'checked_at', 'database', 'postgis', 'redis', 'storage']);

        $this->actingAs($admin)->getJson('/api/admin/audit')
            ->assertOk()
            ->assertJsonStructure(['data', 'current_page', 'last_page']);
    }

    public function test_authenticated_visitor_can_report_business_and_admin_can_moderate_it(): void
    {
        $owner = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $owner->assignRole('business_owner');
        $business = $owner->businesses()->create(['name' => 'Reportable', 'slug' => 'reportable', 'status' => 'approved']);
        $visitor = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $admin = $this->admin();

        $report = $this->actingAs($visitor)->postJson('/api/public/businesses/'.$business->id.'/reports', [
            'type' => 'incorrect_data',
            'message' => 'اطلاعات تماس این کسب‌وکار نادرست است.',
        ])->assertCreated()->json('id');

        $this->actingAs($admin)->getJson('/api/admin/reports')->assertOk()->assertJsonFragment(['id' => $report]);
        $this->actingAs($admin)->patchJson('/api/admin/reports/'.$report.'/moderate', [
            'status' => 'resolved',
            'admin_note' => 'بررسی و اصلاح شد.',
        ])->assertOk()->assertJsonPath('status', 'resolved');
    }

    public function test_admin_can_list_and_moderate_designers(): void
    {
        $designerUser = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);
        $designer = Designer::create(['user_id' => $designerUser->id, 'display_name' => 'طراح آزمایشی', 'slug' => 'designer-test', 'status' => 'pending']);
        $admin = $this->admin();

        $this->actingAs($admin)->getJson('/api/admin/designers')->assertOk()->assertJsonFragment(['id' => $designer->id]);
        $this->actingAs($admin)->patchJson('/api/admin/designers/'.$designer->id.'/moderate', ['status' => 'approved'])
            ->assertOk()->assertJsonPath('status', 'approved');
    }

    public function test_admin_role_management_protects_last_admin_and_self(): void
    {
        $admin = $this->admin();
        $otherUser = User::factory()->create(['phone' => '09'.fake()->numerify('#########')]);

        $this->actingAs($admin)->patchJson('/api/admin/users/'.$otherUser->id, ['roles' => ['business_owner']])
            ->assertOk()->assertJsonPath('roles.0.name', 'business_owner');
        $this->actingAs($admin)->patchJson('/api/admin/users/'.$admin->id, ['roles' => ['user']])->assertStatus(422);
        $this->actingAs($admin)->patchJson('/api/admin/users/'.$admin->id, ['roles' => ['user']])->assertStatus(422);
    }
}
