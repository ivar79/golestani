<?php

namespace App\Support;

use DateTimeInterface;

/**
 * Gregorian → Jalali (شمسی) calendar, pure PHP.
 *
 * WHY IT EXISTS: the wallet flow talks to people about DATES ("واریز تا
 * تاریخ ..."), and there is no Jalali library in composer.json. Adding a
 * dependency for one format would be heavier than the 30 lines it needs, and
 * the algorithm below is the well-known jdf conversion (integer-only, no
 * timezone or locale state) — so the same string is produced on every server.
 *
 * The output is DIGITS-ONLY and locale-free on purpose:
 *   format()      → '1405/07/25'   (storage, CSV, tests — sortable/parsable)
 *   formatFa()    → '۱۴۰۵/۰۷/۲۵'   (what the user is shown, Persian digits)
 * Month names are never guessed here: both the admin UI and the designer page
 * render dates in the browser with Intl ('fa-IR'), which knows them.
 */
final class Jalali
{
    private const GREGORIAN_DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

    /**
     * @return array{0:int,1:int,2:int} [jalali year, month, day]
     */
    public static function fromGregorian(int $year, int $month, int $day): array
    {
        $gy2 = $month > 2 ? $year + 1 : $year;

        $days = 355666
            + (365 * $year)
            + intdiv($gy2 + 3, 4)
            - intdiv($gy2 + 99, 100)
            + intdiv($gy2 + 399, 400)
            + $day
            + self::GREGORIAN_DAYS_BEFORE_MONTH[$month - 1];

        $jy = -1595 + (33 * intdiv($days, 12053));
        $days %= 12053;

        $jy += 4 * intdiv($days, 1461);
        $days %= 1461;

        if ($days > 365) {
            $jy += intdiv($days - 1, 365);
            $days = ($days - 1) % 365;
        }

        if ($days < 186) {
            $jm = 1 + intdiv($days, 31);
            $jd = 1 + ($days % 31);
        } else {
            $jm = 7 + intdiv($days - 186, 30);
            $jd = 1 + (($days - 186) % 30);
        }

        return [$jy, $jm, $jd];
    }

    /** '1405/07/25' — ASCII digits, for storage/CSV/tests. Null-safe. */
    public static function format(?DateTimeInterface $moment): ?string
    {
        if ($moment === null) {
            return null;
        }

        [$year, $month, $day] = self::fromGregorian(
            (int) $moment->format('Y'),
            (int) $moment->format('n'),
            (int) $moment->format('j'),
        );

        return sprintf('%04d/%02d/%02d', $year, $month, $day);
    }

    /**
     * '1405-07-25' — the ASCII form with DASHES, safe inside a filename
     * (slashes are path separators and Symfony refuses them in a download name).
     */
    public static function compact(?DateTimeInterface $moment): ?string
    {
        $formatted = self::format($moment);

        return $formatted === null ? null : str_replace('/', '-', $formatted);
    }

    /** '۱۴۰۵/۰۷/۲۵' — the same date with Persian digits, for people. */
    public static function formatFa(?DateTimeInterface $moment): ?string
    {
        $formatted = self::format($moment);

        return $formatted === null ? null : self::toPersianDigits($formatted);
    }

    /** ASCII digits and punctuation → Persian digits (separators untouched). */
    public static function toPersianDigits(string $value): string
    {
        return strtr($value, [
            '0' => '۰', '1' => '۱', '2' => '۲', '3' => '۳', '4' => '۴',
            '5' => '۵', '6' => '۶', '7' => '۷', '8' => '۸', '9' => '۹',
        ]);
    }
}
