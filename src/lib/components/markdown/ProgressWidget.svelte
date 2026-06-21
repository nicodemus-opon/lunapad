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
			? 'var(--chart-2, #16a34a)'
			: color === 'warning'
				? '#d97706'
				: color === 'error'
					? 'var(--destructive, #dc2626)'
					: 'var(--chart-1, #3b82f6)'
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
		font-size: 0.72rem;
		opacity: 0.7;
		margin-bottom: 0.25rem;
	}
	.md-progress-track {
		width: 100%;
		height: 0.45rem;
		border-radius: 0.395rem;
		background: color-mix(in oklch, currentColor 8%, transparent);
		overflow: hidden;
	}
	.md-progress-fill {
		height: 100%;
		border-radius: 0.395rem;
		background: color-mix(in oklch, var(--md-progress-token) 70%, transparent);
		transition: width 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}
</style>
