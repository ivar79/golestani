<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$req = Illuminate\Http\Request::create('/api/auth/send-otp', 'POST', [], [], [], [
    'CONTENT_TYPE' => 'application/json',
    'HTTP_ACCEPT' => 'application/json',
], json_encode(['phone' => '09330000001']));
echo "Content: " . $req->getContent() . "\n";
echo "isJson: " . ($req->isJson() ? 'yes' : 'no') . "\n";
echo "Input phone: " . var_export($req->input('phone'), true) . "\n";
echo "All input: " . json_encode($req->all()) . "\n";
$res = $kernel->handle($req);
echo "Status: " . $res->getStatusCode() . "\n";
echo "Body: " . $res->getContent() . "\n";
$kernel->terminate($req, $res);

</content>