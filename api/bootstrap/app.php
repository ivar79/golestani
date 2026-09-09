<?php

use App\Http\Middleware\ApiRequestSafety;
use App\Http\Middleware\ApiSecurityLog;
use App\Http\Middleware\CheckRole;
use App\Http\Middleware\RequireApiToken;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\QueryException;
use Illuminate\Database\RecordsNotFoundException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php', api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php', health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->api(prepend: [
            ApiSecurityLog::class,
            ApiRequestSafety::class,
            RequireApiToken::class,
        ]);
        $middleware->alias(['role' => CheckRole::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Production incident hardening: raw database errors (SQL, table and
        // column names, bindings) must never reach an API client. Laravel only
        // includes exception details when APP_DEBUG=true; with APP_DEBUG=false
        // clients already get a generic 500. These handlers add explicit,
        // stable Persian messages for auth-adjacent endpoints while the full
        // exception (SQL, bindings, trace) is still reported to laravel.log.
        $generic = fn (string $message) => response()->json(['message' => $message], 500);

        $exceptions->render(function (QueryException $e, $request) use ($generic) {
            if (! $request->is('api/*')) {
                return null; // fall through to Laravel's default handling
            }

            return $generic('خطای غیرمنتظره‌ای رخ داد. لطفاً بعداً دوباره تلاش کنید.');
        });

        $exceptions->render(function (Throwable $e, $request) use ($generic) {
            if (! $request->is('api/*') || config('app.debug')) {
                return null; // non-API or local/debug: default behavior
            }

            // Exceptions Laravel already maps to a meaningful HTTP status
            // (422 validation, 401 unauthenticated, 403 forbidden, 404 model
            // not found, 419 CSRF, 429 throttling, any HttpException) must
            // keep their intended message and status code.
            $handled = [
                HttpResponseException::class,
                ValidationException::class,
                AuthenticationException::class,
                AuthorizationException::class,
                ModelNotFoundException::class,
                RecordsNotFoundException::class,
                TokenMismatchException::class,
            ];

            if ($e instanceof HttpExceptionInterface
                || in_array($e::class, $handled, true)) {
                return null;
            }

            // Everything else (PHP Error, RuntimeException, unexpected
            // driver exceptions, ...) becomes a generic 500 for API clients;
            // the full details are still reported to laravel.log.
            return $generic('خطای غیرمنتظره‌ای رخ داد. لطفاً بعداً دوباره تلاش کنید.');
        });
    })
    ->create();
