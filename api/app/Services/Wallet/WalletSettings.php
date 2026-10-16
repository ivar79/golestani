<?php

namespace App\Services\Wallet;

use App\Models\SiteSetting;
use App\Models\User;
use App\Services\AuditTrail;
use App\Support\Digits;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;

/**
 * The wallet/settlement knobs an ADMIN owns — the single source of truth for
 * every tunable value of the payout system.
 *
 * WHY THIS CLASS EXISTS: `config/wallet.php` used to be the only place these
 * values lived, so changing the minimum withdrawal amount, the payout wait
 * window or the settlement wording required a code change and a deploy. Now
 * config is only the INITIAL DEFAULT: the effective value is read from the
 * project's existing key/value settings table (`site_settings`, see
 * 2026_09_01_000009_create_cms_tables and App\Models\SiteSetting), and the
 * admin panel edits exactly that table.
 *
 * FALLBACK CONTRACT (never a hard dependency on a seeded row):
 *   1. a row in `site_settings` wins;
 *   2. otherwise the config value is used;
 *   3. a missing/unreadable table degrades to the config value too, so the
 *      wallet keeps working on a database where the CMS migration has not run.
 *
 * MONEY: `min_withdrawal_rial` is RIAL, exactly like the ledger and like
 * config/wallet.php — the admin UI is the only place that ×10/÷10 (toman).
 *
 * AUDIT: every real change writes one `audit_events` row per key
 * (`admin.wallet_setting_updated`) carrying OLD → NEW, so "who raised the
 * minimum payout and when" is answerable from the trail, not from memory.
 */
final class WalletSettings
{
    public const KEY_SETTLEMENT_NOTE = 'wallet.settlement_note';

    public const KEY_SETTLEMENT_DAYS = 'wallet.settlement_days';

    public const KEY_MIN_WITHDRAWAL_RIAL = 'wallet.min_withdrawal_rial';

    public const KEY_BANK_CHANGE_COOLDOWN_HOURS = 'wallet.bank_change_cooldown_hours';

    public const KEY_WITHDRAWALS_ENABLED = 'wallet.withdrawals_enabled';

    /** Audit event name for one changed key. */
    public const AUDIT_EVENT = 'admin.wallet_setting_updated';

    /**
     * Short-lived cache of the settings rows.
     *
     * NOT a per-request static: a long-lived worker (Octane, queue) would then
     * keep the OLD value for its whole lifetime after the admin changed it. A
     * shared cache with an explicit forget-on-save gives every worker the new
     * value immediately, bounded by the TTL if some future writer ever bypasses
     * save().
     */
    private const CACHE_KEY = 'wallet_settings_v1';

    private const CACHE_TTL_SECONDS = 60;

