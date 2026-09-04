<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void { Schema::create('businesses', function (Blueprint $table): void {
  $table->id(); $table->foreignId('user_id')->constrained()->cascadeOnDelete(); $table->string('name'); $table->string('slug')->unique();
  $table->string('category')->nullable(); $table->json('services')->nullable(); $table->text('description')->nullable(); $table->string('phone')->nullable(); $table->string('email')->nullable(); $table->text('address')->nullable(); $table->string('city')->nullable(); $table->string('neighborhood')->nullable(); $table->decimal('latitude',10,7)->nullable(); $table->decimal('longitude',10,7)->nullable(); $table->json('social_links')->nullable(); $table->json('badges')->nullable(); $table->enum('status',['draft','pending','approved','rejected','suspended'])->default('draft'); $table->text('moderation_note')->nullable(); $table->timestamps(); $table->index(['status','city']); });
  if (DB::connection()->getDriverName()==='pgsql') { DB::statement("ALTER TABLE businesses ADD CONSTRAINT businesses_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90)"); DB::statement("ALTER TABLE businesses ADD CONSTRAINT businesses_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)"); }
 }
 public function down(): void { Schema::dropIfExists('businesses'); }
};
