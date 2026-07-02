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
</div>

<style>
	.md-progress {
		margin: 0.35rem 0;
	}
	.md-progress-label {
		font-size: var(--text-2xs);
		opacity: 0.7;
		margin-bottom: 0.25rem;
	}
	.md-progress-track {
		width: 100%;
		height: 0.45rem;
		border-radius: var(--radius);
		background: color-mix(in oklab, var(--muted-foreground) 15%, transparent);
		overflow: hidden;
	}
	.md-progress-fill {
		height: 100%;
		border-radius: var(--radius);
		background: color-mix(in oklab, var(--md-progress-token) 70%, transparent);
		transition: width 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}
</style>
