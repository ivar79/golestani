<?php

namespace App\Http\Requests\Auth;

use App\Support\Digits;
use Illuminate\Foundation\Http\FormRequest;

class VerifyOtpRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'phone' => Digits::toEnglish($this->input('phone')),
            'code' => Digits::toEnglish($this->input('code')),
        ]);
    }

    public function rules(): array
    {
        return [
            'phone' => ['required', 'string', 'regex:/^09\d{9}$/'],
            'code' => ['required', 'string', 'digits:5'],
        ];
    }

    public function messages(): array
    {
        return [
            'phone.required' => 'شماره موبایل الزامی است.',
            'phone.regex' => 'شماره موبایل معتبر نیست.',
            'code.required' => 'کد تأیید الزامی است.',
            'code.digits' => 'کد تأیید باید ۵ رقم باشد.',
        ];
    }
}
