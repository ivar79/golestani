<?php

use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AdminTaxonomyController;
use App\Http\Controllers\Api\AdvertisementController;
use App\Http\Controllers\Api\Auth\AuthController;
use App\Http\Controllers\Api\BusinessCardController;
use App\Http\Controllers\Api\CardTemplateController;
use App\Http\Controllers\Api\Designer\DesignerTemplateController;
use App\Http\Controllers\Api\MyTemplateController;
use App\Http\Controllers\Api\PrivateAssetController;
use App\Http\Controllers\Api\BusinessController;
use App\Http\Controllers\Api\BusinessEntitlementController;
use App\Http\Controllers\Api\BusinessReportController;
use App\Http\Controllers\Api\Designer\DesignerController;
use App\Http\Controllers\Api\PaymentController;
use App\Http\Controllers\Api\PublicBusinessController;
use App\Http\Controllers\Api\ShowcaseController;
use App\Http\Controllers\Api\SubscriptionController;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return response()->json(['status' => 'ok']);
});

// NOTE: map basemap tiles are no longer served by Laravel. The frontend uses
// the Neshan Maps Platform SDK (hosted tiles + API key) with a public OSM
// raster fallback — no local PMTiles/MBTiles archives anywhere.

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

    // Emergency Admin Recovery: backup login when SMS is unavailable.
    Route::post('/verify-recovery', [AuthController::class, 'verifyRecovery'])
        ->middleware('throttle:5,15');

    Route::post('/admin/login', [AuthController::class, 'loginAdmin'])->middleware('throttle:5,1');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::get('/me', [AuthController::class, 'me']);
        // M1 (Phase 3): persist the chosen map location until changed.
        Route::put('/location', [AuthController::class, 'updateLocation']);
        // Unique public handle chosen after OTP login (Phase 2 UX, 2026-09-18).
        Route::post('/username', [AuthController::class, 'setUsername'])->middleware('throttle:10,1');
        Route::get('/username/check', [AuthController::class, 'checkUsername'])->middleware('throttle:60,1');
        // Profile photo (2026-09-19): upload replaces, DELETE clears.
        Route::post('/avatar', [AuthController::class, 'uploadAvatar'])->middleware('throttle:10,1');
        Route::delete('/avatar', [AuthController::class, 'deleteAvatar']);
    });
});

Route::middleware(['auth:sanctum', 'role:business_owner,user,designer,admin'])->group(function (): void {
    Route::get('/businesses/{business}/card', [BusinessCardController::class, 'show']);
    // Card writes share ONE per-user throttle bucket (card-write) so hopping
    // between the save and template-apply endpoints cannot reset the quota.
    Route::put('/businesses/{business}/card', [BusinessCardController::class, 'save'])->middleware('throttle:card-write');
    // THE canonical studio apply: the client names a source + template and
    // NEVER sends a document (resolve → entitlement → clone + ids + fills →
    // validate → persist, in one transaction).
    Route::post('/businesses/{business}/card/template-apply', [BusinessCardController::class, 'applyTemplate'])->middleware('throttle:card-write');
    // Phase 4: authorized print-file download (owner/admin only, 403 else).
    Route::get('/businesses/{business}/card/print-file', [BusinessCardController::class, 'download']);
    // STANDARD Dashboard entitlement contract (owner/admin only):
    // FeatureGate::payload + subscription time lifecycle in one read-only
    // payload — the single source the frontend mirrors for UX.
    Route::get('/businesses/{business}/entitlements', [BusinessEntitlementController::class, 'show']);
});
// Designer profile + portfolios are for the DESIGNER IDENTITY only: the
// role is granted exclusively by the admin approval workflow
// (PATCH /admin/users/{user}/designer-status) — never self-assigned (the
// removed bootstrap let any OTP user obtain the role with one GET).
Route::middleware(['auth:sanctum', 'role:designer,admin'])->prefix('designer')->group(function (): void {
    Route::get('/profile', [DesignerController::class, 'profile']);
    Route::put('/profile', [DesignerController::class, 'update']);
    Route::get('/portfolios', [DesignerController::class, 'portfolios']);
    Route::post('/portfolios', [DesignerController::class, 'storePortfolio']);
    Route::delete('/portfolios/{portfolio}', [DesignerController::class, 'destroyPortfolio']);
});
Route::middleware(['auth:sanctum', 'role:admin'])->patch('/admin/portfolios/{portfolio}/moderate', [DesignerController::class, 'moderate']);
Route::middleware(['auth:sanctum', 'role:admin'])->group(function (): void {
    Route::get('/admin/designers', [DesignerController::class, 'adminIndex']);
    Route::patch('/admin/designers/{designer}/moderate', [DesignerController::class, 'adminModerate']);
});

