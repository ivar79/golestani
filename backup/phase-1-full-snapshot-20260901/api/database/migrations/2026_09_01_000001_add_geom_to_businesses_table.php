<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)");
        DB::statement("CREATE INDEX IF NOT EXISTS businesses_geom_gist ON businesses USING GIST (geom)");
        DB::statement("UPDATE businesses SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND geom IS NULL");
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return;
        }

        Schema::table('businesses', function (Blueprint $table): void {
            $table->dropIndex('businesses_geom_gist');
        });
        DB::statement('ALTER TABLE businesses DROP COLUMN IF EXISTS geom');
    }
};
