<?php

/**
 * PHPUnit bootstrap for the test suite.
 *
 * WHY THIS EXISTS: docker-compose exports the LIVE database credentials
 * (DB_CONNECTION=pgsql, DB_DATABASE=golestani, ...) into the api container's
 * process environment. Those variables are visible in $_SERVER as well, and
 * Laravel's env() repository reads $_SERVER with higher priority than the
 * values phpunit.xml injects via putenv() — even with force="true". A test
 * run inside the container therefore resolved the live pgsql connection and
 * RefreshDatabase WIPED THE LIVE DATABASE (2026-09-15 incident).
 *
 * This bootstrap force-writes the phpunit.xml testing variables into ALL
 * three PHP env layers ($_SERVER, $_ENV, putenv) BEFORE the framework boots,
 * so env() inside tests can never resolve the live database configuration.
 * Keep this list in sync with the <env> entries in phpunit.xml.
 */

$testingEnv = [
    'APP_ENV' => 'testing',
    'APP_MAINTENANCE_DRIVER' => 'file',
    'BCRYPT_ROUNDS' => '4',
    'BROADCAST_CONNECTION' => 'null',
    'CACHE_STORE' => 'array',
    // The critical pair: tests must always run on in-memory sqlite.
    'DB_CONNECTION' => 'sqlite',
    'DB_DATABASE' => ':memory:',
    'DB_URL' => '',
    'MAIL_MAILER' => 'array',
    'QUEUE_CONNECTION' => 'sync',
    'SESSION_DRIVER' => 'array',
    'PULSE_ENABLED' => 'false',
    'TELESCOPE_ENABLED' => 'false',
    'NIGHTWATCH_ENABLED' => 'false',
    // Payment callback: the SPA redirect path is what production does, but the
    // suite asserts the JSON answer. The container exports a real FRONTEND_URL,
    // so without this the callback 302s and ~46 payment/subscription tests fail
    // on a status-code mismatch that has nothing to do with the code under test.
    'FRONTEND_URL' => '',
];

foreach ($testingEnv as $key => $value) {
    $_SERVER[$key] = $value;
    $_ENV[$key] = $value;
    putenv("$key=$value");
}

require __DIR__.'/../vendor/autoload.php';