    /** Binding + shape bounds, shared by the admin panel and the validator. */
    public const RULES = [
        self::KEY_SETTLEMENT_NOTE => ['nullable', 'string', 'max:500'],
        self::KEY_SETTLEMENT_DAYS => ['required', 'integer', 'min:0', 'max:90'],
        self::KEY_MIN_WITHDRAWAL_RIAL => ['required', 'integer', 'min:0', 'max:999999999999'],
        self::KEY_BANK_CHANGE_COOLDOWN_HOURS => ['required', 'integer', 'min:0', 'max:720'],
        self::KEY_WITHDRAWALS_ENABLED => ['required', 'boolean'],
    ];

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::RULES);
    }

    /** Config is ONLY the initial default (and the seed source of the panel). */
    public static function defaults(): array
    {
        return [
            self::KEY_SETTLEMENT_NOTE => (string) config('wallet.settlement.note', ''),
            self::KEY_SETTLEMENT_DAYS => (string) config('wallet.settlement.days', 7),
            self::KEY_MIN_WITHDRAWAL_RIAL => (string) config('wallet.withdrawals.min_amount_rial', 1_000_000),
            self::KEY_BANK_CHANGE_COOLDOWN_HOURS => (string) config('wallet.withdrawals.bank_change_cooldown_hours', 24),
            self::KEY_WITHDRAWALS_ENABLED => config('wallet.withdrawals.enabled', true) ? '1' : '0',
        ];
    }

    /**
     * Effective values (settings row → config default), keyed by setting key.
     *
     * @return array<string, string>
     */
    public static function all(): array
    {
        return array_merge(self::defaults(), self::stored());
    }

    /**
     * ONLY the rows that exist in the settings table (used by the admin panel
     * to show which values were explicitly overridden).
     *
     * @return array<string, string>
     */
    public static function stored(): array
    {
        if (! self::tableExists()) {
            return [];
        }

        return Cache::remember(self::CACHE_KEY, self::CACHE_TTL_SECONDS, fn (): array => SiteSetting::query()
            ->whereIn('key', self::keys())
            ->pluck('value', 'key')
            ->map(fn ($value) => (string) $value)
            ->all());
    }

    public static function get(string $key): ?string
    {
        return self::all()[$key] ?? null;
    }

    /* ------------------------------------------------------------------
     | Typed accessors — the ONLY way the rest of the wallet reads these
     * ------------------------------------------------------------------ */

    /** The settlement text shown to the designer on their wallet page. */
    public static function settlementNote(): string
    {
        return trim((string) self::get(self::KEY_SETTLEMENT_NOTE));
    }

    /** Calendar days from approval until the (estimated) bank transfer. */
    public static function settlementDays(): int
    {
        return max(0, (int) self::get(self::KEY_SETTLEMENT_DAYS));
    }

    public static function minWithdrawalRial(): int
    {
        return max(0, (int) self::get(self::KEY_MIN_WITHDRAWAL_RIAL));
    }

    public static function bankChangeCooldownHours(): int
    {
        return max(0, (int) self::get(self::KEY_BANK_CHANGE_COOLDOWN_HOURS));
    }

    /** The master switch: can a designer submit a payout request at all? */
    public static function withdrawalsEnabled(): bool
    {
        $value = (string) self::get(self::KEY_WITHDRAWALS_ENABLED);

        return in_array($value, ['1', 'true', 'on', 'yes'], true);
    }

    /** The default estimated payout moment, counted from approval (`$from`). */
    public static function expectedPayoutAt(?\DateTimeInterface $from = null): Carbon
    {
        $base = Carbon::instance($from ?? now());

        return $base->copy()->addDays(self::settlementDays());
    }

    /* ------------------------------------------------------------------
     | Panel + writes
     * ------------------------------------------------------------------ */

    /**
     * What the admin settings screen renders: label, type, effective value,
     * default and whether it was explicitly overridden. Labels are Persian
     * because the panel is the only consumer.
     *
     * @return list<array{key:string,label:string,hint:string,type:string,value:string,default:string,overridden:bool,unit:?string}>
     */
    public static function panel(): array
    {
        $stored = self::stored();
        $defaults = self::defaults();
        $effective = self::all();

        $meta = [
            self::KEY_SETTLEMENT_NOTE => [
                'label' => 'متن تسویهٔ نمایشی برای طراح',
                'hint' => 'همین متن در صفحهٔ کیف پول طراح و در جزئیات درخواست‌های برداشت نمایش داده می‌شود.',
                'type' => 'text',
                'unit' => null,
            ],
            self::KEY_SETTLEMENT_DAYS => [
                'label' => 'زمان پیش‌فرض تسویه (روز)',
                'hint' => 'مبنای «تاریخ پیش‌بینی‌شدهٔ واریز» هنگام تأیید درخواست؛ ۰ یعنی واریز همان روز.',
                'type' => 'int',
                'unit' => 'روز',
            ],
            self::KEY_MIN_WITHDRAWAL_RIAL => [
                'label' => 'حداقل مبلغ برداشت',
                'hint' => 'کمتر از این مبلغ درخواست برداشت ثبت نمی‌شود. ورودی به تومان است.',
                'type' => 'toman',
                'unit' => 'تومان',
            ],
            self::KEY_BANK_CHANGE_COOLDOWN_HOURS => [
                'label' => 'مدت انتظار پس از تغییر شبا (ساعت)',
                'hint' => 'تا این مدت پس از تغییر شماره شبا، ثبت درخواست برداشت ممکن نیست. ۰ یعنی بدون انتظار.',
                'type' => 'int',
                'unit' => 'ساعت',
            ],
            self::KEY_WITHDRAWALS_ENABLED => [
                'label' => 'ثبت درخواست برداشت فعال باشد',
                'hint' => 'با غیرفعال‌کردن، طراحان نمی‌توانند درخواست جدید ثبت کنند (درخواست‌های باز دست‌نخورده می‌مانند).',
                'type' => 'bool',
                'unit' => null,
            ],
        ];

        return array_map(fn (string $key): array => [
            'key' => $key,
            'label' => $meta[$key]['label'],
            'hint' => $meta[$key]['hint'],
            'type' => $meta[$key]['type'],
            'unit' => $meta[$key]['unit'],
            'value' => (string) ($effective[$key] ?? ''),
            'default' => (string) ($defaults[$key] ?? ''),
            'overridden' => array_key_exists($key, $stored),
        ], self::keys());
    }

    /**
     * Persist the supplied keys. Values arrive already validated by the
     * FormRequest; only known keys are accepted here (never a free-form key,
     * which would let an admin write arbitrary rows into the settings table).
     *
     * @param  array<string, mixed>  $values
     * @return array<string, array{from:?string,to:?string}> changed keys only
     */
    public static function save(array $values, ?User $actor): array
    {
        $before = self::stored();
        $changed = [];

        foreach (self::keys() as $key) {
            if (! array_key_exists($key, $values) || $values[$key] === null) {
                continue;
            }

            $value = self::normalize($key, $values[$key]);
            $previous = $before[$key] ?? null;

            if ($previous === $value) {
                continue; // no-op write: no row, no audit noise
            }

            SiteSetting::updateOrCreate(['key' => $key], ['value' => $value]);

            $changed[$key] = ['from' => $previous, 'to' => $value];

            AuditTrail::record($actor?->id, self::AUDIT_EVENT, 'site_setting', null, [
                'key' => $key,
                'from' => $previous,
                'to' => $value,
                // The note is free text the admin wrote; it is not sensitive,
                // but the audit row keeps it short and JSON-safe.
                'overridden' => true,
            ]);
        }

        self::flush(); // every worker reads the new values on its next request

        return $changed;
    }

    /** Everything the designer's wallet page needs to explain a settlement. */
    public static function settlementPayload(): array
    {
        return [
            'note' => self::settlementNote(),
            'days' => self::settlementDays(),
            'withdrawals_enabled' => self::withdrawalsEnabled(),
            'min_amount_rial' => self::minWithdrawalRial(),
            'bank_change_cooldown_hours' => self::bankChangeCooldownHours(),
        ];
    }

    /** Invalidate the cached rows (called by save(); also usable from tests). */
    public static function flush(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    private static function normalize(string $key, mixed $value): string
    {
        return match ($key) {
            self::KEY_WITHDRAWALS_ENABLED => filter_var($value, FILTER_VALIDATE_BOOLEAN) ? '1' : '0',
            self::KEY_SETTLEMENT_DAYS,
            self::KEY_MIN_WITHDRAWAL_RIAL,
            self::KEY_BANK_CHANGE_COOLDOWN_HOURS => (string) max(0, (int) Digits::toEnglish((string) $value)),
            default => trim((string) Digits::toEnglish((string) $value)),
        };
    }

    private static function tableExists(): bool
    {
        try {
            return Schema::hasTable('site_settings');
        } catch (\Throwable) {
            // A connection-level failure must degrade to config defaults rather
            // than take the whole wallet endpoint down.
            return false;
        }
    }
}
