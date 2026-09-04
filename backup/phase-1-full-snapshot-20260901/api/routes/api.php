<?php

use App\Http\Controllers\Api\Auth\AuthController;
use App\Http\Controllers\Api\BusinessController;
use App\Http\Controllers\Api\BusinessCardController;
use App\Http\Controllers\Api\Designer\DesignerController;
use App\Http\Controllers\Api\PublicBusinessController;
use App\Http\Controllers\Api\AdvertisementController;
use App\Http\Controllers\Api\ShowcaseController;
use App\Http\Controllers\Api\SubscriptionController;
use App\Http\Controllers\Api\AdminController;
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


Route::middleware(['auth:sanctum', 'role:business_owner,admin'])->group(function (): void {
    Route::get('/businesses/{business}/card', [BusinessCardController::class, 'show']);
    Route::put('/businesses/{business}/card', [BusinessCardController::class, 'save']);
});
Route::middleware(['auth:sanctum', 'role:designer,admin'])->prefix('designer')->group(function (): void {
    Route::get('/profile', [DesignerController::class, 'profile']);
    Route::put('/profile', [DesignerController::class, 'update']);
    Route::get('/portfolios', [DesignerController::class, 'portfolios']);
    Route::post('/portfolios', [DesignerController::class, 'storePortfolio']);
    Route::delete('/portfolios/{portfolio}', [DesignerController::class, 'destroyPortfolio']);
});
Route::middleware(['auth:sanctum', 'role:admin'])->patch('/admin/portfolios/{portfolio}/moderate', [DesignerController::class, 'moderate']);

Route::get('/plans', [SubscriptionController::class, 'plans']);
Route::get('/public/homepage', [AdminController::class, 'publicHomepage']);
Route::get('/public/businesses/{business}/showcases', [ShowcaseController::class, 'public']);
Route::get('/public/advertisements/{slot}', [AdvertisementController::class, 'public']);
Route::middleware(['auth:sanctum', 'role:business_owner,admin'])->group(function (): void {
    Route::get('/businesses/{business}/subscriptions', [SubscriptionController::class, 'index']);
    Route::post('/businesses/{business}/subscriptions', [SubscriptionController::class, 'store']);
    Route::get('/businesses/{business}/showcases', [ShowcaseController::class, 'index']);
    Route::post('/businesses/{business}/showcases', [ShowcaseController::class, 'store']);
    Route::put('/showcases/{showcase}', [ShowcaseController::class, 'update']);
    Route::delete('/showcases/{showcase}', [ShowcaseController::class, 'destroy']);
    Route::get('/businesses/{business}/advertisements', [AdvertisementController::class, 'index']);
    Route::post('/businesses/{business}/advertisements', [AdvertisementController::class, 'store']);
});
Route::middleware(['auth:sanctum', 'role:admin'])->patch('/admin/subscriptions/{subscription}/moderate', [SubscriptionController::class, 'moderate']);
Route::get('/search/businesses', [BusinessController::class, 'search']);
Route::get('/public/businesses/{slug}', [PublicBusinessController::class, 'show']);
Route::get('/public/businesses/{slug}/qr', [PublicBusinessController::class, 'qr']);
Route::middleware(['auth:sanctum', 'role:business_owner,admin'])->prefix('businesses')->group(function (): void {
    Route::get('/', [BusinessController::class, 'index']); Route::post('/', [BusinessController::class, 'store']);
    Route::get('/{business}', [BusinessController::class, 'show']); Route::put('/{business}', [BusinessController::class, 'update']); Route::delete('/{business}', [BusinessController::class, 'destroy']);
});
Route::middleware(['auth:sanctum', 'role:admin'])->patch('/admin/businesses/{business}/moderate', [BusinessController::class, 'moderate']);
Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin')->group(function (): void {
    Route::get('/overview', [AdminController::class, 'overview']);
    Route::get('/users', [AdminController::class, 'users']);
    Route::patch('/users/{user}', [AdminController::class, 'updateUser']);
    Route::patch('/showcases/{showcase}/moderate', [AdminController::class, 'moderateShowcase']);
    Route::patch('/advertisements/{advertisement}/moderate', [AdminController::class, 'moderateAdvertisement']);
    Route::get('/settings', [AdminController::class, 'settings']); Route::put('/settings/{key}', [AdminController::class, 'saveSetting']);
    Route::get('/pages', [AdminController::class, 'pages']); Route::put('/pages/{slug}', [AdminController::class, 'savePage']);
    Route::get('/articles', [AdminController::class, 'articles']); Route::post('/articles', [AdminController::class, 'saveArticle']); Route::post('/articles/{article}', [AdminController::class, 'saveArticle']); Route::delete('/articles/{article}', [AdminController::class, 'deleteArticle']);
    Route::post('/media', [AdminController::class, 'media']);
});
