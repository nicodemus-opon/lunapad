<script lang="ts">
	import { CircleCheck, CircleX, ExternalLink } from '@lucide/svelte';
	import { coerceNumber } from '$lib/utils';
	import {
		truncateMiddle,
		paletteSeedForValue,
		type ColumnFormat
	} from '$lib/services/column-format';

	interface Props {
		value: unknown;
		format: ColumnFormat;
		plainText: string;
	}

	let { value, format, plainText }: Props = $props();

	const CURRENCY_CODE_BY_SYMBOL: Record<string, string> = {
		$: 'USD',
		'€': 'EUR',
		'£': 'GBP',
		'¥': 'JPY',
		'₹': 'INR',
		'₦': 'NGN',
		'₵': 'GHS'
	};

	function parseDate(v: unknown): Date | null {
		const d = v instanceof Date ? v : new Date(String(v));
		return Number.isNaN(d.getTime()) ? null : d;
	}

	function parseEpochDate(v: unknown): Date | null {
		const n = coerceNumber(v);
		if (n === null) return parseDate(v);
		const ms = n > 1e12 ? n : n * 1000;
		const d = new Date(ms);
		return Number.isNaN(d.getTime()) ? null : d;
	}

	const dateFmt = new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric'
	});
	const datetimeFmt = new Intl.DateTimeFormat(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});

	const formattedDate = $derived.by(() => {
		if (format.kind !== 'date' && format.kind !== 'datetime') return null;
		const d = typeof value === 'number' ? parseEpochDate(value) : parseDate(value);
		if (!d) return null;
		return format.kind === 'datetime' ? datetimeFmt.format(d) : dateFmt.format(d);
	});

	const formattedNumber = $derived.by(() => {
		const n = coerceNumber(value);
		if (n === null) return null;
		if (format.kind === 'percentage') return `${n.toFixed(1)}%`;
		if (format.kind === 'currency') {
			const code = CURRENCY_CODE_BY_SYMBOL[format.currencySymbol ?? '$'] ?? 'USD';
			return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(n);
		}
		return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
	});
</script>

{#if format.kind === 'boolean'}
	<span aria-label={value ? 'true' : 'false'}>
		{#if value}
			<CircleCheck class="h-3.5 w-3.5 text-success" />
		{:else}
			<CircleX class="h-3.5 w-3.5 text-muted-foreground" />
		{/if}
	</span>
{:else if format.kind === 'id'}
	<span class="font-mono text-xs text-muted-foreground">{truncateMiddle(plainText)}</span>
{:else if format.kind === 'email'}
	<a
		href="mailto:{value}"
		class="truncate text-xs text-primary hover:underline"
		onclick={(e) => e.stopPropagation()}
	>
		{plainText}
	</a>
{:else if format.kind === 'url'}
	<a
		href={String(value)}
		target="_blank"
		rel="noopener noreferrer"
		class="inline-flex items-center gap-0.5 truncate text-xs text-primary hover:underline"
		onclick={(e) => e.stopPropagation()}
	>
		{plainText}
		<ExternalLink class="h-2.5 w-2.5 shrink-0 opacity-60" />
	</a>
{:else if (format.kind === 'date' || format.kind === 'datetime') && formattedDate}
	<span class="font-mono text-xs tabular-nums">{formattedDate}</span>
{:else if (format.kind === 'number' || format.kind === 'currency' || format.kind === 'percentage') && formattedNumber}
	<span class="font-mono text-xs tabular-nums">{formattedNumber}</span>
{:else if format.kind === 'category'}
	<span class="inline-flex items-center gap-1.5 text-xs">
		<span
			class="h-1.5 w-1.5 shrink-0 rounded-full"
			style="background-color: var(--tag-{paletteSeedForValue(plainText) + 1})"
		></span>
		<span class="truncate">{plainText}</span>
	</span>
{:else}
	<span class="font-mono text-xs">{plainText}</span>
{/if}
