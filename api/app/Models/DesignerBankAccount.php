<?php

namespace App\Models;

use App\Support\Sheba;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The designer's registered payout account (شبا + نام صاحب حساب).
 *
 * ONE account per user (`user_id` is unique). A withdrawal request may only
 * ever target the OWNER'S registered sheba — the API never accepts an
 * arbitrary account number, so a compromised session cannot redirect a payout
 * to an attacker's account.
 *
 * The `sheba` mutator normalizes on write (Persian/Arabic digits, spaces and
 * dashes → canonical `IR` + 24 digits) so every stored value is comparable;
 * validity (MOD-97) is enforced by the FormRequest via App\Support\Sheba.
 */
class DesignerBankAccount extends Model
{
    use HasFactory;

    protected $fillable = ['user_id', 'sheba', 'owner_name'];

    protected function casts(): array
    {
        return [
            'user_id' => 'integer',
            // A DATETIME, not a string: the cooldown maths calls ->addHours()
            // on it (WithdrawalService::bankCooldownUntil), which fatals on a
            // raw string column value.
            'bank_changed_at' => 'datetime',
        ];
    }

    /** Canonical storage form regardless of what the caller typed. */
    public function setShebaAttribute(mixed $value): void
    {
        $this->attributes['sheba'] = Sheba::normalize(is_string($value) ? $value : null);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
