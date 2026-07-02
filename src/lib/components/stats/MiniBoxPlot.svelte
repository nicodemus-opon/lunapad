<script lang="ts">
	import { fmtStatNum, STATS_BOX_PLOT } from './stats-ui';

	interface Props {
		min: number;
		max: number;
		q25: number;
		median: number;
		q75: number;
	}

	const { min, max, q25, median, q75 }: Props = $props();

	const range = $derived(max - min || 1);
	const q25x = $derived(((q25 - min) / range) * 100);
	const q50x = $derived(((median - min) / range) * 100);
	const q75x = $derived(((q75 - min) / range) * 100);
</script>

<div class="space-y-0.5">
	<p class="text-[10px] text-muted-foreground">Distribution</p>
	<svg class="h-8 w-full {STATS_BOX_PLOT}" viewBox="0 0 100 16" preserveAspectRatio="none">
		<line x1="2" y1="8" x2="98" y2="8" stroke="currentColor" stroke-width="1" opacity="0.35" />
		<rect
			x={q25x}
			y="4"
			width={q75x - q25x}
			height="8"
			fill="currentColor"
			fill-opacity="0.2"
			stroke="currentColor"
			stroke-width="0.8"
			opacity="0.85"
		/>
		<line
			x1={q50x}
			y1="3"
			x2={q50x}
			y2="13"
			stroke="currentColor"
			stroke-width="1.5"
			opacity="0.9"
		/>
		<line x1="2" y1="5" x2="2" y2="11" stroke="currentColor" stroke-width="1" opacity="0.5" />
		<line x1="98" y1="5" x2="98" y2="11" stroke="currentColor" stroke-width="1" opacity="0.5" />
	</svg>
	<div class="flex justify-between font-mono text-[10px] text-muted-foreground tabular-nums">
		<span>{fmtStatNum(min)}</span>
		<span>{fmtStatNum(max)}</span>
	</div>
</div>
