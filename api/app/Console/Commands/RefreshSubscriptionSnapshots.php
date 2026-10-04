<?php

namespace App\Console\Commands;

use App\Models\Subscription;
use App\Services\AuditTrail;
use App\Services\FeatureGate;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Re-freeze subscription entitlement snapshots from the CURRENT plan
 * configuration — but, by default, WITHOUT ever changing or removing an
 * existing key.
 *
 * WHY THIS EXISTS: POLICY snapshot_entitlements means an active subscriber
 * keeps the entitlements its plan had AT ACTIVATION. That is exactly right
 * for pricing/limits, but it means a NEW capability key (e.g.
 * `designer_studio`) added to a plan is a no-op for everyone who subscribed
 * before — their frozen snapshot simply has no such key and falls through to
 * the free-tier default (false).
 *
 * SAFETY MODEL (approved corrective plan):
 *   - DEFAULT `--mode=additive`: existing keys — and any key outside the
 *     catalog — are left byte-for-byte untouched; only keys that are MISSING
 *     from the snapshot and present in the plan are added. `--only` narrows
 *     this to a specific key set (surgical rollout).
 *   - `--seed-empty`: an empty/null snapshot is SKIPPED by default (a partial
 *     snapshot is never silently treated as a full grant). Only this flag
 *     materializes the plan into an empty snapshot — which is behavior
 *     preserving, because FeatureGate already resolves such a row through the
 *     live plan (`legacy_live`).
 *   - `--mode=full`: the OLD behavior (wholesale rewrite from the plan),
 *     now explicit, loudly warned, and listing every changed/removed key.
 *   - `--apply` is required to write anything; the default is a pure dry run.
 */
class RefreshSubscriptionSnapshots extends Command
{
    protected $signature = 'subscriptions:refresh-snapshot
        {--mode=additive : additive (DEFAULT) adds only missing keys; "full" rewrites the whole snapshot}
        {--only= : Comma-separated entitlement keys to add in additive mode (default: every missing key)}
        {--seed-empty : additive mode: also seed a subscription whose snapshot is empty/null from its plan}
        {--dry-run : Report only — this is the DEFAULT behaviour}
        {--apply : Actually write the entitlement snapshots}
        {--force : Skip the interactive confirmation (with --apply)}
        {--status=active : Comma-separated subscription statuses to refresh}';

    protected $description = 'Add/refresh subscription entitlement snapshots from current plan config (additive, dry-run by default)';

