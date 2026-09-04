<?php

namespace App\Http\Controllers\Api\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\SendOtpRequest;
use App\Http\Requests\Auth\VerifyOtpRequest;
use App\Models\User;
use App\Services\Auth\OtpService;
use App\Services\Sms\Contracts\SmsServiceInterface;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    public function __construct(
        private readonly OtpService $otp,
        private readonly SmsServiceInterface $sms,
    ) {}

    /**
     * POST /api/auth/send-otp
     */
    public function sendOtp(SendOtpRequest $request): JsonResponse
    {
        $phone = (string) $request->validated('phone');

        if (! $this->otp->canSend($phone)) {
            return response()->json([
                'message' => 'تعداد درخواست‌های ارسال کد بیش از حد مجاز است. لطفاً ۱۰ دقیقه دیگر تلاش کنید.',
            ], 429);
        }

        $code = $this->otp->generateCode();
        $this->otp->store($phone, $code);
        $this->otp->incrementSendCount($phone);

        $this->sms->send($phone, "کد تأیید شما: {$code}");

        return response()->json([
            'message' => 'کد ارسال شد',
            'expires_in' => OtpService::TTL_SECONDS,
        ]);
    }

    /**
     * POST /api/auth/verify-otp
     */
    public function verifyOtp(VerifyOtpRequest $request): JsonResponse
    {
        $phone = (string) $request->validated('phone');
        $code = (string) $request->validated('code');

        if (! $this->otp->canVerify($phone)) {
            return response()->json([
                'message' => 'تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً ۱۵ دقیقه دیگر تلاش کنید.',
            ], 429);
        }

        if (! $this->otp->verify($phone, $code)) {
            $this->otp->incrementAttempts($phone);

            return response()->json([
                'message' => 'کد تأیید نامعتبر است یا منقضی شده است.',
            ], 422);
        }

        $user = User::where('phone', $phone)->first();

        if ($user && $user->hasRole('admin')) {
            return response()->json([
                'message' => 'حساب‌های مدیریت باید از طریق صفحه ورود اختصاصی مدیران وارد شوند.',
            ], 403);
        }

        if (! $user instanceof User) {
            $user = User::create([
                'phone' => $phone,
                'is_active' => true,
            ]);

            // Master prompt: the default 'user' role is assigned to NEW users only.
            $user->assignRole('user');
        }

        if (! $user->is_active) {
            return response()->json([
                'message' => 'حساب کاربری شما غیرفعال است.',
            ], 403);
        }

        $this->otp->clearAttempts($phone);

        $user->tokens()->delete();
        // P0: per-token expiry so leaked tokens self-expire (Sanctum expires_at).
        $token = $user->createToken('auth-token', ['*'], now()->addDays(7))->plainTextToken;

        return response()->json([
            'token' => $token,
            'token_type' => 'Bearer',
            'user' => [
                'id' => $user->id,
                'phone' => $user->phone,
                'roles' => $user->roles->pluck('name'),
                'permissions' => $user->permissionList(),
            ],
        ]);
    }

    /**
     * POST /api/auth/admin/login
     * Dedicated admin login via password.
     */
    public function loginAdmin(Request $request): JsonResponse
    {
        $data = $request->validate([
            'identifier' => ['required', 'string'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('phone', $data['identifier'])
                    ->orWhere('email', $data['identifier'])
                    ->first();

        if (! $user || ! Hash::check($data['password'], (string) $user->password)) {
            return response()->json([
                'message' => 'اطلاعات ورود نادرست است.',
            ], 422);
        }

        if (! $user->is_active) {
            return response()->json([
                'message' => 'حساب کاربری شما غیرفعال است.',
            ], 403);
        }

        if (! $user->hasRole('admin')) {
            return response()->json([
                'message' => 'دسترسی غیرمجاز. این بخش تنها برای مدیران سیستم است.',
            ], 403);
        }

        $user->tokens()->delete();
        $token = $user->createToken('admin-token', ['*'], now()->addDays(7))->plainTextToken;

        return response()->json([
            'token' => $token,
            'token_type' => 'Bearer',
            'user' => [
                'id' => $user->id,
                'phone' => $user->phone,
                'roles' => $user->roles->pluck('name'),
                'permissions' => $user->permissionList(),
            ],
        ]);
    }

    /**
     * POST /api/auth/verify-recovery
     *
     * Emergency Admin Recovery: backup login when the SMS provider is down.
     * Expects the admin's phone number plus a recovery code that was issued
     * out-of-band (see `php artisan admin:recovery-code`). Codes are stored
     * hashed and are single-use; a successful login rotates the code.
     */
    public function verifyRecovery(Request $request): JsonResponse
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'regex:/^09\\d{9}$/'],
            'code' => ['required', 'string', 'max:64'],
        ]);

        $user = User::where('phone', $data['phone'])->first();

        if (
            ! $user instanceof User
            || ! $user->recovery_code
            || ! Hash::check((string) $data['code'], (string) $user->recovery_code)
        ) {
            return response()->json([
                'message' => 'کد بازیابی نامعتبر است.',
            ], 422);
        }

        if (! $user->is_active) {
            return response()->json([
                'message' => 'حساب کاربری شما غیرفعال است.',
            ], 403);
        }

        // Single use: rotate immediately so a leaked code can't be replayed.
        $user->recovery_code = null;
        $user->save();

        $user->tokens()->delete();
        // P0: recovery tokens expire on the same 7-day policy until P2 hardens them.
        $token = $user->createToken('recovery-login', ['*'], now()->addDays(7))->plainTextToken;

        return response()->json([
            'token' => $token,
            'token_type' => 'Bearer',
            'user' => [
                'id' => $user->id,
                'phone' => $user->phone,
                'roles' => $user->roles->pluck('name'),
            ],
        ]);
    }

    /**
     * PUT /api/auth/location  [auth:sanctum]
     *
     * M1 (Phase 3): persist the user's chosen map location. Nullable fields:
     * an empty/null payload clears the saved location. The optional label is
     * a human-readable name (city/neighborhood) shown in the UI.
     */
    public function updateLocation(Request $request): JsonResponse
    {
        $data = $request->validate([
            'latitude' => ['nullable', 'numeric', 'between:-90,90', 'required_with:longitude'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180', 'required_with:latitude'],
            'label' => ['nullable', 'string', 'max:120'],
        ]);

        $user = $request->user();
        $user->update([
            'latitude' => isset($data['latitude']) ? round((float) $data['latitude'], 7) : null,
            'longitude' => isset($data['longitude']) ? round((float) $data['longitude'], 7) : null,
            'location_label' => $data['label'] ?? null,
        ]);

        return response()->json([
            'location' => $user->only('latitude', 'longitude', 'location_label'),
        ]);
    }

    /**
     * POST /api/auth/logout  [auth:sanctum]
     */
    public function logout(Request $request): JsonResponse
    {
        $token = $request->user()->currentAccessToken();
        if ($token) {
            $token->delete();
        }

        return response()->json([
            'message' => 'خروج موفق',
        ]);
    }

    /**
     * GET /api/auth/me  [auth:sanctum]
     */
    public function me(Request $request): JsonResponse
    {
        $user = $request->user();

        return response()->json([
            'id' => $user->id,
            'phone' => $user->phone,
            'roles' => $user->roles->pluck('name'),
            'permissions' => $user->permissionList(),
            'location' => $user->only('latitude', 'longitude', 'location_label'),
            'created_at' => $user->created_at?->toIso8601String(),
        ]);
    }
}
