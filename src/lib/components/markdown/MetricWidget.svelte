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

<span class="md-metric" data-trend={trend ?? undefined}>
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
