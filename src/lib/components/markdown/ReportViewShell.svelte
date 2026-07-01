<script lang="ts">
	import { setContext, type Snippet } from 'svelte';
	import { replaceState } from '$app/navigation';
	import ReportFilterBar from './ReportFilterBar.svelte';
	import { extractReportFilters } from '$lib/services/report-filters';
	import {
		FILTER_CONTEXT_KEY,
		SUPPRESS_INLINE_FILTERS_KEY,
		DRILL_CONTEXT_KEY,
		type FilterContextValue,
		type DrillContextValue
	} from './filter-context';
	import {
		getNotebookFilterValue,
		setNotebookFilterValue,
		setNotebookFilterValues,
		applyNotebookFilterPreset,
		getNotebookFilterPresets
	} from '$lib/stores/notebook.svelte';

	interface Props {
		notebookId: string;
		markdowns: string[];
		onDrill: (outputName: string) => void;
		children: Snippet;
	}

	const { notebookId, markdowns, onDrill, children }: Props = $props();

	const filterDefs = $derived(extractReportFilters(markdowns));
	const presets = $derived(getNotebookFilterPresets(notebookId));

	function syncFiltersToURL(): void {
		if (typeof window === 'undefined') return;
		const params = new URLSearchParams();
		for (const def of filterDefs) {
			const v = getNotebookFilterValue(notebookId, def.param);
			if (v) params.set(def.param, v);
		}
		const query = params.toString();
		replaceState(query ? `?${query}` : window.location.pathname, {});
	}

	const filterCtx: FilterContextValue = {
		getValue: (param) => getNotebookFilterValue(notebookId, param),
		setValue: (param, value) => {
			setNotebookFilterValue(notebookId, param, value);
			syncFiltersToURL();
		},
		setValues: (values) => {
			setNotebookFilterValues(notebookId, values);
			syncFiltersToURL();
		}
	};

	const drillCtx: DrillContextValue = {
		openDetail: (outputName) => onDrill(outputName)
	};

	setContext(FILTER_CONTEXT_KEY, filterCtx);
	setContext(SUPPRESS_INLINE_FILTERS_KEY, true);
	setContext(DRILL_CONTEXT_KEY, drillCtx);
</script>

{#if filterDefs.length > 0}
	<ReportFilterBar
		filters={filterDefs}
		{notebookId}
		presets={presets.map((p) => ({ id: p.id, name: p.name }))}
		onApplyPreset={(id) => {
			applyNotebookFilterPreset(notebookId, id);
			syncFiltersToURL();
		}}
	/>
{/if}
{@render children()}
