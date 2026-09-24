<?php

namespace App\Http\Controllers\Api\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\SendOtpRequest;
use App\Http\Requests\Auth\VerifyOtpRequest;
use App\Models\User;
use App\Services\Auth\OtpService;
use App\Services\Sms\Contracts\SmsServiceInterface;
use App\Support\Digits;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

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

        try {
            $this->sms->send($phone, "کد تأیید شما: {$code}");
        } catch (\Throwable $e) {
            // Delivery failed (provider timeout/5xx/rejection): drop the stored
            // code and refund the send slot so the user is not billed a window
            // for an SMS they never received.
            $this->otp->discardFailedSend($phone);

            report($e);

            return response()->json([
                'message' => 'ارسال پیامک موقتاً ممکن نیست. لطفاً چند لحظه دیگر دوباره تلاش کنید.',
            ], 503);
        }

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
                // A real PHP boolean: the pgsql driver (see
                // App\Database\PostgresBooleanSafeConnection) binds it as a
                // true SQL boolean. Never store this as 1/0.
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
                'username' => $user->username,
                'avatar' => $user->avatar,
                'roles' => $user->roles->pluck('name'),
                'permissions' => $user->permissionList(),
            ],
        ]);
    }

    /**
     * POST /api/auth/username  [auth:sanctum]
     *
     * Let a logged-in user choose their unique public handle. Returns 409 with
     * three suggestions when the requested handle is already taken — the UI
     * surfaces them directly so the user never hits a dead end.
     */
    public function setUsername(Request $request): JsonResponse
    {
        // Normalize BEFORE validating: casing and stray whitespace must not
        // fail the format rule ('UPPER ' is valid intent, stored as 'upper').
        $request->merge(['username' => strtolower(trim((string) $request->input('username')))]);

        $data = $request->validate([
            // Regex mirrors the DB CHECK (users_username_format_chk). Must start
            // with a letter/digit (no leading underscore).
            'username' => ['required', 'string', 'min:3', 'max:30',
                'regex:/^[a-z0-9][a-z0-9_]{2,29}$/'],
        ]);

        $username = $data['username'];
        $user = $request->user();

        $taken = User::where('username', $username)
            ->where('id', '!=', $user->id)
            ->exists();

        if ($taken) {
            return response()->json([
                'message' => 'این نام کاربری قبلاً گرفته شده است.',
                'suggestions' => $this->usernameSuggestions($username),
            ], 409);
        }

        $user->username = $username;
        $user->save();

        return response()->json([
            'message' => 'نام کاربری با موفقیت ذخیره شد.',
            'username' => $user->username,
        ]);
    }

    /**
     * GET /api/auth/username/check?u=  [auth:sanctum]
     * Live availability probe for the picker UI. Throttled + cheap on purpose.
     */
    public function checkUsername(Request $request): JsonResponse
    {
        $request->merge(['u' => strtolower(trim((string) $request->input('u')))]);

        $data = $request->validate([
            // Must start with a letter/digit (no leading underscore) — same rule
            // as setUsername and the DB CHECK.
            'u' => ['required', 'string', 'min:3', 'max:30',
                'regex:/^[a-z0-9][a-z0-9_]{2,29}$/'],
        ]);

        $username = $data['u'];
        $takenByOther = User::where('username', $username)
            ->where('id', '!=', $request->user()->id)
            ->exists();

        return response()->json([
            'available' => ! $takenByOther,
            'suggestions' => $takenByOther ? $this->usernameSuggestions($username) : [],
        ]);
    }

    /**
     * Three takeable alternatives derived from the requested handle.
     * Suffix digits are probed until unique; capped to keep the query count
     * bounded even under adversarial input.
     */
    private function usernameSuggestions(string $username): array
    {
        $out = [];
        foreach ([1, 2, 7, 9, 21, 88] as $suffix) {
            if (count($out) >= 3) {
                break;
            }
            $candidate = substr($username, 0, 26).$suffix;
            $clash = User::where('username', $candidate)->exists();
            if (! $clash) {
                $out[] = $candidate;
            }
        }

        return $out;
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

        // Accept Persian/Arabic digits and stray whitespace in the identifier
        // (pasted phone numbers) before the exact-match lookup.
        $data['identifier'] = trim(Digits::toEnglish($data['identifier']));

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
            'username' => $user->username,
            'avatar' => $user->avatar,
            'roles' => $user->roles->pluck('name'),
            'permissions' => $user->permissionList(),
            'location' => $user->only('latitude', 'longitude', 'location_label'),
            'created_at' => $user->created_at?->toIso8601String(),
        ]);
    }

    /**
     * POST /api/auth/avatar  [auth:sanctum]
     *
     * Profile photo upload: one image per user, stored on the public disk.
     * Replacing an existing photo deletes the old file first so storage does
     * not accumulate orphaned images.
     */
    public function uploadAvatar(Request $request): JsonResponse
    {
        $request->validate([
            // mimes (not image:) so the extension is also checked — image:
            // alone would trust only the guessed mime type of the content.
            'avatar' => ['required', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
        ]);

        $user = $request->user();

        $path = $request->file('avatar')->store('avatars', 'public');

        if ($user->avatar && $user->avatar !== $path) {
            Storage::disk('public')->delete($user->avatar);
        }

        $user->update(['avatar' => $path]);

        // Cache-busting query param: avatars are displayed app-wide.
        return response()->json([
            'message' => 'تصویر پروفایل به‌روزرسانی شد.',
            'avatar_url' => Storage::disk('public')->url($path).'?v='.time(),
        ]);
    }

    /**
     * DELETE /api/auth/avatar  [auth:sanctum]
     */
    public function deleteAvatar(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->avatar) {
            Storage::disk('public')->delete($user->avatar);
            $user->update(['avatar' => null]);
        }

        return response()->json(['message' => 'تصویر پروفایل حذف شد.']);
    }
}
