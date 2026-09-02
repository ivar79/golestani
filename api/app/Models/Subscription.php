<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
class Subscription extends Model {
 use HasFactory;
 protected $fillable=['business_id','plan_id','status','receipt_reference','start_date','end_date','admin_note'];
 protected function casts(): array { return ['start_date'=>'date','end_date'=>'date']; }
 public function business(): BelongsTo { return $this->belongsTo(Business::class); }
 public function plan(): BelongsTo { return $this->belongsTo(Plan::class); }
}
