<?php
namespace App\Services;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
class BusinessMedia
{
    public static function rules(int $kilobytes = 5120): array
    {
        return ['file','image','mimes:jpg,jpeg,png,webp','mimetypes:image/jpeg,image/png,image/webp','max:'.$kilobytes,'dimensions:max_width=6000,max_height=6000'];
    }
    public static function store(UploadedFile $file, string $folder): string
    {
        $path = $file->store('businesses/'.$folder, 'public');
        if (!$path) throw new \RuntimeException('Business media storage failed.');
        return '/storage/'.$path;
    }
    public static function cleanup(?string $url): void
    {
        if (!$url || !str_starts_with($url, '/storage/businesses/') || str_contains($url, '..')) return;
        try {
            if (!Storage::disk('public')->delete(substr($url, 9))) Log::warning('business.media_cleanup_failed');
        } catch (\Throwable $e) {
            // Cleanup must not turn an already committed mutation into a reported failure.
            Log::warning('business.media_cleanup_failed', ['exception' => get_class($e)]);
        }
    }
}
