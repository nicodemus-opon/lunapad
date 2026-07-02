<script lang="ts">
	import { copyToClipboard } from '$lib/services/widget-export';
	import { Clipboard } from '@lucide/svelte';

	interface Props {
		value?: unknown;
		label?: string;
		format?: 'number' | 'currency' | 'compact' | 'percent';
		deltaPct?: number | null;
		trend?: 'up' | 'down' | 'flat' | null;
		vs?: unknown;
	}

	const { value, label, format = 'number', deltaPct, trend }: Props = $props();

	const currencyFmt = new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0
	});
	const compactFmt = new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1
	});

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

	async function copyValue() {
		await copyToClipboard(displayValue);
	}
</script>

<span class="md-metric rounded p-4" data-trend={trend ?? undefined}>
	<span class="md-metric-row">
		<span class="md-metric-value">{displayValue}</span>
		<button
			type="button"
			class="md-metric-copy"
			onclick={copyValue}
			title="Copy value"
			aria-label="Copy value"
		>
			<Clipboard class="h-3 w-3" />
		</button>
	</span>
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

		background: transparent;
		border: 1px var(--border) solid;
		margin: 0.15rem 0.2rem 0.15rem 0;
		vertical-align: top;
	}
	.md-metric-row {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.md-metric-copy {
		opacity: 0;
		transition: opacity 0.15s;
	}
	.md-metric:hover .md-metric-copy {
		opacity: 0.65;
	}
	.md-metric-value {
		font-size: 1.15rem;
		font-weight: 700;
		line-height: 1.1;
	}
	.md-metric-label {
		font-size: var(--text-2xs);
		opacity: 0.65;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.md-metric-delta {
		font-size: var(--text-2xs);
		font-weight: 600;
	}
	.md-metric-delta--up {
		color: var(--success);
	}
	.md-metric-delta--down {
		color: var(--destructive);
	}
</style>
