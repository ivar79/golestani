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
    protected $fillable = ['name', 'slug', 'description', 'price', 'currency', 'duration_days', 'features', 'sort_order', 'tier', 'is_featured', 'is_public', 'is_active'];

    /** Gateway amount in RIAL (ZarinPal unit). The ONLY ×10 in the codebase. */
    public function priceRial(): int
    {
        return (int) $this->price * 10;
    }

    protected function casts(): array
    {
        return ['features' => 'array', 'is_active' => 'boolean', 'is_featured' => 'boolean', 'is_public' => 'boolean', 'tier' => 'integer'];
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
