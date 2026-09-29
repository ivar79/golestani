<?php

namespace App\Services;

use App\Models\Business;
use App\Models\Subscription;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;

/**
 * The ONE authorization/entitlement service. Every feature/limit decision
 * goes through here — no controller may read plan features directly, and no
 * frontend value is ever trusted.
 *
 * Evolution of the Phase 5 boolean gate:
 *   activeSubscription() — unchanged contract (latest active, non-expired);
 *                          now also LAZILY PROMOTES a due `scheduled`
 *                          subscription the instant its start time passes
 *                          (downgrade activates exactly at expires_at of the
 *                          superseded plan — no cron needed for correctness)
 *   allows()             — same signature; reads the ENTITLEMENT SNAPSHOT
 *                          (POLICY snapshot_entitlements) with a live-resolve
 *                          fallback for legacy rows that predate snapshots.
 *   limit()              — numeric limits (null = unlimited)
 *   capabilities()       — full normalized capability map for the card
 *                          editor and the frontend contract.
 *   payload()            — + `scheduled` block (the upcoming plan change, if
 *                          any) so the dashboard can show "تغییر پلن
 *                          زمان‌بندی‌شده" without any extra endpoint.
 *
 * Resolution order for every key:
 *   1. subscription entitlement snapshot (frozen at activation)
 *   2. legacy fallback: live plan->features (rows without a snapshot)
 *   3. free tier defaults from config/entitlements.php
 */
class FeatureGate
{
    /** Catalog entry: [type, fa_label, group, free_value]. */
    public static function catalog(): array
    {
        return Config::get('entitlements.catalog', []);
    }

    /** Free-tier defaults — the baseline every business resolves to. */
    public static function freeTier(): array
    {
        return Config::get('entitlements.free_tier', ['name' => 'Free', 'label' => 'پلن رایگان', 'description' => '', 'capabilities' => []]);
    }

    public static function policy(string $key, mixed $default = null): mixed
    {
        return Config::get("entitlements.policies.{$key}", $default);
    }

    /** Normalize arbitrary plan-JSON against the catalog: unknown keys dropped, wrong types coerced/dropped. */
    public static function normalize(?array $features): array
    {
        $normalized = [];
        foreach (self::catalog() as $key => [$type]) {
            if (! is_array($features) || ! array_key_exists($key, $features)) {
                continue; // missing key → falls through to lower layers
            }
            $value = $features[$key];
            $normalized[$key] = match ($type) {
                'bool' => (bool) $value,
                'int' => $value === null ? null : max(0, (int) $value),
                'list' => is_array($value) ? array_values(array_filter($value, 'is_scalar')) : null,
                default => $value,
            };
        }

        return $normalized;
    }

    /**
     * The ACTIVE, still-valid subscription — evaluated against the SERVER
     * clock, never a stored flag alone. This is the access-control boundary:
     * the instant `expires_at` passes, the row stops granting entitlements
     * (no cron required), and free-tier limits return automatically.
     *
     * Timestamp lifecycle: rows carry started_at/expires_at (UTC timestamps,
     * set at activation). Expiry is checked against expires_at with second
     * precision. Legacy receipt-era rows without timestamps fall back to the
     * old day-granular behaviour (end_date >= today) — behaviour-preserving.
     *
     * SCHEDULED PROMOTION: a paid `scheduled` subscription (downgrade) whose
     * started_at has passed is promoted to active here — lazily, under a
     * short transaction, the first time ANY read happens after the boundary.
     * This keeps "downgrade activates after the current plan ends" true
     * without depending on the nightly sweep.
     */
    public function activeSubscription(Business $business): ?Subscription
    {
        $now = Carbon::now();

        // Lazy promotion first (cheap existence probe; locks only when due).
        $this->promoteDueScheduled($business, $now);

        return $business->subscriptions()->with('plan')
            ->where('status', 'active')
            ->where(function ($q) use ($now): void {
                // Timestamp lifecycle: strictly future expires_at = valid.
                $q->where(function ($t) use ($now): void {
                    $t->whereNotNull('expires_at')->where('expires_at', '>', $now);
                })
                // Legacy fallback: no timestamps → old day-granular rule.
                    ->orWhere(function ($d): void {
                        $d->whereNull('expires_at')->where(function ($dd): void {
                            $dd->whereNull('end_date')->orWhereDate('end_date', '>=', Carbon::today());
                        });
                    });
            })
            // A row whose started_at is in the future must never grant
            // anything yet (defensive: scheduled rows are flipped to active
            // by the promotion above, exactly at their start time).
            ->where(function ($q) use ($now): void {
                $q->whereNull('started_at')->orWhere('started_at', '<=', $now);
            })
            // Newest-created first (portable across drivers): among rows that
            // still qualify, the most recently activated subscription is the
            // business's current plan.
            ->latest('id')
            ->first();
    }

