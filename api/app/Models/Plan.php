<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Plan extends Model
{
    use HasFactory;

    // NOTE: `features` IS admin-settable (validated against the entitlement
    // catalog in SubscriptionController) but is NEVER client-settable on the
    // purchase path — SubscriptionController@store reads the plan from the DB.
    //
    // MONEY UNIT CONTRACT (payment-era, locked by PaymentZarinPalAmountTest):
    //   `price` (and the subscription money snapshot `price_amount`) is in
    //   TOMAN — the display/report unit every UI renders («۲۴۹٬۰۰۰ تومان»). The
    //   GATEWAY unit is RIAL: ZarinPal is charged priceRial() = price × 10
    //   (۲٬۴۹۰٬۰۰۰ ریال), and payment_transactions.amount stores exactly that
    //   rial value. The ×10 conversion lives in priceRial() and nowhere else —
    //   never scatter ÷10 / ×10 arithmetic around the codebase.
    // `commission_percent` (designer referral share, 0..100) IS admin-settable
    // from the plan editor. It is read at COMMISSION ACCRUAL time only — the
    // wallet service multiplies it by the subscription's own money snapshot
    // (`price_amount`, TOMAN → RIAL through priceRial()), so a later plan edit
    // can never rewrite a commission that was already accrued.
    protected $fillable = ['name', 'slug', 'description', 'price', 'commission_percent', 'currency', 'duration_days', 'features', 'sort_order', 'tier', 'is_featured', 'is_public', 'is_active'];

    /** Gateway amount in RIAL (ZarinPal unit). The ONLY ×10 in the codebase. */
    public function priceRial(): int
    {
        return (int) $this->price * 10;
    }

    protected function casts(): array
    {
        return ['features' => 'array', 'is_active' => 'boolean', 'is_featured' => 'boolean', 'is_public' => 'boolean', 'tier' => 'integer', 'commission_percent' => 'integer'];
    }

    /** Plans visible on the pricing page, ordered by admin sort_order. */
    public function scopePublic($query)
    {
        return $query->where('is_active', true)->where('is_public', true)->orderBy('sort_order')->orderBy('price');
    }

    public function subscriptions(): HasMany
    {
        return $this->hasMany(Subscription::class);
    }
}
