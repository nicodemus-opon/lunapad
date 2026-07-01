<script lang="ts">
	import {
		Bold,
		Italic,
		Strikethrough,
		Code,
		Heading1,
		Heading2,
		Heading3,
		Link,
		List,
		ListOrdered,
		Quote,
		Minus,
		Eye,
		SquareCode,
		LayoutGrid,
		Columns2,
		ChartBar,
		Table2,
		PanelTopClose,
		AlertCircle,
		Layers,
		Workflow
	} from '@lucide/svelte';
	import RefPickerMenu from './RefPickerMenu.svelte';
	import FilterPickerMenu from './FilterPickerMenu.svelte';
	import { WIDGET_SNIPPETS } from '$lib/services/markdown-format';

	export type FormatAction =
		| { type: 'wrap'; prefix: string; suffix: string; placeholder?: string }
		| { type: 'line-prefix'; prefix: string }
		| { type: 'snippet'; text: string };

	interface RefEntry {
		cellName: string;
		columns: string[];
	}

	interface Props {
		onFormat: (action: FormatAction) => void;
		refPickerEntries: RefEntry[];
		onInsertSnippet: (snippet: string) => void;
		onInsertRef: (cellName: string, column: string) => void;
		onTogglePreview: () => void;
	}

	const { onFormat, refPickerEntries, onInsertSnippet, onInsertRef, onTogglePreview }: Props =
		$props();

	function fmt(action: FormatAction) {
		return (e: MouseEvent) => {
			// Prevent the textarea from losing its selection
			e.preventDefault();
			onFormat(action);
		};
	}

	const inlineButtons = [
		{
			icon: Bold,
			title: 'Bold (⌘B)',
			action: { type: 'wrap', prefix: '**', suffix: '**', placeholder: 'bold' } as FormatAction
		},
		{
			icon: Italic,
			title: 'Italic (⌘I)',
			action: { type: 'wrap', prefix: '*', suffix: '*', placeholder: 'italic' } as FormatAction
		},
		{
			icon: Strikethrough,
			title: 'Strikethrough',
			action: {
				type: 'wrap',
				prefix: '~~',
				suffix: '~~',
				placeholder: 'strikethrough'
			} as FormatAction
		},
		{
			icon: Code,
			title: 'Inline code (⌘`)',
			action: { type: 'wrap', prefix: '`', suffix: '`', placeholder: 'code' } as FormatAction
		},
		{
			icon: Link,
			title: 'Link (⌘L)',
			action: {
				type: 'wrap',
				prefix: '[',
				suffix: '](url)',
				placeholder: 'link text'
			} as FormatAction
		}
	];

	const headingButtons = [
		{
			icon: Heading1,
			title: 'Heading 1',
			action: { type: 'line-prefix', prefix: '# ' } as FormatAction
		},
		{
			icon: Heading2,
			title: 'Heading 2',
			action: { type: 'line-prefix', prefix: '## ' } as FormatAction
		},
		{
			icon: Heading3,
			title: 'Heading 3',
			action: { type: 'line-prefix', prefix: '### ' } as FormatAction
		}
	];

	const blockButtons = [
		{
			icon: List,
			title: 'Bullet list',
			action: { type: 'line-prefix', prefix: '- ' } as FormatAction
		},
		{
			icon: ListOrdered,
			title: 'Numbered list',
			action: { type: 'line-prefix', prefix: '1. ' } as FormatAction
		},
		{
			icon: Quote,
			title: 'Blockquote',
			action: { type: 'line-prefix', prefix: '> ' } as FormatAction
		},
		{
			icon: Minus,
			title: 'Horizontal rule',
			action: { type: 'snippet', text: '\n---\n' } as FormatAction
		},
		{
			icon: SquareCode,
			title: 'Code block',
			action: { type: 'snippet', text: '```sql\n\n```' } as FormatAction
		}
	];

	const widgetButtons = [
		{ icon: AlertCircle, title: 'Callout', snippet: WIDGET_SNIPPETS.callout },
		{ icon: PanelTopClose, title: 'Card', snippet: WIDGET_SNIPPETS.card },
		{ icon: Table2, title: 'Data table', snippet: WIDGET_SNIPPETS.datatable },
		{ icon: ChartBar, title: 'Chart', snippet: WIDGET_SNIPPETS.chart },
		{ icon: LayoutGrid, title: 'Metric', snippet: WIDGET_SNIPPETS.metric },
		{ icon: Columns2, title: 'Columns', snippet: WIDGET_SNIPPETS.columns },
		{ icon: Layers, title: 'Tabs', snippet: WIDGET_SNIPPETS.tabs },
		{ icon: Workflow, title: 'Mermaid diagram', snippet: WIDGET_SNIPPETS.mermaid }
	];
