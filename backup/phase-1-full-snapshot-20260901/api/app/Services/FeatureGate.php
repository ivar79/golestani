<?php
namespace App\Services;
use App\Models\Business;
use Illuminate\Support\Carbon;
class FeatureGate {
 public function activeSubscription(Business $business): ?object { return $business->subscriptions()->with('plan')->where('status','active')->where(function($q): void { $q->whereNull('end_date')->orWhereDate('end_date','>=',Carbon::today()); })->latest('end_date')->first(); }
 public function allows(Business $business,string $feature): bool { $subscription=$this->activeSubscription($business); return (bool)($subscription?->plan?->features[$feature] ?? false); }
}
