<?php

namespace App\Http\Requests\Wallet;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Admin balance correction. The ONLY way an admin may change a designer's
 * money: an `adjustment` ledger row with a mandatory reason. There is
 * deliberately no endpoint that writes a balance directly.
 */
class AdjustWalletRequest extends FormRequest
{
    public function authorize(): bool
    {
        $user = $this->user();

        return (bool) ($user && $user->is_active && $user->hasRole('admin'));
    }

    public function rules(): array
    {
        return [
            'amount' => ['required', 'integer', 'not_in:0', 'min:-999999999999', 'max:999999999999'],
            'reason' => ['required', 'string', 'min:3', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'amount.not_in' => 'مبلغ اصلاح نمی‌تواند صفر باشد.',
            'reason.required' => 'دلیل اصلاح موجودی الزامی است.',
        ];
    }
}
