<?php
namespace App\Support;
use App\Models\Business;
class BusinessUrl
{
    public static function public(Business $business): string
    {
        $base = rtrim((string) config('business.frontend_url'), '/');
        $parts = parse_url($base);
        if (!$parts || !in_array($parts['scheme'] ?? '', ['http','https'], true) || empty($parts['host']) || isset($parts['query']) || isset($parts['fragment']) || isset($parts['user'])) {
            throw new \RuntimeException('FRONTEND_URL must be an absolute HTTP(S) site URL.');
        }
        return $base.'/b/'.rawurlencode($business->slug);
    }
}
