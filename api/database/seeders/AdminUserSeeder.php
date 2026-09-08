<?php
namespace Database\Seeders;
use Illuminate\Database\Seeder;
class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $this->command?->warn('No default administrator password is created. Run php artisan admin:provision PHONE.');
    }
}
