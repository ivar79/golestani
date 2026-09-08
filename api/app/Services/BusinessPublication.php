<?php
namespace App\Services;
use App\Models\Business;
class BusinessPublication
{
    public static function invalidate(Business $business): void
    {
        // Owner edits can never lift an administrator's suspension.
        if ($business->status !== 'suspended') {
            $business->status = 'pending';
            $business->moderation_note = null;
        }
        // Verification applies to the reviewed content, not future edits.
        $business->badges = array_values(array_diff((array) $business->badges, ['verified']));
        $business->save();
    }
}
