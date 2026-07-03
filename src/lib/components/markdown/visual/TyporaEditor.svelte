<script lang="ts">
	import NotionEditor from './NotionEditor.svelte';
	import MarkdocPreviewProvider from '$lib/components/markdown/MarkdocPreviewProvider.svelte';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
	import type { Cell } from '$lib/stores/notebook.svelte';

	interface Props {
		value: string;
		onchange: (v: string) => void;
		cells: Cell[];
		notebookId?: string;
		refEntries?: MarkdownRefEntry[];
	}

	const props: Props = $props();
</script>

<MarkdocPreviewProvider notebookId={props.notebookId ?? ''}>
	<NotionEditor {...props} />
</MarkdocPreviewProvider>
