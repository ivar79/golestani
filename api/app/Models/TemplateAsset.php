<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * The canonical ASSET REGISTRY for template artwork.
 *
 * Every template asset is registered ONCE at upload time; validators resolve
 * every image `src` in a template document against this table instead of
 * trusting client-supplied paths. Rows are IMMUTABLE and never deleted —
 * the asset lifecycle outlives any template that references it.
 *
 * Scopes:
 *   system      — shipped with the product, intentionally public.
 *   submission  — uploaded for a designer gallery submission; becomes public
 *                 the moment its template is approved.
 *   personal    — uploaded for a PRIVATE user template; stays private and is
 *                 served only through the ownership-checked private endpoint.
 */
class TemplateAsset extends Model
{
    protected $fillable = ['path', 'scope', 'owner_id', 'mime', 'width', 'height', 'bytes'];

    public function owner()
    {
        return $this->belongsTo(User::class, 'owner_id');
    }
}
