<?php
namespace App\Http\Requests\Business;
use Illuminate\Foundation\Http\FormRequest;
class BusinessCardRequest extends FormRequest {
 public function authorize(): bool { return (bool) ($this->user()?->hasRole('business_owner') || $this->user()?->hasRole('admin')); }
 public function rules(): array { return ['template'=>['required','in:classic,midnight,emerald'],'theme'=>['required','in:navy,emerald,warm'],'font_size'=>['required','in:small,medium,large'],'export_format'=>['nullable','in:png,jpg']]; }
}
