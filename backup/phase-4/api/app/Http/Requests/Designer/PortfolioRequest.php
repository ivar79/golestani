<?php
namespace App\Http\Requests\Designer;
use Illuminate\Foundation\Http\FormRequest;
class PortfolioRequest extends FormRequest {
 public function authorize(): bool { return (bool) ($this->user()?->hasRole('designer') || $this->user()?->hasRole('admin')); }
 public function rules(): array { return ['title'=>['required','string','max:160'],'description'=>['nullable','string','max:3000'],'file'=>['required','file','mimetypes:image/jpeg,image/png,application/pdf','max:10240']]; }
}
