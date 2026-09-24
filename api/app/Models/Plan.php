<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
class Plan extends Model {
 use HasFactory;
 // NOTE: `features` IS admin-settable (validated against the entitlement
 // catalog in SubscriptionController) but is NEVER client-settable on the
 // purchase path — SubscriptionController@store reads the plan from the DB.
 protected $fillable=['name','slug','description','price','currency','duration_days','features','sort_order','is_featured','is_public','is_active'];
 protected function casts(): array { return ['features'=>'array','is_active'=>'boolean','is_featured'=>'boolean','is_public'=>'boolean']; }
 /** Plans visible on the pricing page, ordered by admin sort_order. */
 public function scopePublic($query) { return $query->where('is_active',true)->where('is_public',true)->orderBy('sort_order')->orderBy('price'); }
 public function subscriptions(): HasMany { return $this->hasMany(Subscription::class); }
}
