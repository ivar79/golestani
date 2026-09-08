<?php
namespace App\Http\Middleware;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
class CheckRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        $user = $request->user();
        if (!$user) return response()->json(['message' => 'احراز هویت لازم است.'], 401);
        if (!$user->is_active) return response()->json(['message' => 'حساب کاربری غیرفعال است.'], 403);
        foreach ($roles as $role) if ($user->hasRole($role)) return $next($request);
        return response()->json(['message' => 'دسترسی غیرمجاز است.'], 403);
    }
}