    /**
     * Promote a due scheduled subscription to active. Locks the business row
     * so a concurrent read + the nightly sweep can never double-apply (the
     * status update is guarded by re-reading under lock).
     */
    private function promoteDueScheduled(Business $business, Carbon $now): void
    {
        $due = $business->subscriptions()
            ->where('status', 'scheduled')
            ->where(function ($q) use ($now): void {
                $q->whereNotNull('started_at')->where('started_at', '<=', $now);
            })
            ->orderBy('id')
            ->first();

        if ($due === null) {
            return;
        }

        DB::transaction(function () use ($business, $due, $now): void {
            $business->query()->whereKey($business->id)->lockForUpdate()->first();

            // Re-read under lock: the sweep or another request may have won.
            /** @var Subscription|null $scheduled */
            $scheduled = $business->subscriptions()->where('status', 'scheduled')->orderBy('id')->lockForUpdate()->first();
            if ($scheduled === null) {
                return;
            }

            $startsAt = $scheduled->started_at ?? $scheduled->lifetimeStartedAt();
            if ($startsAt === null || $startsAt->gt($now)) {
                return; // not due anymore (rebased?) — leave untouched
            }

            $business->subscriptions()
                ->where('status', 'active')
                ->where('id', '!=', $scheduled->id)
                ->update(['status' => 'expired', 'admin_note' => "پایان دوره — فعال‌سازی پلن زمان‌بندی‌شده {$scheduled->plan_name}"]);

            $scheduled->forceFill(['status' => 'active'])->save();
        });
    }

    /**
     * The entitlement map that actually governs this business:
     * snapshot (or legacy live resolve) ⊕ free-tier defaults.
     *
     * @return array{map: array<string,mixed>, plan_name: string, source: string}
     */
    public function capabilities(Business $business): array
    {
        $map = self::freeTier()['capabilities'];
        $planName = self::freeTier()['name'] ?? 'Free';
        $source = 'free';

        $subscription = $this->activeSubscription($business);
        if ($subscription) {
            if (is_array($subscription->entitlements) && $subscription->entitlements !== []) {
                // POLICY snapshot_entitlements — frozen at activation.
                $map = array_merge($map, self::normalize($subscription->entitlements));
                $source = 'snapshot';
            } elseif ($subscription->plan?->features !== null) {
                // Legacy self-healing path: pre-snapshot rows keep working.
                $map = array_merge($map, self::normalize($subscription->plan->features));
                $source = 'legacy_live';
            }
            $planName = $subscription->plan_name ?? $subscription->plan?->name ?? $planName;
        }

        return ['map' => $map, 'plan_name' => $planName, 'source' => $source];
    }

    public function allows(Business $business, string $feature): bool
    {
        $map = $this->capabilities($business)['map'];
        $entry = self::catalog()[$feature] ?? null;
        if ($entry === null) {
            return false; // unknown capability is never granted
        }
        $value = $map[$feature] ?? ($entry[3] ?? false);

        return match ($entry[0]) {
            'int' => ((int) $value) > 0, // a positive quota grants the feature
            'list' => is_array($value) && $value !== [],
            default => (bool) $value,
        };
    }

    /**
     * Value-level check for list capabilities (e.g. is template "midnight"
     * inside card_templates?). allows() only answers whether the feature
     * exists at all — membership is a distinct question.
     */
    public function allowsValue(Business $business, string $capability, string $value): bool
    {
        $entry = self::catalog()[$capability] ?? null;
        if ($entry === null || $entry[0] !== 'list') {
            return false;
        }
        $map = $this->capabilities($business)['map'];
        $allowed = $map[$capability] ?? ($entry[3] ?? []);

        return in_array($value, (array) $allowed, true);
    }

    /** Numeric limit; null = unlimited. Never negative. */
    public function limit(Business $business, string $key): ?int
    {
        $map = $this->capabilities($business)['map'];
        // array_key_exists (not ??): an explicit null means UNLIMITED and must
        // not fall through to the free-tier default.
        $value = array_key_exists($key, $map) ? $map[$key] : (self::catalog()[$key][3] ?? 0);
        if ($value === null) {
            return null;
        }

        return max(0, (int) $value);
    }

    /**
     * The upcoming scheduled change, if any (downgrade waiting for the
     * current plan to end). Read-only — never grants entitlements.
     */
    public function scheduledSubscription(Business $business): ?Subscription
    {
        return $business->subscriptions()
            ->where('status', 'scheduled')
            ->orderBy('id')
            ->first();
    }

    /**
     * Full client contract payload for the card editor (and any UI).
     * Frontend uses this ONLY for UX — the backend stays authoritative.
     *
     * @return array{plan: string, source: string, capabilities: array<string,mixed>, scheduled: ?array{id:int,plan_id:int,plan_name:?string,starts_at:?string,ends_at:?string}}
     */
    public function payload(Business $business): array
    {
        ['map' => $map, 'plan_name' => $planName, 'source' => $source] = $this->capabilities($business);

        $scheduled = $this->scheduledSubscription($business);

        return [
            'plan' => $planName,
            'source' => $source,
            'capabilities' => $map,
            'scheduled' => $scheduled ? [
                'id' => $scheduled->id,
                'plan_id' => (int) $scheduled->plan_id,
                'plan_name' => $scheduled->plan_name ?? $scheduled->plan?->name,
                'starts_at' => ($scheduled->started_at ?? $scheduled->lifetimeStartedAt())?->toIso8601String(),
                'ends_at' => $scheduled->lifetimeEndsAt()?->toIso8601String(),
            ] : null,
        ];
    }
}
