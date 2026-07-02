<script lang="ts">
	import { STATS_HISTOGRAM } from './stats-ui';
	interface Props {
		buckets: number[];
		min?: number | null;
		max?: number | null;
		width?: number;
		height?: number;
	}

	const { buckets, min = null, max = null, width = 120, height = 32 }: Props = $props();

	const maxBucket = $derived(Math.max(...buckets, 1));
</script>

<div class="space-y-0.5">
	<svg {width} {height} viewBox="0 0 {width} {height}" class={STATS_HISTOGRAM}>
		{#each buckets as v, i (i)}
			{@const bw = width / buckets.length}
			{@const bh = (v / maxBucket) * height}
			<rect x={i * bw} y={height - bh} width={bw - 0.5} height={bh} fill="currentColor" rx="0.5" />
		{/each}
	</svg>
	{#if min != null && max != null}
		<div class="flex justify-between text-[10px] leading-none text-muted-foreground tabular-nums">
			<span>{min.toLocaleString()}</span>
			<span>{max.toLocaleString()}</span>
		</div>
	{/if}
</div>
