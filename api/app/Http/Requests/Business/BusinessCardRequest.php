<?php

namespace App\Http\Requests\Business;

use Illuminate\Foundation\Http\FormRequest;

class BusinessCardRequest extends FormRequest
{
    public function authorize(): bool
    {
        return (bool) ($this->user()?->hasRole('business_owner') || $this->user()?->hasRole('admin'));
    }

    public function rules(): array
    {
        return [
            // Phase 4: five distinct card templates.
            'template' => ['nullable', 'in:classic,midnight,emerald,local,creative'],
            'theme' => ['nullable', 'in:navy,emerald,warm'],
            'font_size' => ['nullable', 'in:small,medium,large'],
            'font_family' => ['nullable', 'in:vazir,sans,serif'],
            'export_format' => ['nullable', 'in:png,jpg,svg,pdf'],
            'creation_type' => ['nullable', 'in:uploaded,generated,designer_order'],
            // Print files live on the PRIVATE card_files disk (validated strictly).
            'print_file' => ['nullable', 'file', 'mimes:jpeg,png,jpg,webp,pdf', 'max:10240'],
            'delete_print_file' => ['nullable', 'boolean'],
            'front_image' => ['nullable', 'image', 'max:5120'],
            'back_image' => ['nullable', 'image', 'max:5120'],
            // Phase 4 layered editor document. Structure-validated in the
            // controller (whitelist, size cap) — never trusted as-is.
            'design_json' => ['nullable', 'array'],
        ];
    }
}
