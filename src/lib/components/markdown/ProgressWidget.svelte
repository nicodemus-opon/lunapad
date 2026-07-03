<script lang="ts">
	interface Props {
		value?: number;
		max?: number;
		label?: string;
		color?: 'info' | 'success' | 'warning' | 'error';
	}

	const { value = 0, max = 100, label, color = 'info' }: Props = $props();

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

<div class="md-progress" style="--md-progress-token: {token}">
	{#if label}<div class="md-progress-label">{label}</div>{/if}
	<div class="md-progress-track">
		<div class="md-progress-fill" style="width: {pct}%"></div>
	</div>
	<div class="md-progress-value">{pct.toFixed(0)}%</div>
</div>
