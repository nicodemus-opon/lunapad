<script lang="ts">
	interface Props {
		value?: unknown;
		label?: string;
		format?: 'number' | 'currency' | 'compact' | 'percent';
		deltaPct?: number | null;
		trend?: 'up' | 'down' | 'flat' | null;
	}

	const { value, label, format = 'number', deltaPct, trend }: Props = $props();

	const currencyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
	const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

	const displayValue = $derived.by(() => {
		const n = typeof value === 'number' ? value : Number(value);
		if (value == null || Number.isNaN(n)) return value == null ? '—' : String(value);
		switch (format) {
			case 'currency':
				return currencyFmt.format(n);
			case 'compact':
				return compactFmt.format(n);
			case 'percent':
				return `${n.toFixed(1)}%`;
			default:
				return n.toLocaleString();
		}
	});
</script>

<span class="md-metric rounded p-4" data-trend={trend ?? undefined}>
	<span class="md-metric-value">{displayValue}</span>
	{#if label}<span class="md-metric-label">{label}</span>{/if}
	{#if trend && deltaPct != null}
		<span class="md-metric-delta md-metric-delta--{trend}">
			{trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–'}
			{Math.abs(deltaPct).toFixed(1)}%
		</span>
	{/if}
</span>

<style>
	.md-metric {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.1rem;

		background: color-mix(in oklch, currentColor 5%, transparent);
		border: 1px solid color-mix(in oklch, currentColor 12%, transparent);
		margin: 0.15rem 0.2rem 0.15rem 0;
		vertical-align: top;
	}
	.md-metric-value {
		font-size: 1.15rem;
		font-weight: 700;
		line-height: 1.1;
	}
	.md-metric-label {
		font-size: 0.7rem;
		opacity: 0.65;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.md-metric-delta {
		font-size: 0.72rem;
		font-weight: 600;
	}
	.md-metric-delta--up {
		color: var(--chart-2, #16a34a);
	}
	.md-metric-delta--down {
		color: var(--destructive, #dc2626);
	}
	.md-metric-delta--flat {
		opacity: 0.6;
	}
</style>
