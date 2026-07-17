<script lang="ts">
	import { copyToClipboard } from '$lib/services/widget-export';
	import { Clipboard } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { resolveDashboardIcon } from './icon-map';
	import { resolveSemanticToken, type SemanticTone } from './semantic-tone';

	interface Props {
		value?: unknown;
		label?: string;
		format?: 'number' | 'currency' | 'compact' | 'percent' | 'date';
		deltaPct?: number | null;
		trend?: 'up' | 'down' | 'flat' | null;
		vs?: unknown;
		size?: 'hero' | 'default' | 'compact';
		layout?: 'tile' | 'row';
		icon?: string;
		iconCount?: number;
		iconTotal?: number;
		accent?: SemanticTone;
		span?: number;
	}

	const {
		value,
		label,
		format = 'number',
		deltaPct,
		trend,
		size = 'default',
		layout = 'tile',
		icon,
		iconCount,
		iconTotal,
		accent,
		span
	}: Props = $props();

	const currencyFmt = new Intl.NumberFormat(undefined, {
		style: 'currency',
		currency: 'USD',
		maximumFractionDigits: 0
	});
	const compactFmt = new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1
	});

	const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

	const displayValue = $derived.by(() => {
		if (value == null) return '—';
		if (format === 'date') {
			// Accepts ISO strings and epoch millis; falls back to the raw value if unparseable.
			const d = new Date(typeof value === 'number' ? value : String(value));
			return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d);
		}
		const n = typeof value === 'number' ? value : Number(value);
		if (Number.isNaN(n)) return String(value);
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

	const Icon = $derived(resolveDashboardIcon(icon));
	const accentToken = $derived(
		accent ? resolveSemanticToken(accent, 'var(--foreground)') : undefined
	);
	// Pictogram: iconCount filled glyphs out of iconTotal (waffle) or a plain repeat.
	const pictogram = $derived.by(() => {
		if (!Icon || iconCount == null || iconCount < 1) return null;
		const total = Math.min(Math.max(iconTotal ?? iconCount, iconCount), 60);
		return { total, filled: Math.min(iconCount, total) };
	});

	const iconSize = $derived(size === 'hero' ? 22 : size === 'compact' ? 12 : 14);

	async function copyValue() {
		await copyToClipboard(displayValue);
	}
</script>

<span
	class="md-metric"
	data-trend={trend ?? undefined}
	data-size={size !== 'default' ? size : undefined}
	data-layout={layout === 'row' ? 'row' : undefined}
	style:grid-column={span && span > 1 ? `span ${span}` : undefined}
	style:--md-metric-accent={accentToken}
>
	{#if layout === 'row'}
		{#if Icon && !pictogram}
			<Icon class="md-metric-icon" size={iconSize} />
		{/if}
		{#if label}<span class="md-metric-label">{label}</span>{/if}
		<span class="md-metric-leader" aria-hidden="true"></span>
		<span class="md-metric-row">
			<span class="md-metric-value">{displayValue}</span>
			{#if trend && deltaPct != null}
				<span class="md-metric-delta md-metric-delta--{trend}">
					{trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–'}
					{Math.abs(deltaPct).toFixed(1)}%
				</span>
			{/if}
		</span>
	{:else}
		{#if pictogram && Icon}
			{@const P = pictogram}
			<span class="md-metric-icons" role="img" aria-label="{displayValue} {label ?? ''}">
				{#each { length: P.total } as _, i (i)}
					<Icon class="md-metric-picto {i < P.filled ? 'is-filled' : 'is-empty'}" size={16} />
				{/each}
			</span>
		{:else if Icon}
			<Icon class="md-metric-icon" size={iconSize} />
		{/if}
		<span class="md-metric-row">
			<span class="md-metric-value">{displayValue}</span>
			<Button
				variant="ghost"
				size="icon-xs"
				class="md-metric-copy"
				onclick={copyValue}
				title="Copy value"
				aria-label="Copy value"
			>
				<Clipboard class="h-3 w-3" />
			</Button>
		</span>
		{#if label}<span class="md-metric-label">{label}</span>{/if}
		{#if trend && deltaPct != null}
			<span class="md-metric-delta md-metric-delta--{trend}">
				{trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–'}
				{Math.abs(deltaPct).toFixed(1)}%
			</span>
		{/if}
	{/if}
</span>
