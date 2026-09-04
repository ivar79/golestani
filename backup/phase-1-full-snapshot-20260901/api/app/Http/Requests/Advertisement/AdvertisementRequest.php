<?php
namespace App\Http\Requests\Advertisement;
use Illuminate\Foundation\Http\FormRequest;
class AdvertisementRequest extends FormRequest { public function authorize(): bool { return (bool)($this->user()?->hasRole('business_owner') || $this->user()?->hasRole('admin')); } public function rules(): array { return ['slot'=>['required','string','max:60'],'title'=>['required','string','max:160'],'target_url'=>['required','url','max:500'],'starts_at'=>['nullable','date'],'ends_at'=>['nullable','date','after_or_equal:starts_at']]; } }
