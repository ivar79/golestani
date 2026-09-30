<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Data-driven Template System (Phase 5).
 *
 * Four tables + one column:
 *   card_templates         — DB templates (origin: admin | designer) that
 *                            pass moderation and join the public gallery.
 *   card_template_plans    — template ↔ plan pivot on STABLE plan_id (never
 *                            plan names — renames must not break grants).
 *   user_card_templates    — PRIVATE per-user templates; no moderation;
 *                            only the owner sees and applies them.
 *   template_assets        — the canonical ASSET REGISTRY. Every template
 *                            asset path is registered once at upload time;
 *                            validation RESOLVES image `src` references
 *                            against this table instead of trusting the
 *                            client. Registry rows are IMMUTABLE and never
 *                            deleted — deleting a template never deletes an
 *                            asset an existing card may reference.
 *   users.designer_status  — the designer program lifecycle, separate from
 *                            roles and from the custom_templates capability.
 *
 * Lifecycle contract (business state vs trash):
 *   status     — pending|approved|rejected|archived, owned by moderation.
 *   deleted_at — SOFT DELETE only. A row with deleted_at != null is a trashed
 *                record: it appears NOWHERE (gallery, apply, admin lists).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('card_templates', function (Blueprint $table): void {
            $table->id();
            $table->string('slug', 80)->unique();
            $table->string('name_fa', 120);
            $table->string('category', 40)->default('general');
            // Who authored it: admin-created or designer-submitted. Kept even
            // though status governs visibility, so the gallery can be
            // filtered/audited independently per origin.
            $table->enum('origin', ['admin', 'designer'])->default('admin');
            // The SINGLE source of truth: a full whitelisted card document.
            // Deliberately LONGTEXT (not jsonb): template payloads from the
            // builtin catalog export can exceed the 100KB editor document cap
            // because ornament rawD is stored un-fitted; the editor document
            // cap applies at APPLY/SAVE time, not to the template source.
            $table->longText('design_json');
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->enum('status', ['pending', 'approved', 'rejected', 'archived'])->default('pending');
            $table->text('rejection_reason')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->softDeletes();
            $table->timestamps();

            $table->index(['status', 'category']);
            $table->index('origin');
        });

        Schema::create('card_template_plans', function (Blueprint $table): void {
            // One template can serve MANY plans. plan_id is the stable key —
            // a plan display-name rename must never invalidate a grant.
            $table->foreignId('card_template_id')->constrained('card_templates')->cascadeOnDelete();
            $table->foreignId('plan_id')->constrained('plans')->cascadeOnDelete();
            $table->timestamps();

            $table->primary(['card_template_id', 'plan_id']);
        });

        Schema::create('user_card_templates', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('name_fa', 120);
            $table->string('category', 40)->default('general');
            $table->longText('design_json');
            $table->softDeletes();
            $table->timestamps();

            $table->index('user_id');
        });

        Schema::create('template_assets', function (Blueprint $table): void
        {
            $table->id();
            // Public storage path relative to the storage root, e.g.
            // templates/optimized/legal-emerald-gilt-v1.webp or
            // templates/users/42/art-abc123-v1.webp. Unique: the registry is
            // the canonical map from path → owner/scope.
            $table->string('path', 400)->unique();
            // system   — shipped with the product, intentionally public.
            // submission— uploaded for a designer gallery submission; becomes
            //            public the moment the template is approved.
            // personal — uploaded for a PRIVATE user template; stays private.
            $table->enum('scope', ['system', 'submission', 'personal'])->default('personal');
            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('mime', 60);
            $table->unsignedInteger('width')->default(0);
            $table->unsignedInteger('height')->default(0);
            $table->unsignedBigInteger('bytes')->default(0);
            $table->timestamps();

            $table->index(['scope', 'owner_id']);
        });

        Schema::table('users', function (Blueprint $table): void {
            $table->enum('designer_status', ['none', 'pending', 'approved', 'rejected', 'suspended'])
                ->default('none')->after('is_active');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            if (Schema::hasColumn('users', 'designer_status')) {
                $table->dropColumn('designer_status');
            }
        });
        Schema::dropIfExists('template_assets');
        Schema::dropIfExists('user_card_templates');
        Schema::dropIfExists('card_template_plans');
        Schema::dropIfExists('card_templates');
    }
};
