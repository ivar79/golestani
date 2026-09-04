<?php

namespace App\Http\Requests\Auth;

use App\Support\Digits;
use Illuminate\Foundation\Http\FormRequest;

class SendOtpRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'phone' => Digits::toEnglish($this->input('phone')),
        ]);
    }

    public function rules(): array
    {
        return [
            'phone' => ['required', 'string', 'regex:/^09\d{9}$/'],
        ];
    }

    public function messages(): array
    {
        return [
            'phone.required' => 'شماره موبایل الزامی است.',
            'phone.regex' => 'شماره موبایل معتبر نیست. (مثال: 09123456789)',
        ];
    }
}
