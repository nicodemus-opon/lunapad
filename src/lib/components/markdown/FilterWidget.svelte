<script lang="ts">
	import { getContext } from 'svelte';
	import {
		getNotebookFilterValue,
		setNotebookFilterValue,
		setNotebookFilterValues
	} from '$lib/stores/notebook.svelte';
	import {
		FILTER_CONTEXT_KEY,
		SUPPRESS_INLINE_FILTERS_KEY,
		type FilterContextValue
	} from './filter-context';
	import {
		RELATIVE_DATE_PRESETS,
		formatRelativeDateFilterValue,
		type RelativeDatePreset
	} from '$lib/services/filter-relatives';
	import type { FilterWidgetKind } from '$lib/services/report-filters';

	interface Props {
		notebookId?: string;
		kind?: FilterWidgetKind;
		param?: string;
		label?: string;
		options?: unknown[];
		optionsColumn?: string;
		defaultValue?: string;
		startParam?: string;
		endParam?: string;
		minParam?: string;
		maxParam?: string;
	}

	const {
		notebookId = '',
		kind = 'dropdown',
		param = '',
		label,
		options,
		optionsColumn,
		defaultValue,
		startParam,
		endParam,
		minParam,
		maxParam
	}: Props = $props();

	const suppressInline = getContext<boolean | undefined>(SUPPRESS_INLINE_FILTERS_KEY) ?? false;

	const filterCtx = getContext<FilterContextValue | undefined>(FILTER_CONTEXT_KEY);
	const ctx: FilterContextValue = filterCtx ?? {
		getValue: (p) => getNotebookFilterValue(notebookId, p),
		setValue: (p, v) => setNotebookFilterValue(notebookId, p, v),
		setValues: (vals) => setNotebookFilterValues(notebookId, vals)
	};

	const effectiveOptions = $derived.by((): string[] => {
		if (!Array.isArray(options)) return [];
		return options
			.map((opt) => {
				if (typeof opt === 'string' || typeof opt === 'number') return String(opt);
				if (optionsColumn && opt && typeof opt === 'object')
					return String((opt as Record<string, unknown>)[optionsColumn] ?? '');
				return null;
			})
			.filter((v): v is string => v !== null && v !== '');
	});

	const value = $derived(param ? ctx.getValue(param) || defaultValue || '' : defaultValue || '');

	let searchQuery = $state('');

	const filteredSearchOptions = $derived.by(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return effectiveOptions;
		return effectiveOptions.filter((o) => o.toLowerCase().includes(q));
	});

	function onChange(v: string) {
		if (param) ctx.setValue(param, v);
	}

	function applyValues(vals: Record<string, string>) {
		if (ctx.setValues) ctx.setValues(vals);
		else for (const [k, v] of Object.entries(vals)) ctx.setValue(k, v);
	}

	function onRelativeDate(preset: RelativeDatePreset) {
		const vals = formatRelativeDateFilterValue(preset, startParam, endParam);
		if (startParam && endParam) applyValues(vals);
		else if (param) onChange(vals.range ?? '');
	}

	function toggleMulti(opt: string) {
		const current = value
			? value
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			: [];
		const next = current.includes(opt) ? current.filter((x) => x !== opt) : [...current, opt];
		onChange(next.join(','));
	}

	function onNumericRange(min: string, max: string) {
		if (minParam && maxParam) applyValues({ [minParam]: min, [maxParam]: max });
		else onChange(`${min},${max}`);
	}

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	function handleTextInput(v: string) {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => onChange(v), 300);
	}

	const multiSelected = $derived(
		new Set(
			value
				? value
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				: []
		)
	);

	const numericParts = $derived.by(() => {
		const [min, max] = value ? value.split(',') : ['', ''];
		return { min: min ?? '', max: max ?? '' };
	});
</script>

