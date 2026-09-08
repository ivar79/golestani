<?php
use App\Http\Controllers\Api\AdminBusinessController;
use App\Http\Controllers\Api\BusinessImageController;
use Illuminate\Support\Facades\Route;
Route::middleware(['auth:sanctum','role:business_owner,user,admin','throttle:30,1'])->group(function (): void {
    Route::get('/businesses/{business}/images', [BusinessImageController::class,'index']);
    Route::post('/businesses/{business}/images', [BusinessImageController::class,'store']);
    Route::delete('/businesses/{business}/images/{image}', [BusinessImageController::class,'destroy']);
});
Route::middleware(['auth:sanctum','role:admin','throttle:60,1'])->group(function (): void {
    Route::get('/admin/businesses', [AdminBusinessController::class,'index']);
    Route::get('/admin/businesses/{business}/audit', [AdminBusinessController::class,'audit']);
});