Route::get('/plans', [SubscriptionController::class, 'plans']);
Route::get('/public/taxonomies', [AdminTaxonomyController::class, 'public']);
Route::get('/public/homepage', [AdminController::class, 'publicHomepage']);
Route::get('/public/businesses/{business:slug}/showcases', [ShowcaseController::class, 'public']);
Route::get('/public/advertisements/{slot}', [AdvertisementController::class, 'public']);
// Online payments (ZarinPal). init is owner-scoped; callback is PUBLIC
// because ZarinPal redirects the user's browser to it — its security rests on
// authority uniqueness + server-side verification, never on the session.
Route::middleware(['auth:sanctum', 'role:business_owner,user,designer,admin'])->group(function (): void {
    Route::post('/businesses/{business}/payments/init', [PaymentController::class, 'init'])->middleware('throttle:10,1');
    Route::get('/payments/status', [PaymentController::class, 'status']);
});
Route::get('/payments/callback', [PaymentController::class, 'callback'])->middleware('throttle:60,1');

Route::middleware(['auth:sanctum', 'role:business_owner,user,designer,admin'])->group(function (): void {
    Route::get('/businesses/{business}/subscriptions', [SubscriptionController::class, 'index']);
    Route::post('/businesses/{business}/subscriptions', [SubscriptionController::class, 'store'])->middleware('throttle:10,1');
    Route::get('/businesses/{business}/showcases', [ShowcaseController::class, 'index']);
    Route::post('/businesses/{business}/showcases', [ShowcaseController::class, 'store']);
    Route::put('/showcases/{showcase}', [ShowcaseController::class, 'update']);
    Route::delete('/showcases/{showcase}', [ShowcaseController::class, 'destroy']);
    Route::get('/businesses/{business}/advertisements', [AdvertisementController::class, 'index']);
    Route::post('/businesses/{business}/advertisements', [AdvertisementController::class, 'store']);
    Route::delete('/advertisements/{advertisement}', [AdvertisementController::class, 'destroy']);
});
Route::middleware(['auth:sanctum', 'role:admin'])->patch('/admin/subscriptions/{subscription}/moderate', [SubscriptionController::class, 'moderate']);
Route::middleware(['auth:sanctum', 'role:admin'])->get('/admin/subscriptions', [SubscriptionController::class, 'adminIndex']);
Route::middleware('auth:sanctum')->group(function (): void {
    Route::get('/notifications', [SubscriptionController::class, 'notifications']);
    Route::patch('/notifications/{notification}/read', [SubscriptionController::class, 'readNotification']);
    Route::get('/subscriptions/{subscription}/receipt', [SubscriptionController::class, 'receipt']);
});
Route::middleware(['auth:sanctum', 'role:admin'])->get('/admin/reports/revenue', [SubscriptionController::class, 'reports']);

// ---- Data-driven Template System (Phase 5) -----------------------------
// Public gallery read (entitlement flags attach when business_id is passed).
Route::get('/card-templates', [CardTemplateController::class, 'index']);
// THE apply contract — server-side authorize + clone + new ids + fills.
Route::middleware('auth:sanctum')->group(function (): void {
    Route::post('/card-templates/builtin/{templateId}/apply', [CardTemplateController::class, 'applyBuiltin']);
    Route::post('/card-templates/{templateId}/apply', [CardTemplateController::class, 'applyDb']);
    // PRIVATE personal templates (custom_templates entitlement). Authoring
    // writes use their OWN throttle bucket (studio-authoring) — heavier and
    // less frequent than the card editor, so they must not consume card-write.
    Route::get('/my/templates', [MyTemplateController::class, 'index']);
    Route::post('/my/templates', [MyTemplateController::class, 'store'])->middleware('throttle:studio-authoring');
    Route::put('/my/templates/{template}', [MyTemplateController::class, 'update'])->middleware('throttle:studio-authoring');
    Route::delete('/my/templates/{template}', [MyTemplateController::class, 'destroy']);
    Route::post('/my/templates/{template}/apply', [MyTemplateController::class, 'apply']);
    Route::post('/my/templates-asset', [MyTemplateController::class, 'uploadAsset'])->middleware('throttle:studio-authoring');
    // Ownership-checked private asset door (personal template artwork).
    Route::get('/assets/private/{path}', [PrivateAssetController::class, 'show'])->where('path', '.*');
});

