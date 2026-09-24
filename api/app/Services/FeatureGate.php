<?php

namespace App\Services;

use App\Models\Business;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;

/**
 * The ONE authorization/entitlement service. Every feature/limit decision
 * goes through here — no controller may read plan features directly, and no
 * frontend value is ever trusted.
 *
 * Evolution of the Phase 5 boolean gate:
 *   activeSubscription() — unchanged contract (latest active, non-expired)
 *   allows()             — same signature; now reads the ENTITLEMENT SNAPSHOT
 *                          (POLICY snapshot_entitlements) with a live-resolve
 *                          fallback for legacy rows that predate snapshots.
 *   limit()              — NEW: numeric limits (null = unlimited)
 *   capabilities()       — NEW: full normalized capability map for the card
 *                          editor and the frontend contract.
 *
 * Resolution order for every key:
 *   1. subscription entitlement snapshot (frozen at activation)
 *   2. legacy fallback: live plan->features (rows without a snapshot)
 *   3. free tier defaults from config/entitlements.php
 */
class FeatureGate {
    /** Catalog entry: [type, fa_label, group, free_value]. */
    public static function catalog(): array {
        return Config::get('entitlements.catalog', []);
    }

    /** Free-tier defaults — the baseline every business resolves to. */
    public static function freeTier(): array {
        return Config::get('entitlements.free_tier', ['name' => 'Free', 'label' => 'پلن رایگان', 'description' => '', 'capabilities' => []]);
    }

    public static function policy(string $key, mixed $default = null): mixed {
        return Config::get("entitlements.policies.{$key}", $default);
    }

    /** Normalize arbitrary plan-JSON against the catalog: unknown keys dropped, wrong types coerced/dropped. */
    public static function normalize(?array $features): array {
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

    public function activeSubscription(Business $business): ?object {
        return $business->subscriptions()->with('plan')->where('status','active')->where(function($q): void { $q->whereNull('end_date')->orWhereDate('end_date','>=',Carbon::today()); })->latest('end_date')->first();
    }

    /**
     * The entitlement map that actually governs this business:
     * snapshot (or legacy live resolve) ⊕ free-tier defaults.
     *
     * @return array{map: array<string,mixed>, plan_name: string, source: string}
     */
    public function capabilities(Business $business): array {
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

    public function allows(Business $business, string $feature): bool {
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
    public function allowsValue(Business $business, string $capability, string $value): bool {
        $entry = self::catalog()[$capability] ?? null;
        if ($entry === null || $entry[0] !== 'list') {
            return false;
        }
        $map = $this->capabilities($business)['map'];
        $allowed = $map[$capability] ?? ($entry[3] ?? []);

        return in_array($value, (array) $allowed, true);
    }

    /** Numeric limit; null = unlimited. Never negative. */
    public function limit(Business $business, string $key): ?int {
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
     * Full client contract payload for the card editor (and any UI).
     * Frontend uses this ONLY for UX — the backend stays authoritative.
     *
     * @return array{plan: string, source: string, capabilities: array<string,mixed>}
     */
    public function payload(Business $business): array {
        ['map' => $map, 'plan_name' => $planName, 'source' => $source] = $this->capabilities($business);

        return [
            'plan' => $planName,
            'source' => $source,
            'capabilities' => $map,
        ];
    }
}
