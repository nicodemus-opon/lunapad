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
		getValue: (param) => {
			const currentNotebookId = notebookId;
			return getNotebookFilterValue(currentNotebookId, param);
		},
		setValue: (param, value) => {
			const currentNotebookId = notebookId;
			setNotebookFilterValue(currentNotebookId, param, value);
		},
		setValues: (values) => {
			const currentNotebookId = notebookId;
			setNotebookFilterValues(currentNotebookId, values);
		}
	};

	const drillCtx: DrillContextValue = {
		openDetail: (outputName) => onDrill?.(outputName)
	};

	setContext(FILTER_CONTEXT_KEY, filterCtx);
	setContext(DRILL_CONTEXT_KEY, drillCtx);
</script>

{@render children()}
