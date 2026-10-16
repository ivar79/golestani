<?php

namespace App\Http\Requests\Wallet;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Designer payout request. The client sends ONLY the amount — the sheba and
 * its holder name are snapshotted from the designer's OWN registered account,
 * so a request can never be pointed at someone else's account.
 */
class StoreWithdrawalRequest extends FormRequest
{
    public function authorize(): bool
    {
        $user = $this->user();

        return (bool) ($user && $user->is_active && ($user->hasRole('designer') || $user->hasRole('admin')));
    }

    public function rules(): array
    {
        return [
            'amount' => ['required', 'integer', 'min:1', 'max:999999999999'],
        ];
    }
}
