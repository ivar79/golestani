<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
/**
 * A Subscription is an EVENT that happened to a business: it references a
 * plan but carries its OWN money snapshot (price/currency/duration, frozen
 * at request time) and — after admin activation — its own entitlement
 * snapshot (POLICY snapshot_entitlements), so future plan edits never
 * retroactively change existing subscribers.
 *
 * SECURITY: plan_id, plan_name, price_amount, price_currency, duration_days
 * and entitlements are never accepted from client input. store() copies them
 * from the DB plan; moderate() writes the entitlement snapshot server-side.
 */
class Subscription extends Model {
 use HasFactory;
 protected $fillable=['business_id','plan_id','status','receipt_reference','receipt_path','receipt_name','receipt_mime','start_date','end_date','admin_note'];
 protected function casts(): array { return ['start_date'=>'date','end_date'=>'date','entitlements'=>'array']; }
 /** Money snapshot values, falling back to the (current) plan for legacy rows. */
 public function moneySnapshot(): array { return ['plan_name'=>$this->plan_name ?? $this->plan?->name,'price_amount'=>$this->price_amount ?? $this->plan?->price,'price_currency'=>$this->price_currency ?? $this->plan?->currency ?? 'IRR','duration_days'=>$this->duration_days ?? $this->plan?->duration_days]; }
 public function business(): BelongsTo { return $this->belongsTo(Business::class); }
 public function plan(): BelongsTo { return $this->belongsTo(Plan::class); }
}
