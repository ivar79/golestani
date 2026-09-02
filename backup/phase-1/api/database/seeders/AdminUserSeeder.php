<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $admin = User::updateOrCreate(
            ['phone' => '09000000000'],
            ['name' => 'Admin', 'is_active' => true],
        );

        $admin->assignRole('admin');
    }
}
