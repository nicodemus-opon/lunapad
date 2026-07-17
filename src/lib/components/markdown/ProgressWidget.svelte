<script lang="ts">
	import { Progress } from '$lib/components/ui/progress';

	interface Props {
		value?: number;
		max?: number;
		label?: string;
		color?: 'info' | 'success' | 'warning' | 'error';
		span?: number;
	}

	const { value = 0, max = 100, label, color = 'info', span }: Props = $props();

	const token = $derived(
		color === 'success'
			? 'var(--success)'
			: color === 'warning'
				? 'var(--warning)'
				: color === 'error'
					? 'var(--destructive)'
					: 'var(--chart-1)'
	);

	const pct = $derived(max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0);
</script>

<div
	class="md-progress"
	style="--md-progress-token: {token}"
	style:grid-column={span && span > 1 ? `span ${span}` : undefined}
>
	{#if label}<div class="md-progress-label">{label}</div>{/if}
	<Progress value={pct} max={100} class="md-progress-track" />
	<div class="md-progress-value">{pct.toFixed(0)}%</div>
</div>
