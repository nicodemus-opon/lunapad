<script lang="ts">
	import FilterWidget from './FilterWidget.svelte';
	import type { ReportFilterDef } from '$lib/services/report-filters';
	import { activeFilterChips } from '$lib/services/report-filters';
	import { getContext } from 'svelte';
	import { FILTER_CONTEXT_KEY, type FilterContextValue } from './filter-context';
	import { X } from '@lucide/svelte';

	interface Props {
		filters: ReportFilterDef[];
		notebookId?: string;
		presets?: { id: string; name: string }[];
		onApplyPreset?: (presetId: string) => void;
	}

	const { filters, notebookId = '', presets = [], onApplyPreset }: Props = $props();

	let collapsed = $state(false);

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
</script>

{#if filters.length > 0}
	<div class="report-filter-bar" class:collapsed>
		<div class="report-filter-bar-header">
			<span class="report-filter-bar-title">Filters</span>
			<div class="report-filter-bar-actions">
				{#each presets as preset (preset.id)}
					<button type="button" class="preset-chip" onclick={() => onApplyPreset?.(preset.id)}>
						{preset.name}
					</button>
				{/each}
				<button
					type="button"
					class="collapse-btn"
					onclick={() => (collapsed = !collapsed)}
					aria-expanded={!collapsed}
				>
					{collapsed ? 'Show' : 'Hide'}
				</button>
			</div>
		</div>
		{#if !collapsed}
			<div class="report-filter-bar-controls">
				{#each filters as def (def.param)}
					<FilterWidget {notebookId} {...def} />
				{/each}
			</div>
		{/if}
		{#if chips.length > 0}
			<div class="active-chips">
				{#each chips as chip (chip.param)}
					<span class="active-chip">
						{chip.label}: {chip.value}
						<button
							type="button"
							aria-label="Clear {chip.label}"
							onclick={() => clearChip(chip.param)}
						>
							<X class="h-3 w-3" />
						</button>
					</span>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.report-filter-bar {
		position: sticky;
		top: 0;
		z-index: 20;
		background: color-mix(in oklch, var(--background, white) 92%, transparent);
		backdrop-filter: blur(8px);
		border: 1px solid color-mix(in oklch, currentColor 12%, transparent);
		border-radius: 0.5rem;
		padding: 0.5rem 0.65rem;
		margin-bottom: 0.75rem;
	}
	.report-filter-bar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.35rem;
	}
	.report-filter-bar-title {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.65;
	}
	.report-filter-bar-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.report-filter-bar-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
	}
	.collapse-btn,
	.preset-chip {
		font-size: 0.72rem;
		padding: 0.15rem 0.45rem;
		border-radius: 0.3rem;
		border: 1px solid color-mix(in oklch, currentColor 18%, transparent);
		background: transparent;
	}
	.preset-chip:hover {
		background: color-mix(in oklch, var(--chart-1, #3b82f6) 12%, transparent);
	}
	.active-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-top: 0.4rem;
	}
	.active-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.72rem;
		padding: 0.1rem 0.35rem;
		border-radius: 999px;
		background: color-mix(in oklch, var(--chart-1, #3b82f6) 15%, transparent);
	}
	.active-chip button {
		display: inline-flex;
		opacity: 0.7;
	}
</style>
