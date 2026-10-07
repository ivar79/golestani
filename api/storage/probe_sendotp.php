<?php
require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
$req = Illuminate\Http\Request::create('/api/auth/send-otp', 'POST', [], [], [], [
    'CONTENT_TYPE' => 'application/json',
    'HTTP_ACCEPT' => 'application/json',
], json_encode(['phone' => '09330000001']));
$formReq = new App\Http\Requests\Auth\SendOtpRequest();
$formReq->setContainer($app);
$formReq->initialize(
    $req->query->all(),
    $req->request->all(),
    $req->attributes->all(),
    $req->cookies->all(),
    $req->files->all(),
    $req->server->all(),
    $req->getContent()
);
$formReq->prepareForValidation();
echo "Phone after prepare: " . $formReq->input('phone') . "\n";
$rules = $formReq->rules();
echo "Rules: " . json_encode($rules) . "\n";
$validator = Illuminate\Support\Facades\Validator::make($formReq->all(), $rules, $formReq->messages());
if ($validator->fails()) {
    echo "FAILS: " . json_encode($validator->errors()->toArray()) . "\n";
} else {
    echo "PASSES\n";
}
echo "Regex test: " . (preg_match('/^09\d{9}$/', '09330000001') ? 'match' : 'no match') . "\n";

</content>