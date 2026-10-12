<?php
namespace App\Http\Requests\Showcase;
use Illuminate\Foundation\Http\FormRequest;
class ShowcaseRequest extends FormRequest { public function authorize(): bool { /* matches the route group's role list (designer added in 342c7f5) */ return (bool)($this->user()?->hasAnyRole(['business_owner', 'designer', 'admin'])); } public function rules(): array { return ['title'=>['required','string','max:160'],// The real, plan-aware limit is the `max_description_length`
 // ENTITLEMENT, enforced in ShowcaseController (server-side). This is
 // only the technical ceiling that keeps an absurd payload out of the DB.
 'description'=>['nullable','string','max:20000'],'price'=>['nullable','integer','min:0'],'is_published'=>['boolean'], 'image' => ['nullable', 'image', 'max:5120']]; } }
