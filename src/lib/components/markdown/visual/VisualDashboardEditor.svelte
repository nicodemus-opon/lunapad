<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import MarkdocRenderer from '$lib/components/markdown/MarkdocRenderer.svelte';
	import VisualBlockChrome from './VisualBlockChrome.svelte';
	import VisualBlockInspector from './VisualBlockInspector.svelte';
	import {
		parseVisualBlocks,
		serializeVisualBlocks,
		splitFrontmatter,
		insertVisualBlock,
		removeVisualBlock,
		moveVisualBlock,
		updateBlockWidgetSource,
		type VisualBlock
	} from '$lib/services/markdoc-ast';
	import { renderMarkdocCell } from '$lib/services/markdoc-interp';
	import { SLASH_COMMANDS } from '$lib/services/markdown-format';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { findFilterUsages } from '$lib/services/markdoc-visual-analysis';

	interface Props {
		value: string;
		onchange: (v: string) => void;
		cells: Cell[];
		notebookId?: string;
		refEntries?: MarkdownRefEntry[];
	}

	const { value, onchange, cells, notebookId = '', refEntries = [] }: Props = $props();

	let blocks = $state<VisualBlock[]>([]);
	let selectedId = $state<string | null>(null);
	// Leading YAML frontmatter is not a block; keep it verbatim so editing the
	// blocks below it never silently discards the cell's frontmatter.
	let frontmatter = '';
	// The exact markdown string this component last emitted. When the incoming `value`
	// matches it, the change originated here — so we keep the current in-memory blocks
	// (and their IDs / the active selection / inspector focus) instead of re-parsing.
	let lastEmitted: string | null = null;
	let slashOpen = $state(false);
	let slashIndex = $state(0);

	const selectedBlock = $derived(blocks.find((b) => b.id === selectedId) ?? null);
	const filterUsages = $derived.by(() => {
		const params = new Set<string>();
		for (const block of blocks) {
			const match = block.source.match(/\{%\s*filter\b[^%]*\bparam="([^"]+)"/);
			if (match?.[1]) params.add(match[1]);
		}
		return Object.fromEntries([...params].map((param) => [param, findFilterUsages(cells, param)]));
	});

	// Re-parse only when the incoming markdown differs from what we last emitted (i.e. it
	// came from an external source such as Source mode or the AI). Self-originated edits
	// keep the in-memory blocks so IDs, selection, and inspector focus survive editing.
	// Selection is read/written inside `untrack` so selecting a block never re-triggers
	// this effect.
	$effect(() => {
		const v = value;
		untrack(() => {
			if (v === lastEmitted) return;
			lastEmitted = v;
			const split = splitFrontmatter(v);
			frontmatter = split.frontmatter;
			blocks = parseVisualBlocks(split.body);
			if (selectedId && !blocks.some((b) => b.id === selectedId)) selectedId = null;
		});
	});

	function emit(nextBlocks: VisualBlock[]) {
		blocks = nextBlocks;
		const body = serializeVisualBlocks(nextBlocks);
		const serialized = frontmatter ? `${frontmatter}\n\n${body}` : body;
		lastEmitted = serialized;
		onchange(serialized);
	}

	function patchSelected(patch: {
		attrs?: Record<string, unknown>;
		body?: string;
		source?: string;
	}) {
		if (!selectedBlock) return;
		let next: VisualBlock;
		if (patch.source !== undefined) {
			next = { ...selectedBlock, source: patch.source };
		} else {
			next = updateBlockWidgetSource(selectedBlock, patch);
		}
		emit(blocks.map((b) => (b.id === next.id ? next : b)));
	}

	function insertSnippet(snippet: string, at = blocks.length) {
		emit(insertVisualBlock(blocks, at, snippet));
		slashOpen = false;
	}

	function insertAfter(index: number) {
		slashOpen = true;
		slashIndex = index + 1;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') slashOpen = false;
	}

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

	onMount(() => {
		if (!blocks.length && !value.trim()) {
			blocks = [];
		}
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div class="visual-dashboard flex min-h-32 gap-3">
	<div class="visual-canvas min-w-0 flex-1 space-y-2">
		{#if blocks.length === 0}
			<div class="rounded-lg border border-dashed border-border/70 bg-muted/20 p-4">
				<p class="text-sm font-semibold">Start a visual dashboard</p>
				<p class="mt-1 text-xs text-muted-foreground">
					Pick a structure, then replace <code>$cell</code> with a real upstream result.
				</p>
				<div class="mt-3 grid gap-2 sm:grid-cols-3">
					{#each dashboardTemplates as tpl (tpl.id)}
						<button
							type="button"
							class="rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted/40"
							onclick={() => emit(parseVisualBlocks(tpl.source))}
						>
							<span class="block text-xs font-semibold">{tpl.label}</span>
							<span class="mt-1 block text-2xs text-muted-foreground">{tpl.description}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}
		{#each blocks as block, i (block.id)}
			<VisualBlockChrome
				{block}
				selected={selectedId === block.id}
				onselect={() => (selectedId = block.id)}
				ondelete={() => {
					emit(removeVisualBlock(blocks, block.id));
					if (selectedId === block.id) selectedId = null;
				}}
				onmoveup={() => {
					if (i > 0) emit(moveVisualBlock(blocks, block.id, i - 1));
				}}
				onmovedown={() => {
					if (i < blocks.length - 1) emit(moveVisualBlock(blocks, block.id, i + 1));
				}}
				oninsertbelow={() => insertAfter(i)}
			>
				{@const rendered = renderMarkdocCell(block.source, cells)}
				<MarkdocRenderer
					content={rendered.tree}
					errors={rendered.errors}
					{notebookId}
					headingSlugPrefix=""
				/>
			</VisualBlockChrome>
		{/each}

		<div class="insert-row relative pt-1">
			<button
				type="button"
				class="w-full rounded-md border border-dashed border-border/70 py-2 text-2xs text-muted-foreground transition-colors hover:border-border hover:bg-muted/30 hover:text-foreground"
				onclick={() => {
					slashOpen = !slashOpen;
					slashIndex = blocks.length;
				}}
			>
				+ Add block
			</button>
			{#if slashOpen}
				<div
					class="absolute top-full left-0 z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
				>
					{#each SLASH_COMMANDS as cmd (cmd.id)}
						<button
							type="button"
							class="flex w-full flex-col rounded px-2 py-1.5 text-left hover:bg-muted"
							onclick={() => insertSnippet(cmd.snippet, slashIndex)}
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
	.visual-dashboard {
		position: relative;
	}
	@media (max-width: 720px) {
		.visual-dashboard {
			flex-direction: column;
		}
		.visual-inspector {
			width: 100%;
		}
	}
</style>
