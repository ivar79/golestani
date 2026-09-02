<?php
namespace App\Http\Requests\Designer;
use Illuminate\Foundation\Http\FormRequest;
class DesignerRequest extends FormRequest {
 public function authorize(): bool { return (bool) ($this->user()?->hasRole('designer') || $this->user()?->hasRole('admin')); }
 public function rules(): array { return ['display_name'=>['required','string','max:120'],'bio'=>['nullable','string','max:3000'],'phone'=>['nullable','string','max:30'],'email'=>['nullable','email','max:255'],'social_links'=>['nullable','array'],'social_links.*'=>['nullable','url','max:500']]; }
 protected function prepareForValidation(): void { foreach(['display_name','bio','phone','email'] as $field) if(is_string($this->input($field))) $this->merge([$field=>trim($this->input($field))]); }
}
