<?php

namespace App\Support;

/**
 * Iranian bank account number (شبا / IBAN) — single source of truth for
 * normalize + validate + mask.
 *
 * STRUCTURE: `IR` + 24 digits = 26 characters. The 24 digits are the 2
 * ISO-13616 check digits followed by the 22-digit account part. Validity is
 * NOT a length check: the ISO 7064 MOD-97-10 check digits must satisfy
 * mod 97 == 1 after rearranging the IBAN (BBAN + country code + check digits)
 * and expanding the letters (I=18, R=27).
 *
 * WHY IT LIVES HERE (mirrors App\Support\Digits): the wallet endpoints accept
 * a sheba from the designer, and a payout to a mistyped account is money that
 * cannot be recalled. Validation therefore happens ONCE, server-side, with a
 * documented algorithm — and the frontend mirrors exactly this logic in
 * web/src/lib/wallet.ts so the user sees the error before submitting.
 * Persian/Arabic digits are accepted on input and normalized with Digits.
 */
final class Sheba
{
    public const LENGTH = 26;

    /**
     * Normalize user input to the canonical storage form: uppercase
     * `IR` + 24 ASCII digits, no spaces/dashes. Returns null when the input
     * cannot even be shaped like a sheba (callers then report "نامعتبر").
     */
    public static function normalize(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $english = Digits::toEnglish($value) ?? '';
        $clean = preg_replace('/[\s\-_.]/', '', $english) ?? '';

        if ($clean === '') {
            return null;
        }

        return strtoupper($clean);
    }

    /** Shape + MOD-97 check. Never throws; safe to call on raw input. */
    public static function isValid(?string $value): bool
    {
        $sheba = self::normalize($value);

        if ($sheba === null || strlen($sheba) !== self::LENGTH) {
            return false;
        }

        if (! preg_match('/^IR[0-9]{24}$/', $sheba)) {
            return false;
        }

        // ISO 13616: move the first 4 chars to the end, expand the letters,
        // then fold the (long) number digit by digit so no bcmath is needed.
        $rearranged = substr($sheba, 4).substr($sheba, 0, 4);
        $remainder = 0;

        foreach (str_split($rearranged) as $char) {
            $numeric = match ($char) {
                'I' => '18',
                'R' => '27',
                default => $char,
            };
            foreach (str_split($numeric) as $digit) {
                $remainder = ($remainder * 10 + (int) $digit) % 97;
            }
        }

        return $remainder === 1;
    }

    /**
     * Masked display for anyone who is NOT the owner or an admin: keeps the
     * country code and the last 4 digits only, so a payout list cannot be
     * harvested for other people's account numbers.
     */
    public static function mask(?string $value): ?string
    {
        $sheba = self::normalize($value);

        if ($sheba === null || strlen($sheba) < 8) {
            return $sheba;
        }

        return substr($sheba, 0, 4).str_repeat('*', strlen($sheba) - 8).substr($sheba, -4);
    }
}
