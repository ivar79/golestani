<?php

use App\Http\Controllers\Api\Auth\AuthController;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return response()->json(['status' => 'ok']);
});

// Demonstration of the CheckRole middleware (Phase 1 RBAC wiring).
Route::get('/admin/ping', function () {
    return response()->json(['ok' => true, 'message' => 'سلام مدیر']);
})->middleware(['auth:sanctum', 'role:admin']);

Route::prefix('auth')->group(function (): void {
    // OTP request: max 3 per 10 minutes (route throttle + service-side counter).
    Route::post('/send-otp', [AuthController::class, 'sendOtp'])
        ->middleware('throttle:3,10');

    // OTP verification: max 5 attempts per 15 minutes.
    Route::post('/verify-otp', [AuthController::class, 'verifyOtp'])
        ->middleware('throttle:5,15');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/me', [AuthController::class, 'me']);
    });
});
