<?php

namespace Database\Seeders;

use App\Models\Role;
use Illuminate\Database\Seeder;

class RoleSeeder extends Seeder
{
    private const ROLES = [
        ['name' => 'admin', 'display_name' => 'مدیر کل سیستم'],
        ['name' => 'business_owner', 'display_name' => 'صاحب کسب‌وکار'],
        ['name' => 'designer', 'display_name' => 'طراح'],
        ['name' => 'user', 'display_name' => 'کاربر عادی'],
    ];

    public function run(): void
    {
        foreach (self::ROLES as $role) {
            Role::updateOrCreate(
                ['name' => $role['name']],
                ['display_name' => $role['display_name']],
            );
        }
    }
}
