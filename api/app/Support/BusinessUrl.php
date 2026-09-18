<?php
namespace App\Support;
use App\Models\Business;
use Illuminate\Http\Request;
class BusinessUrl
{
    public static function public(Business $business, ?Request $request = null): string
    {
        $base = rtrim((string) config('business.frontend_url'), '/');
        if ($base === '') {
            // 2) No explicit config: trust the browser Origin ONLY when it is
            //    allow-listed by CORS. The QR then reads whatever site it is
            //    viewed from (Vercel now, Liara later) with zero per-domain
            //    hardcoding, while an unknown origin can never mint QR codes
            //    pointing at its own phishing domain.
            $origin = ($request ?? request())->header('Origin');
            // <img> tags and plain link navigations send no Origin header, but
            // they do send Referer (origin-only under the browser default
            // strict-origin-when-cross-origin policy). Deriving the origin from
            // it lets the dashboard QR and the /b/{slug} page QR resolve the
            // embedding site with zero frontend changes; the same allowlist
            // check below still blocks foreign (phishing) pages.
            if (!$origin) {
                $referer = ($request ?? request())->header('Referer');
                if ($referer) {
                    $rp = parse_url($referer);
                    if (!empty($rp['scheme']) && !empty($rp['host'])) {
                        $origin = $rp['scheme'].'://'.$rp['host'].(isset($rp['port']) ? ':'.$rp['port'] : '');
                    }
                }
            }
            $allowed = (array) config('cors.allowed_origins', []);
            if ($origin && in_array(rtrim($origin, '/'), $allowed, true)) {
                $base = rtrim($origin, '/');
            }
        }
        // 3) Nothing resolvable (CLI, cron, print tooling without Origin):
        //    fall back to the local dev origin so tools keep working instead
        //    of 500-ing; production always sets FRONTEND_URL explicitly.
        if ($base === '' && app()->environment() !== 'production') {
            $base = rtrim((string) env('APP_URL', 'http://localhost:3000'), '/');
            if (!preg_match('#^https?://[^/]+$#', $base) || parse_url($base, PHP_URL_HOST) === null) {
                $base = 'http://localhost:3000';
            }
        }
        $parts = parse_url($base);
        if (!$parts || !in_array($parts['scheme'] ?? '', ['http','https'], true) || empty($parts['host']) || isset($parts['query']) || isset($parts['fragment']) || isset($parts['user'])) {
            throw new \RuntimeException('FRONTEND_URL must be an absolute HTTP(S) site URL.');
        }
        return $base.'/b/'.rawurlencode($business->slug);
    }
}
