<script lang="ts">
	import { setContext, type Snippet } from 'svelte';
	import {
		FILTER_CONTEXT_KEY,
		DRILL_CONTEXT_KEY,
		type FilterContextValue,
		type DrillContextValue
	} from './filter-context';
	import {
		getNotebookFilterValue,
		setNotebookFilterValue,
		setNotebookFilterValues
	} from '$lib/stores/notebook.svelte';

	interface Props {
		notebookId: string;
		children: Snippet;
		onDrill?: (outputName: string) => void;
	}

	const { notebookId, children, onDrill }: Props = $props();

	const filterCtx: FilterContextValue = {
		getValue: (param) => getNotebookFilterValue(notebookId, param),
		setValue: (param, value) => setNotebookFilterValue(notebookId, param, value),
		setValues: (values) => setNotebookFilterValues(notebookId, values)
	};

	const drillCtx: DrillContextValue = {
		openDetail: onDrill ? (outputName) => onDrill(outputName) : undefined
	};

	setContext(FILTER_CONTEXT_KEY, filterCtx);
	setContext(DRILL_CONTEXT_KEY, drillCtx);
</script>

{@render children()}