    public function handle(): int
    {
        $apply = (bool) $this->option('apply');
        $mode = (string) $this->option('mode');

        if ($apply && $this->option('dry-run')) {
            $this->error('--apply and --dry-run are mutually exclusive.');

            return self::FAILURE;
        }

        if (! in_array($mode, ['additive', 'full'], true)) {
            $this->error('Invalid --mode; use "additive" (default) or "full".');

            return self::FAILURE;
        }

        $only = array_values(array_filter(array_map('trim', explode(',', (string) $this->option('only')))));
        if ($mode === 'full' && $only !== []) {
            $this->warn('--only is ignored in --mode=full (a full rewrite is not selective).');
            $only = [];
        }

        $statuses = array_values(array_filter(array_map('trim', explode(',', (string) $this->option('status')))));
        if ($statuses === []) {
            $this->error('No status selected.');

            return self::FAILURE;
        }

        /** @var \Illuminate\Support\Collection<int, Subscription> $subscriptions */
        $subscriptions = Subscription::query()
            ->with('plan')
            ->whereIn('status', $statuses)
            ->orderBy('id')
            ->get();

        $this->info('subscriptions:refresh-snapshot — ' . ($apply ? 'APPLY' : 'DRY RUN (default)') . " [mode={$mode}]");
        $this->line('Statuses: ' . implode(',', $statuses) . ' — ' . $subscriptions->count() . ' subscription(s)'
            . ($only !== [] ? ' | only=[' . implode(',', $only) . ']' : ''));

        $addedSummary = [];
        $changedSummary = [];
        $removedSummary = [];
        $unchanged = 0;
        $skipped = 0;
        $emptySkipped = 0;
        /** @var array<int, array{subscription: Subscription, new: array<string,mixed>|null, diff: array{added: array<string,mixed>, changed: array<string,mixed>, removed: array<string,mixed>}, reason: string}> $pending */
        $pending = [];

        foreach ($subscriptions as $subscription) {
            if ($subscription->plan === null) {
                $skipped++;
                continue;
            }

            $current = is_array($subscription->entitlements) ? $subscription->entitlements : [];
            $plan = FeatureGate::normalize($subscription->plan->features);
            $isEmpty = $current === [];

            if ($mode === 'additive' && $isEmpty && ! $this->option('seed-empty')) {
                $emptySkipped++;
                $this->line('  #' . $subscription->id . ' skipped: empty snapshot — pass --seed-empty to materialize its plan (never implied).');
                continue;
            }

            if ($mode === 'additive' && ! $isEmpty) {
                $additions = [];
                foreach ($plan as $key => $value) {
                    if (array_key_exists($key, $current)) {
                        continue; // never change an existing key
                    }
                    if ($only !== [] && ! in_array($key, $only, true)) {
                        continue;
                    }
                    $additions[$key] = $value;
                }

                if ($additions === []) {
                    $unchanged++;
                    continue;
                }

                // Preserve every existing key; append only the missing ones.
                $new = $current + $additions;
                $diff = ['added' => $additions, 'changed' => [], 'removed' => []];
                $reason = 'additive';
            } else {
                // mode=full, or additive + seed-empty: materialize the plan.
                $new = $plan;
                $diff = $this->diff($current, $new);
                $reason = $isEmpty ? 'seed-empty' : 'full';

                if ($diff['added'] === [] && $diff['changed'] === [] && $diff['removed'] === []) {
                    $unchanged++;
                    continue;
                }
            }

            foreach (array_keys($diff['added']) as $key) {
                $addedSummary[$key] = ($addedSummary[$key] ?? 0) + 1;
            }
            foreach (array_keys($diff['changed']) as $key) {
                $changedSummary[$key] = ($changedSummary[$key] ?? 0) + 1;
            }
            foreach (array_keys($diff['removed']) as $key) {
                $removedSummary[$key] = ($removedSummary[$key] ?? 0) + 1;
            }

            $pending[] = ['subscription' => $subscription, 'new' => $new, 'diff' => $diff, 'reason' => $reason];
            $this->line('  #' . $subscription->id . ' business=' . $subscription->business_id . ' plan=' . ($subscription->plan->slug ?? $subscription->plan_id)
                . ' [' . $reason . ']'
                . ' added=[' . implode(',', array_keys($diff['added'])) . ']'
                . ' changed=[' . implode(',', array_keys($diff['changed'])) . ']'
                . ' removed=[' . implode(',', array_keys($diff['removed'])) . ']');
        }

        $this->newLine();
        $this->line('Unchanged: ' . $unchanged
            . ' | To refresh: ' . count($pending)
            . ' | Skipped (empty snapshot): ' . $emptySkipped
            . ' | Skipped (no plan): ' . $skipped);

        foreach (['Added' => $addedSummary, 'Changed' => $changedSummary, 'Removed' => $removedSummary] as $label => $summary) {
            if ($summary === []) {
                continue;
            }
            $this->line($label . ' keys:');
            foreach ($summary as $key => $count) {
                $this->line('  ' . $key . ': ' . $count);
            }
        }

        if ($pending === []) {
            $this->info('Nothing to do.');

            return self::SUCCESS;
        }

        if ($mode === 'full' || $removedSummary !== [] || $changedSummary !== []) {
            $this->newLine();
            $this->warn('!! WARNING: this run would CHANGE or REMOVE existing entitlement keys:'
                . ' changed=[' . implode(',', array_keys($changedSummary)) . ']'
                . ' removed=[' . implode(',', array_keys($removedSummary)) . '].');
            $this->warn('   Additive mode (default) never does this. Proceed only with an explicit business decision.');
        }

        if (! $apply) {
            $this->newLine();
            $this->line('Nothing was written. Re-run with --apply to refresh.');

            return self::SUCCESS;
        }

        if (! $this->option('force')
            && ! $this->confirm('Write entitlement snapshots for ' . count($pending) . ' subscription(s)?', false)) {
            $this->warn('Aborted — no changes were written.');

            return self::FAILURE;
        }

        $applied = 0;
        foreach ($pending as $item) {
            $subscription = $item['subscription'];
            $new = $item['new'];
            $diff = $item['diff'];

            DB::transaction(function () use ($subscription, $new, $diff, $mode, $only, $item, &$applied): void {
                /** @var Subscription $locked */
                $locked = Subscription::query()->whereKey($subscription->id)->lockForUpdate()->first();
                if ($locked === null) {
                    return;
                }

                $locked->forceFill(['entitlements' => $new])->save();

                AuditTrail::record(null, 'subscription.snapshot_refreshed', 'subscription', $locked->id, [
                    'plan_id' => (int) $locked->plan_id,
                    'mode' => $mode,
                    'reason' => $item['reason'],
                    'only' => $only,
                    'added' => array_keys($diff['added']),
                    'changed' => array_keys($diff['changed']),
                    'removed' => array_keys($diff['removed']),
                    'source' => 'console',
                ]);

                $applied++;
            });
        }

        $this->info("Refreshed {$applied} subscription snapshot(s).");

        return self::SUCCESS;
    }

    /**
     * Key-level diff between two entitlement maps.
     *
     * @return array{added: array<string,mixed>, changed: array<string,mixed>, removed: array<string,mixed>}
     */
    private function diff(array $current, array $fresh): array
    {
        $added = [];
        $changed = [];
        $removed = [];

        foreach ($fresh as $key => $value) {
            if (! array_key_exists($key, $current)) {
                $added[$key] = $value;

                continue;
            }
            if ($current[$key] !== $value) {
                $changed[$key] = ['from' => $current[$key], 'to' => $value];
            }
        }

        foreach (array_keys($current) as $key) {
            if (! array_key_exists($key, $fresh)) {
                $removed[$key] = $current[$key];
            }
        }

        return ['added' => $added, 'changed' => $changed, 'removed' => $removed];
    }
}
