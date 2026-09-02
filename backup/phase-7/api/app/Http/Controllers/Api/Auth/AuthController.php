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
        $token = $user->createToken('auth-token')->plainTextToken;

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
            'created_at' => $user->created_at?->toIso8601String(),
        ]);
    }
}
