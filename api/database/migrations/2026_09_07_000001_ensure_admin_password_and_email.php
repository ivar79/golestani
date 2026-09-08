<?php
use Illuminate\Database\Migrations\Migration;
return new class extends Migration {
    // Security fix: migrations must never provision a public, fixed password
    // or overwrite an existing administrator's credentials. On a database
    // where this migration already ran, explicitly rotate that password with
    // `php artisan admin:provision PHONE` before making the site public.
    public function up(): void {}
    public function down(): void {}
};
