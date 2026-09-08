<?php
namespace App\Http\Middleware;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
class RequireApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        // Sanctum supports sessions too; production API must not accept them.
        // Set the configuration per API request, leaving normal web CSRF intact.
        config(['sanctum.guard' => []]);
        return $next($request);
    }
}
