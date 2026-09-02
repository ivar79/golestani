<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
class Advertisement extends Model {
 use HasFactory;
 protected $fillable=['business_id','slot','title','target_url','image_path','status','starts_at','ends_at','admin_note'];
 protected function casts(): array { return ['starts_at'=>'date','ends_at'=>'date']; }
 public function business(): BelongsTo { return $this->belongsTo(Business::class); }
}
