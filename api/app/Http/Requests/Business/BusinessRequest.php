<?php
namespace App\Http\Requests\Business;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
class BusinessRequest extends FormRequest
{
    public function authorize(): bool
    {
        $u = $this->user();
        return (bool) ($u && $u->is_active && ($u->hasRole('business_owner') || $u->hasRole('admin') || $u->hasRole('user')));
    }
    public function rules(): array
    {
        return [
            'name' => ['required','string','max:120'],
            'category' => ['nullable','string','max:120'],
            'services' => ['nullable','array','max:30'],
            'services.*' => ['required','string','max:120','distinct'],
            'description' => ['nullable','string','max:5000'],
            'phone' => ['nullable','string','max:30','regex:/^[0-9۰-۹٠-٩+() .\-]+$/u'],
            'email' => ['nullable','email','max:255'],
            'address' => ['nullable','string','max:1000'],
            'city' => ['nullable','string','max:120'],
            'neighborhood' => ['nullable','string','max:120'],
            'latitude' => ['nullable','numeric','between:-90,90'],
            'longitude' => ['nullable','numeric','between:-180,180'],
            'social_links' => ['nullable','array','max:10'],
            'social_links.*' => ['nullable','string','max:500','url:http,https'],
            // Paths cannot be assigned directly by owners. Use validated uploads.
            'logo' => ['prohibited'], 'cover_image' => ['prohibited'],
            'onboarding_path' => ['nullable','integer','in:1,2,3'],
        ];
    }
    protected function prepareForValidation(): void
    {
        foreach (['name','category','description','phone','email','address','city','neighborhood'] as $field) {
            if (is_string($this->input($field))) $this->merge([$field => trim($this->input($field))]);
        }
    }
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $v): void {
            $business = $this->route('business');
            $lat = $this->exists('latitude') ? $this->input('latitude') : $business?->latitude;
            $lng = $this->exists('longitude') ? $this->input('longitude') : $business?->longitude;
            if (($lat === null) !== ($lng === null)) $v->errors()->add('latitude', 'طول و عرض جغرافیایی را با هم وارد یا پاک کنید.');
            $links = $this->input('social_links', []);
            if (!is_array($links)) return;
            foreach ($links as $key => $url) {
                if (!preg_match('/^[a-zA-Z0-9_-]{1,40}$/', (string) $key) || in_array($key, ['__proto__','prototype','constructor'], true)) {
                    $v->errors()->add('social_links', 'نام شبکه اجتماعی معتبر نیست.');
                }
                // Reject credentials and embedded control characters in URLs.
                if (is_string($url) && (str_contains($url, '\\') || preg_match('/[\x00-\x20\x7f]/', $url) || parse_url($url, PHP_URL_USER) !== null || parse_url($url, PHP_URL_PASS) !== null)) {
                    $v->errors()->add('social_links.'.$key, 'لینک معتبر HTTPS یا HTTP وارد کنید.');
                }
            }
        });
    }
}
