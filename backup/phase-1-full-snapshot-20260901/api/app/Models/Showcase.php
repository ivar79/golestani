<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
class Showcase extends Model {
 use HasFactory;
 protected $fillable=['business_id','title','description','price','image_path','is_published'];
 protected function casts(): array { return ['is_published'=>'boolean']; }
 public function business(): BelongsTo { return $this->belongsTo(Business::class); }
}
