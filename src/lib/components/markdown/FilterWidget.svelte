<script lang="ts">
	import { getContext } from 'svelte';
	import { getNotebookFilterValue, setNotebookFilterValue } from '$lib/stores/notebook.svelte';
	import { FILTER_CONTEXT_KEY, type FilterContextValue } from './filter-context';

	interface Props {
		notebookId?: string;
		kind?: 'dropdown' | 'text-input' | 'date-range' | 'button-group';
		param?: string;
		label?: string;
		options?: unknown[];
		optionsColumn?: string;
		defaultValue?: string;
	}

	const {
		notebookId = '',
		kind = 'dropdown',
		param = '',
		label,
		options,
		optionsColumn,
		defaultValue
	}: Props = $props();

	// Falls back to the global notebook store when no context is provided (the main app
	// never sets this context, so existing in-app behavior is unchanged). A public report
	// page sets its own per-viewer-scoped context instead, so a stranger's filter choice
	// never touches the owner's actual notebook.
	const filterCtx = getContext<FilterContextValue | undefined>(FILTER_CONTEXT_KEY);
	const ctx: FilterContextValue = filterCtx ?? {
		getValue: (p) => getNotebookFilterValue(notebookId, p),
		setValue: (p, v) => setNotebookFilterValue(notebookId, p, v)
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

	function onChange(v: string) {
		if (param) ctx.setValue(param, v);
	}

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	function handleTextInput(v: string) {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => onChange(v), 300);
	}
</script>

<span class="md-filter">
	{#if label}<span class="md-filter-label">{label}</span>{/if}

	{#if kind === 'dropdown'}
		<select
			class="md-filter-control"
			aria-label={label}
			{value}
			onchange={(e) => onChange((e.target as HTMLSelectElement).value)}
		>
			{#if !defaultValue}<option value="">All</option>{/if}
			{#each effectiveOptions as opt (opt)}<option value={opt}>{opt}</option>{/each}
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
	{/if}
</span>

<style>
	.md-filter {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0.2rem 0.3rem 0.2rem 0;
		vertical-align: middle;
	}
	.md-filter-label {
		font-size: 0.75rem;
		font-weight: 600;
		opacity: 0.7;
	}
	.md-filter-control {
		height: 1.6rem;
		border-radius: 0.35rem;
		border: 1px solid color-mix(in oklch, currentColor 20%, transparent);
		background: color-mix(in oklch, currentColor 3%, transparent);
		padding: 0 0.4rem;
		font-size: 0.78rem;
	}
	.md-filter-daterange {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.75rem;
	}
	.md-filter-buttons {
		display: inline-flex;
		gap: 0.25rem;
	}
	.md-filter-btn {
		height: 1.5rem;
		padding: 0 0.5rem;
		border-radius: 0.3rem;
		border: 1px solid color-mix(in oklch, currentColor 20%, transparent);
		font-size: 0.75rem;
		background: transparent;
	}
	.md-filter-btn.active {
		background: color-mix(in oklch, var(--chart-1, #3b82f6) 80%, transparent);
		color: white;
		border-color: transparent;
	}
</style>
