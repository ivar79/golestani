<?php

use App\Http\Controllers\Api\Auth\AuthController;
use App\Http\Controllers\Api\BusinessController;
use App\Http\Controllers\Api\PublicBusinessController;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return response()->json(['status' => 'ok']);
});

// Demonstration of the CheckRole middleware (Phase 1 RBAC wiring).
Route::get('/admin/ping', function () {
    return response()->json(['ok' => true, 'message' => 'Ø³Ù„Ø§Ù… Ù…Ø¯ÛŒØ±']);
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

Route::get('/public/businesses/{slug}', [PublicBusinessController::class, 'show']);
Route::get('/public/businesses/{slug}/qr', [PublicBusinessController::class, 'qr']);
Route::middleware(['auth:sanctum', 'role:business_owner,admin'])->prefix('businesses')->group(function (): void {
    Route::get('/', [BusinessController::class, 'index']); Route::post('/', [BusinessController::class, 'store']);
    Route::get('/{business}', [BusinessController::class, 'show']); Route::put('/{business}', [BusinessController::class, 'update']); Route::delete('/{business}', [BusinessController::class, 'destroy']);
});
Route::middleware(['auth:sanctum', 'role:admin'])->patch('/admin/businesses/{business}/moderate', [BusinessController::class, 'moderate']);
