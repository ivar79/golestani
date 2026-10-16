<?php

namespace App\Http\Requests\Wallet;

use App\Support\Sheba;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Register/change the payout bank account. Requires the OTP that was just
 * sent to the account's own phone (`POST /designer/wallet/bank-account/otp`),
 * so a stolen session alone can never redirect a payout.
 */
class StoreBankAccountRequest extends FormRequest
{
    public function authorize(): bool
    {
        $user = $this->user();

        return (bool) ($user && $user->is_active && ($user->hasRole('designer') || $user->hasRole('admin')));
    }

    public function rules(): array
    {
        return [
            // Persian/Arabic digits, spaces and dashes are accepted and
            // normalized server-side; the MOD-97 check digit is what decides.
            'sheba' => ['required', 'string', 'max:64', function (string $attribute, mixed $value, \Closure $fail): void {
                if (! Sheba::isValid(is_string($value) ? $value : null)) {
                    $fail('شماره شبا نامعتبر است. قالب درست: IR و پس از آن ۲۴ رقم.');
                }
            }],
            'owner_name' => ['required', 'string', 'min:3', 'max:120', 'regex:/^[\p{L}\p{M}\s.\-]+$/u'],
            'code' => ['required', 'string', 'digits:5'],
        ];
    }

    public function messages(): array
    {
        return [
            'owner_name.regex' => 'نام صاحب حساب فقط می‌تواند شامل حروف باشد.',
            'code.digits' => 'کد تأیید باید ۵ رقم باشد.',
        ];
    }
}
