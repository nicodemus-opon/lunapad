<script lang="ts">
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { getNotebooks } from '$lib/stores/notebook.svelte';
	import { renderMarkdocCell } from '$lib/services/markdoc-interp';
	import MarkdocRenderer from '../MarkdocRenderer.svelte';

	interface Props {
		/** Full tag source, e.g. `{% each data=$cell.rows %}…{% /each %}`. */
		source: string;
		tagName: string;
		notebookId?: string;
		cells?: Cell[];
	}

	const { source, tagName, notebookId = '', cells = [] }: Props = $props();

	// Track the live notebook cells so the preview follows query re-runs,
	// mirroring MarkdocExpressionChip's live-resolution approach.
	const liveCells = $derived.by(() => {
		if (!notebookId) return cells;
		return getNotebooks().find((notebook) => notebook.id === notebookId)?.cells ?? cells;
	});

	const rendered = $derived(renderMarkdocCell(source, liveCells));
</script>

<div class="loop-preview" data-tag={tagName} contenteditable="false">
	<MarkdocRenderer
		content={rendered.tree}
		errors={rendered.errors}
		{notebookId}
		headingSlugPrefix=""
	/>
</div>