// ---- Designer program + gallery submissions ----------------------------
Route::middleware('auth:sanctum')->prefix('designer')->group(function (): void {
    Route::get('/program/status', [DesignerTemplateController::class, 'programStatus']);
    Route::post('/program/request', [DesignerTemplateController::class, 'requestProgram']);
    Route::get('/templates', [DesignerTemplateController::class, 'index']);
    Route::post('/templates', [DesignerTemplateController::class, 'store'])->middleware('throttle:studio-authoring');
});
// Admin moderation + CRUD for DB templates.
Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin/templates')->group(function (): void {
    Route::get('/', [DesignerTemplateController::class, 'adminIndex']);
    Route::post('/', [DesignerTemplateController::class, 'adminStore']);
    Route::get('/{template}/plans', [DesignerTemplateController::class, 'adminPlans']);
    Route::put('/{template}', [DesignerTemplateController::class, 'adminUpdate']);
    Route::delete('/{template}', [DesignerTemplateController::class, 'adminDestroy']);
    Route::patch('/{template}/moderate', [DesignerTemplateController::class, 'moderate']);
});
Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin')->group(function (): void {
    Route::get('/taxonomies', [AdminTaxonomyController::class, 'index']);
    Route::post('/taxonomies', [AdminTaxonomyController::class, 'store']);
    Route::put('/taxonomies/{taxonomy}', [AdminTaxonomyController::class, 'update']);
    Route::delete('/taxonomies/{taxonomy}', [AdminTaxonomyController::class, 'destroy']);
    Route::get('/plans', [SubscriptionController::class, 'adminPlans']);
    // Entitlement catalog: drives the admin plan editor — no feature name is
    // hardcoded in the admin frontend.
    Route::get('/entitlements/catalog', [SubscriptionController::class, 'catalog']);
    Route::post('/plans', [SubscriptionController::class, 'storePlan']);
    Route::put('/plans/{plan}', [SubscriptionController::class, 'updatePlan']);
    Route::delete('/plans/{plan}', [SubscriptionController::class, 'destroyPlan']);
});
// Public browse endpoints: both share the ONE per-IP `public-search` bucket
// (AppServiceProvider) so endpoint hopping cannot reset the quota, and the
// map-pin set is capped server-side (config/search.php).
Route::get('/search/businesses', [BusinessController::class, 'search'])->middleware('throttle:public-search');
// M1 (Phase 3): distinct filter values for the search UI (cached 5 min).
Route::get('/search/facets', [BusinessController::class, 'facets'])->middleware('throttle:public-search');
Route::get('/public/businesses/featured', [PublicBusinessController::class, 'featured'])->middleware('throttle:public-search');
Route::get('/public/businesses/{slug}', [PublicBusinessController::class, 'show']);
Route::get('/public/businesses/{slug}/card', [PublicBusinessController::class, 'card']);
Route::get('/public/businesses/{slug}/qr', [PublicBusinessController::class, 'qr']);
// Report submission: authenticated, validated AND rate limited — a single
// account must not be able to flood the moderation queue
// (audit finding `reports-endpoint-unbounded-writes`). The quota is per user,
// not per business; the controller additionally refuses an identical report
// that is still active (409 carrying the existing report id — never a silent
// discard).
Route::middleware(['auth:sanctum', 'throttle:5,60'])->post('/public/businesses/{business}/reports', [BusinessReportController::class, 'store']);
// Users and approved designers may create/manage their own business space;
// the business_owner role is assigned server-side on first creation. Every
// resource remains ownership-scoped through authorizeOwner()/own-relation queries.
Route::middleware(['auth:sanctum', 'role:business_owner,user,designer,admin', 'throttle:30,1'])->prefix('businesses')->group(function (): void {
    Route::get('/', [BusinessController::class, 'index']);
    Route::post('/', [BusinessController::class, 'store']);
    Route::get('/{business}', [BusinessController::class, 'show']);
    Route::put('/{business}', [BusinessController::class, 'update']);
    Route::delete('/{business}', [BusinessController::class, 'destroy']);
    Route::post('/{business}/upload', [BusinessController::class, 'upload']);
});
Route::middleware(['auth:sanctum', 'role:admin', 'throttle:60,1'])->patch('/admin/businesses/{business}/moderate', [BusinessController::class, 'moderate']);
Route::middleware(['auth:sanctum', 'role:admin'])->prefix('admin')->group(function (): void {
    Route::get('/overview', [AdminController::class, 'overview']);
    Route::get('/health', [AdminController::class, 'health']);
    Route::get('/audit', [AdminController::class, 'auditLog']);
    Route::get('/users', [AdminController::class, 'users']);
    Route::patch('/users/{user}', [AdminController::class, 'updateUser']);
    // Designer-approval workflow: the CANONICAL writer of
    // users.designer_status (also syncs the designer role + legacy designers
    // row + audit trail).
    Route::patch('/users/{user}/designer-status', [AdminController::class, 'updateDesignerStatus']);
    // Studio rollout board: gate switch state + per-user/business access.
    Route::get('/studio/report', [AdminController::class, 'studioReport']);
    Route::patch('/showcases/{showcase}/moderate', [AdminController::class, 'moderateShowcase']);
    Route::patch('/advertisements/{advertisement}/moderate', [AdminController::class, 'moderateAdvertisement']);
    Route::get('/settings', [AdminController::class, 'settings']);
    Route::put('/settings/{key}', [AdminController::class, 'saveSetting']);
    Route::get('/pages', [AdminController::class, 'pages']);
    Route::put('/pages/{slug}', [AdminController::class, 'savePage']);
    Route::get('/articles', [AdminController::class, 'articles']);
    Route::post('/articles', [AdminController::class, 'saveArticle']);
    Route::post('/articles/{article}', [AdminController::class, 'saveArticle']);
    Route::delete('/articles/{article}', [AdminController::class, 'deleteArticle']);
    Route::post('/media', [AdminController::class, 'media']);
    Route::get('/media', [AdminController::class, 'mediaList']);
    Route::get('/reports', [BusinessReportController::class, 'index']);
    Route::patch('/reports/{report}/moderate', [BusinessReportController::class, 'moderate']);
});

require __DIR__.'/phase2.php';
