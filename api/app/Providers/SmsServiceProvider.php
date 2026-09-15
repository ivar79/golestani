<?php

namespace App\Providers;

use App\Services\Sms\Contracts\SmsServiceInterface;
use App\Services\Sms\Drivers\HttpSmsDriver;
use App\Services\Sms\Drivers\LogSmsDriver;
use App\Services\Sms\Listeners\LastIssuedOtp;
use Illuminate\Support\ServiceProvider;

class SmsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // Dev tooling (php artisan otp:show) reads the plaintext OTP from here
        // at the moment of issue. Pure observer: never changes delivery.
        $this->app->singleton(LastIssuedOtp::class);

        $this->app->bind(SmsServiceInterface::class, function () {
            $driver = (string) config('sms.driver', 'log');
            $drivers = (array) config('sms.drivers', []);

            $class = $drivers[$driver] ?? LogSmsDriver::class;

            $real = $class === HttpSmsDriver::class
                ? new HttpSmsDriver((array) config('sms.http', []))
                : app($class);

            $listener = app(LastIssuedOtp::class);

            return new class($real, $listener) implements SmsServiceInterface
            {
                public function __construct(
                    private readonly SmsServiceInterface $real,
                    private readonly LastIssuedOtp $listener,
                ) {}

                public function send(string $phone, string $message): bool
                {
                    $this->listener->handle($phone, $message);

                    return $this->real->send($phone, $message);
                }
            };
        });
    }

    public function boot(): void
    {
        //
    }
}