{#if !suppressInline}
	<span class="md-filter">
		{#if label}<span class="md-filter-label">{label}</span>{/if}

		{#if kind === 'dropdown' || kind === 'searchable-dropdown'}
			{#if kind === 'searchable-dropdown'}
				<input
					type="search"
					class="md-filter-control md-filter-search"
					placeholder="Search…"
					bind:value={searchQuery}
				/>
			{/if}
			<select
				class="md-filter-control"
				aria-label={label}
				{value}
				onchange={(e) => onChange((e.target as HTMLSelectElement).value)}
			>
				{#if !defaultValue}<option value="">All</option>{/if}
				{#each kind === 'searchable-dropdown' ? filteredSearchOptions : effectiveOptions as opt (opt)}
					<option value={opt}>{opt}</option>
				{/each}
			</select>
		{:else if kind === 'text-input'}
			<input
				type="text"
				class="md-filter-control"
				{value}
				oninput={(e) => handleTextInput((e.target as HTMLInputElement).value)}
				placeholder={defaultValue ?? `Filter ${label ?? param}…`}
			/>
		{:else if kind === 'date-range'}
			{@const [startVal, endVal] = value ? value.split(',') : ['', '']}
			<span class="md-filter-daterange">
				<input
					type="date"
					class="md-filter-control"
					value={startVal ?? ''}
					onchange={(e) => onChange(`${(e.target as HTMLInputElement).value},${endVal ?? ''}`)}
				/>
				<span>–</span>
				<input
					type="date"
					class="md-filter-control"
					value={endVal ?? ''}
					onchange={(e) => onChange(`${startVal ?? ''},${(e.target as HTMLInputElement).value}`)}
				/>
			</span>
		{:else if kind === 'button-group'}
			<span class="md-filter-buttons">
				{#each effectiveOptions as opt (opt)}
					<button
						type="button"
						class="md-filter-btn"
						class:active={value === opt}
						onclick={() => onChange(opt)}>{opt}</button
					>
				{/each}
			</span>
		{:else if kind === 'multi-select'}
			<span class="md-filter-multiselect">
				{#each effectiveOptions as opt (opt)}
					<button
						type="button"
						class="md-filter-btn"
						class:active={multiSelected.has(opt)}
						onclick={() => toggleMulti(opt)}>{opt}</button
					>
				{/each}
			</span>
		{:else if kind === 'relative-date'}
			<select
				class="md-filter-control"
				aria-label={label ?? 'Date range'}
				onchange={(e) =>
					onRelativeDate((e.target as HTMLSelectElement).value as RelativeDatePreset)}
			>
				<option value="">Select range…</option>
				{#each RELATIVE_DATE_PRESETS as p (p.id)}
					<option value={p.id}>{p.label}</option>
				{/each}
			</select>
		{:else if kind === 'numeric-range'}
			<span class="md-filter-daterange">
				<input
					type="number"
					class="md-filter-control md-filter-num"
					placeholder="Min"
					value={numericParts.min}
					onchange={(e) => onNumericRange((e.target as HTMLInputElement).value, numericParts.max)}
				/>
				<span>–</span>
				<input
					type="number"
					class="md-filter-control md-filter-num"
					placeholder="Max"
					value={numericParts.max}
					onchange={(e) => onNumericRange(numericParts.min, (e.target as HTMLInputElement).value)}
				/>
			</span>
		{/if}
	</span>
{/if}

<style>
	.md-filter {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0.2rem 0.3rem 0.2rem 0;
		vertical-align: middle;
	}
	.md-filter-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--muted-foreground);
	}
	.md-filter-control {
		height: 1.75rem;
		border-radius: var(--radius-md, 0.35rem);
		border: 1px solid color-mix(in oklab, var(--border) 90%, transparent);
		background: color-mix(in oklab, var(--background) 92%, transparent);
		color: var(--foreground);
		padding: 0 0.5rem;
		font-size: 0.78rem;
		transition:
			border-color 0.12s ease,
			box-shadow 0.12s ease,
			background 0.12s ease;
	}
	.md-filter-control:hover {
		border-color: color-mix(in oklab, var(--foreground) 30%, transparent);
	}
	.md-filter-control:focus-visible {
		outline: none;
		border-color: var(--primary);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary) 25%, transparent);
	}
	.md-filter-search {
		width: 6rem;
	}
	.md-filter-num {
		width: 4.5rem;
	}
	.md-filter-daterange {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
		color: var(--muted-foreground);
	}
	.md-filter-buttons,
	.md-filter-multiselect {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.md-filter-btn {
		height: 1.75rem;
		padding: 0 0.6rem;
		border-radius: var(--radius-md, 0.3rem);
		border: 1px solid color-mix(in oklab, var(--border) 90%, transparent);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--foreground);
		background: color-mix(in oklab, var(--background) 92%, transparent);
		cursor: pointer;
		transition:
			border-color 0.12s ease,
			background 0.12s ease,
			color 0.12s ease;
	}
	.md-filter-btn:hover {
		border-color: color-mix(in oklab, var(--primary) 40%, transparent);
		background: color-mix(in oklab, var(--primary) 8%, transparent);
	}
	.md-filter-btn:focus-visible {
		outline: none;
		border-color: var(--primary);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary) 25%, transparent);
	}
	.md-filter-btn.active {
		background: var(--primary);
		color: var(--primary-foreground);
		border-color: transparent;
	}
	.md-filter-btn.active:hover {
		background: color-mix(in oklab, var(--primary) 90%, black 10%);
	}
</style>
