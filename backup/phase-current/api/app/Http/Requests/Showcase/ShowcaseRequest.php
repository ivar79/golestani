<?php
namespace App\Http\Requests\Showcase;
use Illuminate\Foundation\Http\FormRequest;
class ShowcaseRequest extends FormRequest { public function authorize(): bool { return (bool)($this->user()?->hasRole('business_owner') || $this->user()?->hasRole('admin')); } public function rules(): array { return ['title'=>['required','string','max:160'],'description'=>['nullable','string','max:3000'],'price'=>['nullable','integer','min:0'],'is_published'=>['boolean']]; } }
