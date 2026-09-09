<?php

namespace App\Providers;

use App\Database\PostgresBooleanSafeConnection;
use Illuminate\Database\Connection;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Production incident fix (SQLSTATE[42804]): bind PHP booleans on the
        // pgsql driver as PDO::PARAM_BOOL instead of PDO::PARAM_INT. See
        // App\Database\PostgresBooleanSafeConnection for the full rationale.
        // Scoped to the 'pgsql' driver only — sqlite (the test suite) and the
        // other drivers keep stock Laravel behavior.
        Connection::resolverFor('pgsql', function ($pdo, $database = '', $tablePrefix = '', array $config = []) {
            return new PostgresBooleanSafeConnection($pdo, $database, $tablePrefix, $config);
        });

        // Defense in depth: a production deployment must never boot with raw
        // debug output enabled. This would leak SQL, stack traces and config
        // values to API clients. Corrupted/duplicated .env values have shipped
        // such accidents before; failing loudly here beats leaking data.
        if (! self::shouldSkipRuntimeGuard()
            && config('app.env') === 'production'
            && config('app.debug')) {
            throw new \RuntimeException(
                'APP_DEBUG=true is not allowed when APP_ENV=production. Set APP_DEBUG=false.'
            );
        }
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }

    /**
     * "php artisan optimize:clear" invokes provisionNativePhpConfigurationFile
     * (Laravel 12 native-PHP config export) inside a pristine container where
     * no config is loaded yet. Skip the guard there so the clear command can
     * always run; the runtime guard above still executes on every real boot.
     */
    public static function shouldSkipRuntimeGuard(): bool
    {
        return app()->runningInConsole()
            && in_array($_SERVER['argv'][1] ?? null, ['optimize:clear', 'config:clear', 'config'], true);
    }
}
