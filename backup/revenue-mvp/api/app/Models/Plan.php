<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
class Plan extends Model {
 use HasFactory;
 protected $fillable=['name','price','duration_days','features','is_active'];
 protected function casts(): array { return ['features'=>'array','is_active'=>'boolean']; }
 public function subscriptions(): HasMany { return $this->hasMany(Subscription::class); }
}