</script>

<div class="md-toolbar" role="toolbar" aria-label="Markdown formatting">
	<!-- Inline formatting -->
	<div class="md-toolbar-group">
		{#each inlineButtons as btn}
			<button
				type="button"
				class="md-toolbar-btn"
				title={btn.title}
				aria-label={btn.title}
				onmousedown={fmt(btn.action)}
			>
				<btn.icon size={13} />
			</button>
		{/each}
	</div>

	<div class="md-toolbar-sep"></div>

	<!-- Headings -->
	<div class="md-toolbar-group">
		{#each headingButtons as btn}
			<button
				type="button"
				class="md-toolbar-btn"
				title={btn.title}
				aria-label={btn.title}
				onmousedown={fmt(btn.action)}
			>
				<btn.icon size={13} />
			</button>
		{/each}
	</div>

	<div class="md-toolbar-sep"></div>

	<!-- Block structure -->
	<div class="md-toolbar-group">
		{#each blockButtons as btn}
			<button
				type="button"
				class="md-toolbar-btn"
				title={btn.title}
				aria-label={btn.title}
				onmousedown={fmt(btn.action)}
			>
				<btn.icon size={13} />
			</button>
		{/each}
	</div>

	<div class="md-toolbar-sep"></div>

	<!-- Markdoc widgets -->
	<div class="md-toolbar-group">
		{#each widgetButtons as btn}
			<button
				type="button"
				class="md-toolbar-btn"
				title={btn.title}
				aria-label={btn.title}
				onmousedown={(e) => {
					e.preventDefault();
					onInsertSnippet(btn.snippet);
				}}
			>
				<btn.icon size={13} />
			</button>
		{/each}
	</div>

	<div class="md-toolbar-sep"></div>

	<!-- Pickers -->
	<div class="md-toolbar-group">
		<FilterPickerMenu entries={refPickerEntries} onInsert={onInsertSnippet} />
		<RefPickerMenu entries={refPickerEntries} onSelect={onInsertRef} />
	</div>

	<!-- Preview button pushed to right -->
	<div class="md-toolbar-spacer"></div>
	<button
		type="button"
		class="md-toolbar-btn md-toolbar-preview-btn"
		title="Preview (⌘⇧P)"
		aria-label="Preview"
		onmousedown={(e) => {
			e.preventDefault();
			onTogglePreview();
		}}
	>
		<Eye size={13} />
		<span>Preview</span>
	</button>
</div>

<style>
	.md-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.15rem;
		padding: 0.25rem 0;
		border-bottom: 1px solid color-mix(in oklch, currentColor 10%, transparent);
		margin-bottom: 0.4rem;
	}
	.md-toolbar-group {
		display: flex;
		align-items: center;
		gap: 0.1rem;
	}
	.md-toolbar-sep {
		width: 1px;
		height: 1rem;
		background: color-mix(in oklch, currentColor 15%, transparent);
		margin: 0 0.2rem;
		flex-shrink: 0;
	}
	.md-toolbar-spacer {
		flex: 1;
	}
	:global(.md-toolbar-btn) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.35rem;
		border-radius: 0.3rem;
		font-size: 0.7rem;
		color: var(--muted-foreground);
		background: transparent;
		border: none;
		cursor: pointer;
		transition:
			color 100ms,
			background-color 100ms;
		line-height: 1;
	}
	:global(.md-toolbar-btn:hover) {
		color: var(--foreground);
		background: color-mix(in oklch, currentColor 8%, transparent);
	}
	:global(.md-toolbar-btn:active) {
		color: var(--primary);
		background: color-mix(in oklch, var(--primary) 10%, transparent);
	}
	.md-toolbar-preview-btn {
		font-size: 0.7rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid color-mix(in oklch, currentColor 12%, transparent);
		background: color-mix(in oklch, currentColor 4%, transparent) !important;
	}
	.md-toolbar-preview-btn:hover {
		color: var(--foreground) !important;
		border-color: color-mix(in oklch, currentColor 20%, transparent);
	}
</style>
