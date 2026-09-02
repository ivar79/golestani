<?php

namespace App\Providers;

use App\Services\Sms\Contracts\SmsServiceInterface;
use App\Services\Sms\Drivers\HttpSmsDriver;
use App\Services\Sms\Drivers\LogSmsDriver;
use Illuminate\Support\ServiceProvider;

class SmsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(SmsServiceInterface::class, function () {
            $driver = (string) config('sms.driver', 'log');
            $drivers = (array) config('sms.drivers', []);

            $class = $drivers[$driver] ?? LogSmsDriver::class;

            return $class === HttpSmsDriver::class
                ? new HttpSmsDriver((array) config('sms.http', []))
                : app($class);
        });
    }

    public function boot(): void
    {
        //
    }
}
