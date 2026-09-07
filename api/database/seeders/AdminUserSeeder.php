<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $admin = User::updateOrCreate(
            ['phone' => '09000000000'],
            [
                'name' => 'مدیر ارشد سامانه',
                'email' => 'admin@golestani.ir',
                'password' => Hash::make('Admin@Golestani2026!'),
                'is_active' => true,
            ],
        );

        $admin->assignRole('admin');
    }
}
