<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A data-driven card template (admin-created or designer-submitted).
 *
 * CONTRACT:
 *   - `design_json` is the SINGLE source of truth for the template's look.
 *     There is no separate background column — the gallery/apply payloads
 *     extract the background from inside the document.
 *   - Visibility = approved() scope: `deleted_at IS NULL AND status=approved`
 *     is the ONE definition of "usable in gallery and apply". Every reader
 *     goes through it — pending/rejected/archived/trashed never leak.
 *   - Plan gating lives in card_template_plans (stable plan_id pivot), never
 *     in plan names, never hardcoded.
 */
class CardTemplate extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'slug', 'name_fa', 'category', 'origin', 'design_json',
        'uploaded_by', 'status', 'rejection_reason', 'sort_order',
    ];

    public function plans()
    {
        return $this->belongsToMany(Plan::class, 'card_template_plans')->withTimestamps();
    }

    public function uploader()
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    /**
     * The ONE public-visibility scope: gallery listing, apply authorization
     * and admin default listings all resolve through this. A soft-deleted or
     * non-approved row can never pass it.
     */
    public function scopeApproved($query)
    {
        return $query->whereNull('deleted_at')->where('status', 'approved');
    }

    /** Extract the document background (single source of truth = design_json). */
    public function background(): ?string
    {
        $doc = json_decode($this->design_json, true);

        return is_array($doc) && isset($doc['background']) && is_string($doc['background'])
            ? $doc['background']
            : null;
    }

    /** Decoded design document, or null when malformed. */
    public function document(): ?array
    {
        $doc = json_decode($this->design_json, true);

        return is_array($doc) ? $doc : null;
    }
}
