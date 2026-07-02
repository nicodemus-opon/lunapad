<script lang="ts">
	import type { ColumnProfile } from '$lib/services/column-profile';
	import MiniHistogram from './MiniHistogram.svelte';
	import MiniBoxPlot from './MiniBoxPlot.svelte';
	import TopValuesList from './TopValuesList.svelte';
	import {
		KIND_ICON,
		kindBadgeClass,
		fmtStatNum,
		fmtPct,
		STATS_BAR_PRIMARY,
		STATS_BAR_SECONDARY
	} from './stats-ui';

	interface Props {
		profile: ColumnProfile;
		compact?: boolean;
	}

	const { profile, compact = false }: Props = $props();

	const Icon = $derived(KIND_ICON[profile.kind]);
	const label = $derived(profile.typeLabel ?? profile.kind);
</script>

<div class="overflow-hidden rounded-lg border bg-card">
	<div class="flex items-center gap-2 border-b bg-muted/30 px-3 py-2.5">
		<Icon class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
		<span class="min-w-0 flex-1 truncate font-mono text-sm font-medium">{profile.column}</span>
		<span class="rounded-md px-1.5 py-0.5 text-2xs font-medium {kindBadgeClass(profile.kind)}">
			{label}
		</span>
		{#if profile.isLikelyId}
			<span class="rounded-md bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">likely id</span
			>
		{/if}
		{#if profile.isConstant}
			<span class="rounded-md bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">constant</span>
		{/if}
	</div>

	<div
		class="grid grid-cols-1 gap-0 divide-y {compact
			? ''
			: 'md:grid-cols-2 md:divide-x md:divide-y-0'}"
	>
		<div class="space-y-3 px-3 py-3">
			<div>
				<div class="mb-1 flex items-center justify-between text-2xs">
					<span class="text-muted-foreground">Completeness</span>
					<span class="font-medium tabular-nums">{fmtPct(profile.completeness, 1)}</span>
				</div>
				<div class="h-2 overflow-hidden rounded-full bg-muted">
					<div
						class="h-full rounded-full {STATS_BAR_PRIMARY}"
						style="width: {profile.completeness}%"
					></div>
				</div>
				{#if profile.nullCount > 0}
					<p class="mt-0.5 text-2xs text-muted-foreground tabular-nums">
						{profile.nullCount.toLocaleString()} missing ({fmtPct(profile.nullPct, 1)})
					</p>
				{:else}
					<p class="mt-0.5 text-2xs text-muted-foreground">No missing values</p>
				{/if}
			</div>

			<div>
				<div class="mb-1 flex items-center justify-between text-2xs">
					<span class="text-muted-foreground">Distinct</span>
					<span class="font-medium tabular-nums">
						{profile.unique.toLocaleString()}
						<span class="font-normal text-muted-foreground">({fmtPct(profile.uniquePct, 1)})</span>
					</span>
				</div>
				<div class="h-2 overflow-hidden rounded-full bg-muted">
					<div
						class="h-full rounded-full {STATS_BAR_SECONDARY}"
						style="width: {Math.min(100, profile.uniquePct)}%"
					></div>
				</div>
			</div>

			{#if profile.numeric}
				{@const n = profile.numeric}
				<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-2xs">
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Min</span>
						<span class="font-mono tabular-nums">{fmtStatNum(n.min)}</span>
					</div>
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Max</span>
						<span class="font-mono tabular-nums">{fmtStatNum(n.max)}</span>
					</div>
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Mean</span>
						<span class="font-mono tabular-nums">{fmtStatNum(n.mean)}</span>
					</div>
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Median</span>
						<span class="font-mono tabular-nums">{fmtStatNum(n.median)}</span>
					</div>
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Std dev</span>
						<span class="font-mono tabular-nums">{fmtStatNum(n.stddev)}</span>
					</div>
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Sum</span>
						<span class="font-mono tabular-nums">{fmtStatNum(n.sum)}</span>
					</div>
					{#if n.q25 != null && n.q75 != null}
						<div class="flex justify-between gap-2">
							<span class="text-muted-foreground">IQR</span>
							<span class="font-mono tabular-nums">{fmtStatNum(n.q75 - n.q25)}</span>
						</div>
					{/if}
					{#if n.skew != null}
						<div class="flex justify-between gap-2">
							<span class="text-muted-foreground">Skewness</span>
							<span class="font-mono tabular-nums">{fmtStatNum(n.skew, 3)}</span>
						</div>
					{/if}
					{#if n.kurt != null}
						<div class="flex justify-between gap-2">
							<span class="text-muted-foreground">Kurtosis</span>
							<span class="font-mono tabular-nums">{fmtStatNum(n.kurt, 3)}</span>
						</div>
					{/if}
				</div>

				{#if n.histogramBuckets && n.min != null && n.max != null}
					<div class="space-y-2">
						<MiniHistogram buckets={n.histogramBuckets} min={n.min} max={n.max} />
						{#if n.q25 != null && n.median != null && n.q75 != null}
							<MiniBoxPlot min={n.min} max={n.max} q25={n.q25} median={n.median} q75={n.q75} />
						{/if}
					</div>
				{/if}
			{:else if profile.boolean}
				{@const total = profile.boolean.trueCount + profile.boolean.falseCount || 1}
				{@const truePct = (profile.boolean.trueCount / total) * 100}
				<div class="space-y-1.5 text-2xs">
					<div class="flex items-center gap-2">
						<span class="w-10 text-muted-foreground">True</span>
						<div class="h-3 flex-1 overflow-hidden rounded bg-muted">
							<div class="h-full rounded {STATS_BAR_PRIMARY}" style="width: {truePct}%"></div>
						</div>
						<span class="w-16 text-right font-mono tabular-nums">
							{profile.boolean.trueCount.toLocaleString()} ({fmtPct(truePct, 1)})
						</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="w-10 text-muted-foreground">False</span>
						<div class="h-3 flex-1 overflow-hidden rounded bg-muted">
							<div
								class="h-full rounded {STATS_BAR_SECONDARY}"
								style="width: {100 - truePct}%"
							></div>
						</div>
						<span class="w-16 text-right font-mono tabular-nums">
							{profile.boolean.falseCount.toLocaleString()} ({fmtPct(100 - truePct, 1)})
						</span>
					</div>
				</div>
			{:else if profile.temporal}
				<div class="grid grid-cols-1 gap-y-1 text-2xs">
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Min</span>
						<span class="font-mono">{profile.temporal.min ?? '—'}</span>
					</div>
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Max</span>
						<span class="font-mono">{profile.temporal.max ?? '—'}</span>
					</div>
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Range</span>
						<span class="font-mono tabular-nums">
							{profile.temporal.rangeDays != null
								? `${profile.temporal.rangeDays.toLocaleString()} days`
								: '—'}
						</span>
					</div>
				</div>
			{:else if profile.text}
				<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-2xs">
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Avg length</span>
						<span class="font-mono tabular-nums">{fmtStatNum(profile.text.avgLen, 1)}</span>
					</div>
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Min length</span>
						<span class="font-mono tabular-nums">{fmtStatNum(profile.text.minLen, 0)}</span>
					</div>
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Max length</span>
						<span class="font-mono tabular-nums">{fmtStatNum(profile.text.maxLen, 0)}</span>
					</div>
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Empty strings</span>
						<span class="font-mono tabular-nums">{profile.text.emptyCount.toLocaleString()}</span>
					</div>
				</div>
			{/if}
		</div>

		<div class="px-3 py-3">
			<p class="mb-2 text-2xs tracking-wider text-muted-foreground uppercase">Top values</p>
			<TopValuesList values={profile.topValues} {compact} />
		</div>
	</div>
</div>
