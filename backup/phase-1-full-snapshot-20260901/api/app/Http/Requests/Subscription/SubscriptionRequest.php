<?php
namespace App\Http\Requests\Subscription;
use Illuminate\Foundation\Http\FormRequest;
class SubscriptionRequest extends FormRequest { public function authorize(): bool { return (bool)($this->user()?->hasRole('business_owner') || $this->user()?->hasRole('admin')); } public function rules(): array { return ['plan_id'=>['required','integer','exists:plans,id'],'receipt_reference'=>['nullable','string','max:160']]; } }
