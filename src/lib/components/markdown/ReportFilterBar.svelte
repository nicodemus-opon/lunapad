<script lang="ts">
	import FilterWidget from './FilterWidget.svelte';
	import type { ReportFilterDef } from '$lib/services/report-filters';
	import { activeFilterChips } from '$lib/services/report-filters';
	import { getContext, setContext } from 'svelte';
	import {
		FILTER_CONTEXT_KEY,
		SUPPRESS_INLINE_FILTERS_KEY,
		type FilterContextValue
	} from './filter-context';
	import { SlidersHorizontal, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		filters: ReportFilterDef[];
		notebookId?: string;
		presets?: { id: string; name: string }[];
		onApplyPreset?: (presetId: string) => void;
	}

	const { filters, notebookId = '', presets = [], onApplyPreset }: Props = $props();

	let collapsed = $state(false);

	// The report shells set SUPPRESS_INLINE_FILTERS so the same {% filter %} tags don't
	// also render inside the prose. The controls that live in *this* bar must ignore that
	// suppression, otherwise every FilterWidget below renders nothing (and Hide/Show has
	// nothing to toggle). Re-enable rendering for our own subtree.
	setContext(SUPPRESS_INLINE_FILTERS_KEY, false);

	const filterCtx = getContext<FilterContextValue | undefined>(FILTER_CONTEXT_KEY);
	const values = $derived.by(() => {
		if (!filterCtx) return {};
		const out: Record<string, string> = {};
		for (const f of filters) {
			out[f.param] = filterCtx.getValue(f.param);
		}
		return out;
	});

	const labelByParam = $derived(new Map(filters.map((f) => [f.param, f.label ?? f.param])));
	const chips = $derived(activeFilterChips(values, labelByParam));

	function clearChip(param: string) {
		filterCtx?.setValue(param, '');
	}

	function clearAll() {
		if (!filterCtx) return;
		const cleared: Record<string, string> = {};
		for (const chip of chips) cleared[chip.param] = '';
		if (filterCtx.setValues) filterCtx.setValues(cleared);
		else for (const param of Object.keys(cleared)) filterCtx.setValue(param, '');
	}
</script>

{#if filters.length > 0}
	<div class="report-filter-bar" class:collapsed>
		<span class="report-filter-bar-title">
			<SlidersHorizontal class="h-3.5 w-3.5" />
			<span class="title-text">Filters</span>
			{#if chips.length > 0}
				<span class="report-filter-count">{chips.length}</span>
			{/if}
		</span>

		{#if !collapsed}
			<div class="report-filter-bar-controls">
				{#each filters as def (def.param)}
					<FilterWidget {notebookId} {...def} />
				{/each}
			</div>
		{/if}

		<div class="report-filter-bar-actions">
			{#each presets as preset (preset.id)}
				<Button
					variant="outline"
					size="xs"
					class="preset-chip"
					onclick={() => onApplyPreset?.(preset.id)}
				>
					{preset.name}
				</Button>
			{/each}
			{#if chips.length > 0}
				<Button variant="ghost" size="xs" class="ghost-btn clear-all" onclick={clearAll}
					>Clear</Button
				>
			{/if}
			<Button
				variant="ghost"
				size="xs"
				class="ghost-btn collapse-btn"
				onclick={() => (collapsed = !collapsed)}
				aria-expanded={!collapsed}
			>
				{collapsed ? 'Show' : 'Hide'}
			</Button>
		</div>

		{#if chips.length > 0}
			<div class="active-chips">
				{#each chips as chip (chip.param)}
					<Badge variant="primary" class="active-chip">
						<span class="active-chip-label">{chip.label}</span>
						<span class="active-chip-value">{chip.value}</span>
						<Button
							variant="ghost"
							size="icon-xs"
							class="active-chip-clear"
							aria-label="Clear {chip.label}"
							onclick={() => clearChip(chip.param)}
						>
							<X class="h-3 w-3" />
						</Button>
					</Badge>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.report-filter-bar {
		position: sticky;
		top: 0.5rem;
		z-index: var(--z-sticky);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.6rem;
		background: color-mix(in oklab, var(--card) 88%, transparent);
		backdrop-filter: blur(10px);
		-webkit-backdrop-filter: blur(10px);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow-sm);
		padding: 0.3rem 0.4rem 0.3rem 0.6rem;
		margin-bottom: 1rem;
	}
	.report-filter-bar-title {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		flex: 0 0 auto;
		font-size: var(--text-2xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--muted-foreground);
	}
	.report-filter-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1rem;
		height: 1rem;
		padding: 0 0.28rem;
		border-radius: var(--radius-sm);
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0;
		background: color-mix(in oklab, var(--primary) 15%, transparent);
		color: var(--primary);
	}
	.report-filter-bar-controls {
		display: flex;
		flex: 1 1 auto;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.6rem;
		min-width: 0;
	}
	.report-filter-bar-actions {
		display: flex;
		flex: 0 0 auto;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.15rem;
		margin-left: auto;
	}
	:global(.ghost-btn),
	:global(.preset-chip) {
		font-size: var(--text-2xs);
	}
	:global(.clear-all:hover) {
		color: var(--destructive);
	}
	.active-chips {
		display: flex;
		flex-basis: 100%;
		flex-wrap: wrap;
		gap: 0.3rem;
		padding: 0.1rem 0.2rem 0.15rem;
	}
	:global(.active-chip) {
		gap: 0.3rem;
		padding-right: 0.1rem;
	}
	.active-chip-label {
		font-weight: 600;
		color: var(--muted-foreground);
	}
	.active-chip-value {
		font-weight: 500;
	}
	:global(.active-chip-clear) {
		color: inherit;
	}

	@media print {
		.report-filter-bar {
			position: static;
			box-shadow: none;
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
		}
	}
</style>
