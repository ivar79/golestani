<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * The ONE writer for the `audit_events` trail.
 *
 * Schema contract (2026_09_08_000001): actor_id nullable index, event (100),
 * subject_type (60, NOT nullable), subject_id nullable, metadata json,
 * created_at. No cascading foreign keys — deleted objects keep their history.
 *
 * Rules:
 *   - never pass raw request input, credentials or PII in metadata;
 *   - metadata is always a JSON OBJECT (json_encode of an associative array).
 */
class AuditTrail
{
    public static function record(
        ?int $actorId,
        string $event,
        string $subjectType,
        ?int $subjectId = null,
        array $metadata = [],
    ): void {
        DB::table('audit_events')->insert([
            'actor_id' => $actorId,
            'event' => $event,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'metadata' => json_encode($metadata, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
            'created_at' => now(),
        ]);
    }
}
