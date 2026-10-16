<?php

namespace App\Http\Requests\Wallet;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;


/**
 * Admin decision on a payout request. Three explicit actions, each with its
 * own mandatory evidence:
 *   approve → optional note + OPTIONAL «تاریخ پیش‌بینی‌شدهٔ واریز»
 *   reject  → a REASON is required (the designer is told why)
 *   pay     → the MANUAL payment tracking reference is required
 * There is no "set status" free-for-all: the money state machine is the only
 * thing this endpoint can move.
 *
 * The expected payout date is OPTIONAL and only meaningful on approval: when
 * it is omitted the service fills now + the admin-configured settlement window
 * (`site_settings`), so the designer never sees an open-ended promise.
 */
class ModerateWithdrawalRequest extends FormRequest
{
    public function authorize(): bool
    {
        $user = $this->user();

        return (bool) ($user && $user->is_active && $user->hasRole('admin'));
    }

    public function rules(): array
    {
        return [
            'action' => ['required', Rule::in(['approve', 'reject', 'pay'])],
            'admin_note' => [
                'nullable', 'string', 'max:1000',
                Rule::requiredIf(fn (): bool => $this->input('action') === 'reject'),
            ],
            'payment_reference' => [
                'nullable', 'string', 'max:160',
                Rule::requiredIf(fn (): bool => $this->input('action') === 'pay'),
            ],
            'expected_paid_at' => ['nullable', 'date', 'before:+366 days'],
        ];
    }

    public function messages(): array
    {
        return [
            'admin_note.required' => 'برای رد درخواست، ثبت دلیل الزامی است.',
            'payment_reference.required' => 'برای ثبت پرداخت، شماره پیگیری واریز الزامی است.',
            'expected_paid_at.date' => 'تاریخ پیش‌بینی‌شدهٔ واریز نامعتبر است.',
        ];
    }
}
