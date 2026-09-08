<?php
namespace App\Http\Middleware;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
class ApiSecurityLog
{
    public function handle(Request $request, Closure $next): Response
    {
        $request->attributes->set('security_request_id', (string) Str::uuid());
        $response = $next($request);
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        if ($request->bearerToken() || str_starts_with($request->path(), 'api/auth/')) {
            $response->headers->set('Cache-Control', 'no-store, private');
        }
        return $response;
    }
    // Called by the HTTP kernel after exception responses have been rendered.
    public function terminate(Request $request, Response $response): void
    {
        $auth = str_starts_with($request->path(), 'api/auth/');
        if ($response->getStatusCode() < 400 && (!$auth || $request->isMethod('GET'))) return;
        $actorId = $request->user()?->id;
        if ($auth && $response instanceof \Illuminate\Http\JsonResponse && $response->getStatusCode() < 400) {
            $actorId = $response->getData(true)['user']['id'] ?? $actorId;
        }
        Log::build([
            'driver' => 'daily', 'path' => storage_path('logs/security.log'),
            'level' => 'info', 'days' => 30, 'permission' => 0640,
            'formatter' => \Monolog\Formatter\JsonFormatter::class,
        ])->info($auth ? 'auth.request' : 'api.rejected', [
            'request_id' => $request->attributes->get('security_request_id'),
            'actor_id' => $actorId,
            'route' => $request->route()?->uri(), 'method' => $request->method(),
            'status' => $response->getStatusCode(),
            'ip_hash' => hash_hmac('sha256', (string) $request->ip(), (string) config('app.key')),
        ]);
    }
}
