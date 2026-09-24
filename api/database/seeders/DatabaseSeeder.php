<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            RoleSeeder::class,
            PermissionSeeder::class,
            AdminUserSeeder::class,
            HomepageSeeder::class,
            // Example Starter/Professional plan rows (placeholder business
            // values — the real catalog is admin-configured in production).
            EditorPlanSeeder::class,
        ]);

        // Phase 3 cold start: unclaimed map pins. Skipped in production unless
        // explicitly forced (php artisan db:seed --force) — demo data must
        // never reach a live database by accident.
        $forced = in_array('--force', (array) ($_SERVER['argv'] ?? []), true);
        if (app()->environment('production') && ! $forced) {
            $this->command?->warn('Skipping UnclaimedBusinessSeeder in production (use --force to override).');

            return;
        }

        $this->call([
            UnclaimedBusinessSeeder::class,
        ]);
    }
}
