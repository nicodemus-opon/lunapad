<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { browser } from '$app/environment';
	import type { NodeSelection as PMNodeSelection } from '@tiptap/pm/state';
	import VisualBlockInspector from './VisualBlockInspector.svelte';
	import {
		markdownToPmDocument,
		pmDocumentToMarkdown,
		type PMDocJSON
	} from '$lib/services/markdoc-pm';
	import {
		parseVisualBlocks,
		updateBlockWidgetSource,
		type VisualBlock
	} from '$lib/services/markdoc-ast';
	import { SLASH_COMMANDS } from '$lib/services/markdown-format';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { findFilterUsages } from '$lib/services/markdoc-visual-analysis';

	type TipTapEditor = import('@tiptap/core').Editor;
	let NodeSelectionCtor: typeof PMNodeSelection | null = null;

	interface Props {
		value: string;
		onchange: (v: string) => void;
		cells: Cell[];
		notebookId?: string;
		refEntries?: MarkdownRefEntry[];
	}

	const { value, onchange, cells, notebookId = '', refEntries = [] }: Props = $props();

	let editorMount = $state<HTMLDivElement | null>(null);
	let editor = $state<TipTapEditor | null>(null);
	let frontmatter = '';
	let lastEmitted: string | null = null;
	let emitTimer: ReturnType<typeof setTimeout> | null = null;
	let slashOpen = $state(false);
	let selectedBlockSource = $state<string | null>(null);
	let initError = $state<string | null>(null);

	const selectedBlock = $derived.by((): VisualBlock | null => {
		if (!selectedBlockSource) return null;
		const blocks = parseVisualBlocks(selectedBlockSource);
		return blocks[0] ?? null;
	});

	const filterUsages = $derived.by(() => {
		const params = new Set<string>();
		const md = value;
		for (const match of md.matchAll(/\{%\s*filter\b[^%]*\bparam="([^"]+)"/g)) {
			if (match[1]) params.add(match[1]);
		}
		return Object.fromEntries([...params].map((param) => [param, findFilterUsages(cells, param)]));
	});

	const isEmpty = $derived.by(() => {
		if (value.trim()) return false;
		if (!editor) return true;
		return editor.isEmpty;
	});

	const dashboardTemplates = [
		{
			id: 'executive',
			label: 'Executive KPI',
			description: 'KPI grid, trend chart, and detail table',
			source: `## Executive dashboard

{% grid cols=3 %}
{% metric value=$cell.value label="Revenue" format="currency" /%}
{% metric value=$cell.value label="Orders" /%}
{% metric value=$cell.value label="Conversion" format="percent" /%}
{% /grid %}

{% chart type="line" data=$cell.rows x="date_col" y="value_col" title="Trend" /%}

{% datatable data=$cell.rows limit=25 headerInsights="compact" /%}`
		},
		{
			id: 'filtered',
			label: 'Filtered dashboard',
			description: 'Filter, KPI, chart, and linked table',
			source: `## Filtered report

{% filter kind="dropdown" param="region" label="Region" options=$cell.rows optionsColumn="region" /%}

{% metric value=$cell.value label="Selected total" format="currency" /%}

{% chart type="bar" data=$cell.rows x="region" y="value_col" filterParam="region" /%}

{% datatable data=$cell.rows linkedFilter="region" limit=20 /%}`
		},
		{
			id: 'pivot',
			label: 'Pivot table report',
			description: 'Advanced crosstab table with formatting',
			source: `## Pivot report

{% datatable data=$cell.rows index=["group_col"] pivotBy="pivot_col" valueCol="value_col" agg="sum" valueFormatKind="currency" valueCurrencySymbol="$" headerInsights="full" /%}`
		}
	];

	function syncSelection(ed: TipTapEditor) {
		if (!NodeSelectionCtor) return;
		const sel = ed.state.selection;
		if (sel instanceof NodeSelectionCtor && sel.node.type.name === 'markdocBlock') {
			selectedBlockSource = String(sel.node.attrs.source ?? '');
		} else {
			selectedBlockSource = null;
		}
	}

	function emitNow(ed: TipTapEditor) {
		const doc = ed.getJSON() as PMDocJSON;
		const serialized = pmDocumentToMarkdown({ frontmatter, doc });
		lastEmitted = serialized;
		onchange(serialized);
	}

	function scheduleEmit(ed: TipTapEditor) {
		if (emitTimer) clearTimeout(emitTimer);
		emitTimer = setTimeout(() => emitNow(ed), 120);
	}

	function loadTemplate(source: string) {
		const pm = markdownToPmDocument(source);
		frontmatter = pm.frontmatter;
		if (editor) {
			editor.commands.setContent(pm.doc, { emitUpdate: false });
			emitNow(editor);
		} else {
			lastEmitted = pmDocumentToMarkdown(pm);
			onchange(lastEmitted);
		}
	}

	function insertSnippet(snippet: string) {
		if (!editor) return;
		editor
			.chain()
			.focus()
			.insertContent({ type: 'markdocBlock', attrs: { source: snippet.trim() } })
			.run();
		slashOpen = false;
	}

	function patchSelected(patch: {
		attrs?: Record<string, unknown>;
		body?: string;
		source?: string;
	}) {
		if (!editor || !selectedBlock) return;
		let next: VisualBlock;
		if (patch.source !== undefined) {
			next = { ...selectedBlock, source: patch.source };
		} else {
			next = updateBlockWidgetSource(selectedBlock, patch);
		}
		const sel = editor.state.selection;
		if (!NodeSelectionCtor || !(sel instanceof NodeSelectionCtor)) return;
		const pos = sel.from;
		editor
			.chain()
			.focus()
			.command(({ tr }) => {
				tr.setNodeMarkup(pos, undefined, { source: next.source });
				return true;
			})
			.run();
		selectedBlockSource = next.source;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') slashOpen = false;
	}

	let booting = false;
	let destroyed = false;

	async function bootEditor() {
		if (!browser || !editorMount || destroyed || editor || booting) return;
		booting = true;
		try {
			const [{ Editor }, starterKitMod, pmState, { createMarkdocBlockExtension }] =
				await Promise.all([
					import('@tiptap/core'),
					import('@tiptap/starter-kit'),
					import('@tiptap/pm/state'),
					import('./markdoc-block-extension')
				]);

			NodeSelectionCtor = pmState.NodeSelection;
			const StarterKit = starterKitMod.default;

			if (destroyed || !editorMount) return;

			const pm = markdownToPmDocument(value);
			frontmatter = pm.frontmatter;
			lastEmitted = value;

			const ed = new Editor({
				element: editorMount,
				extensions: [
					StarterKit.configure({
						heading: { levels: [1, 2, 3, 4, 5, 6] }
					}),
					createMarkdocBlockExtension({
						getCells: () => cells,
						getNotebookId: () => notebookId
					})
				],
				content: pm.doc,
				editorProps: {
					attributes: {
						class:
							'typora-surface prose markdown-body min-h-28 px-2 py-1.5 focus:outline-none max-w-none'
					}
				},
				onUpdate: ({ editor: e }) => {
					syncSelection(e);
					scheduleEmit(e);
				},
				onSelectionUpdate: ({ editor: e }) => syncSelection(e)
			});

			editor = ed;
		} catch (e) {
			initError = e instanceof Error ? e.message : 'Failed to load visual editor';
		} finally {
			booting = false;
		}
	}

	$effect(() => {
		if (editorMount && browser && !editor) void bootEditor();
	});

	onDestroy(() => {
		destroyed = true;
		if (emitTimer) clearTimeout(emitTimer);
		editor?.destroy();
		editor = null;
	});

	$effect(() => {
		const v = value;
		void cells;
		untrack(() => {
			if (!editor || v === lastEmitted) return;
			const pm = markdownToPmDocument(v);
			frontmatter = pm.frontmatter;
			lastEmitted = v;
			editor.commands.setContent(pm.doc, { emitUpdate: false });
			syncSelection(editor);
		});
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div class="typora-dashboard flex min-h-32 gap-3">
	<div class="typora-canvas min-w-0 flex-1 space-y-2">
		{#if initError}
			<div class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
				Visual editor failed to load: {initError}
			</div>
		{/if}

		{#if isEmpty}
			<div class="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4">
				<p class="text-sm font-semibold">Start a visual dashboard</p>
				<p class="mt-1 text-xs text-muted-foreground">
					Type directly for headings and prose, or pick a template and replace
					<code>$cell</code> with a real upstream result.
				</p>
				<div class="mt-3 grid gap-2 sm:grid-cols-3">
					{#each dashboardTemplates as tpl (tpl.id)}
						<button
							type="button"
							class="rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted/40"
							onclick={() => loadTemplate(tpl.source)}
						>
							<span class="block text-xs font-semibold">{tpl.label}</span>
							<span class="mt-1 block text-2xs text-muted-foreground">{tpl.description}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<div bind:this={editorMount} class="typora-editor-host rounded-md border border-border/40"></div>

		<div class="insert-row relative pt-1">
			<button
				type="button"
				class="w-full rounded-md border border-dashed border-border/70 py-2 text-2xs text-muted-foreground transition-colors hover:border-border hover:bg-muted/30 hover:text-foreground"
				onclick={() => (slashOpen = !slashOpen)}
			>
				+ Insert widget
			</button>
			{#if slashOpen}
				<div
					class="absolute top-full left-0 z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
				>
					{#each SLASH_COMMANDS as cmd (cmd.id)}
						<button
							type="button"
							class="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-muted"
							onclick={() => insertSnippet(cmd.snippet)}
						>
							<span class="text-xs font-medium">{cmd.label}</span>
							<span class="text-2xs text-muted-foreground">{cmd.description}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<aside class="visual-inspector w-56 shrink-0 rounded-md border bg-card/50">
		<VisualBlockInspector
			block={selectedBlock}
			{refEntries}
			{filterUsages}
			onPatch={patchSelected}
		/>
	</aside>
</div>

<style>
	.typora-dashboard {
		position: relative;
	}
	:global(.typora-surface) {
		font-size: var(--text-sm);
		line-height: 1.6;
	}
	:global(.typora-surface h1) {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0.75rem 0 0.35rem;
	}
	:global(.typora-surface h2) {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 0.65rem 0 0.3rem;
	}
	:global(.typora-surface h3) {
		font-size: 1.1rem;
		font-weight: 600;
		margin: 0.5rem 0 0.25rem;
	}
	:global(.typora-surface p) {
		margin: 0.35rem 0;
	}
	:global(.typora-surface ul),
	:global(.typora-surface ol) {
		margin: 0.35rem 0;
		padding-left: 1.25rem;
	}
	:global(.ProseMirror-selectednode .markdoc-block-view) {
		border-color: color-mix(in oklab, var(--ring) 70%, transparent);
	}
	@media (max-width: 720px) {
		.typora-dashboard {
			flex-direction: column;
		}
		.visual-inspector {
			width: 100%;
		}
	}
</style>
