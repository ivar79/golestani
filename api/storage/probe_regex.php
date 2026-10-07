<?php
$phone = '09330000001';
$pattern = '/^09\d{9}$/';
echo "Phone: $phone\n";
echo "Pattern: $pattern\n";
echo "Match: " . (preg_match($pattern, $phone) ? 'YES' : 'NO') . "\n";
echo "Length: " . strlen($phone) . "\n";
echo "Digits only: " . (ctype_digit($phone) ? 'yes' : 'no') . "\n";
