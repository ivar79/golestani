<?php
namespace App\Services;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
class BusinessAudit
{
    // Success events are transactional. Never pass raw input, PII or credentials.
    public static function record(Request $request, string $event, int $id, array $metadata = []): void
    {
        DB::table('audit_events')->insert([
            'actor_id' => $request->user()?->id, 'event' => $event,
            'subject_type' => 'business', 'subject_id' => $id,
            'metadata' => json_encode($metadata, JSON_THROW_ON_ERROR), 'created_at' => now(),
        ]);
    }
}
