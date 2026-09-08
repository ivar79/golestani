<?php
namespace App\Http\Middleware;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
class ApiRequestSafety
{
    public function handle(Request $request, Closure $next): Response
    {
        $request->headers->set("Accept", "application/json");
        if (!in_array($request->method(), ['GET', 'HEAD', 'OPTIONS'], true)) {
            $origin = $request->header('Origin');
            if ($origin !== null && !in_array($origin, config('cors.allowed_origins', []), true)) {
                abort(403, 'مبدأ درخواست مجاز نیست.');
            }
            // Prevent simple cross-site forms, including login CSRF. CLI clients
            // may omit Origin, but must still use JSON or the upload header.
            $multipart = str_starts_with(strtolower($request->header('Content-Type', '')), 'multipart/form-data');
            if (!$request->isJson() && !($multipart && $request->header('X-Requested-With') === 'XMLHttpRequest')) {
                abort(415, 'درخواست باید JSON یا آپلود معتبر باشد.');
            }
        }
        return $next($request);
    }
}
