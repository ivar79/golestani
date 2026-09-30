<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A PRIVATE per-user card template. No moderation, no gallery — the owner
 * manages it end-to-end. Deleting (soft) the template NEVER deletes assets
 * the stored design references: cards applied from it keep rendering.
 */
class UserCardTemplate extends Model
{
    use SoftDeletes;

    protected $fillable = ['user_id', 'name_fa', 'category', 'design_json'];

    public function owner()
    {
        return $this->belongsTo(User::class, 'user_id');
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
