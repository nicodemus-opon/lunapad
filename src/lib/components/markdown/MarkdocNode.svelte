<script lang="ts">
	import type { RenderableTreeNode, Tag } from '@markdoc/markdoc';
	// Named *value* import of `Tag` breaks under Vite's SSR module runner (@markdoc/markdoc is
	// CJS) — go through the default export for the runtime value instead. The type import above
	// is unaffected (type-only imports are erased before this matters).
	import Markdoc from '@markdoc/markdoc';
	const TagImpl = Markdoc.Tag;
	import MarkdocNode from './MarkdocNode.svelte';
	import MetricWidget from './MetricWidget.svelte';
	import ChartWidget from './ChartWidget.svelte';
	import TableWidget from './TableWidget.svelte';
	import FilterWidget from './FilterWidget.svelte';
	import BadgeWidget from './BadgeWidget.svelte';
	import ProgressWidget from './ProgressWidget.svelte';
	import DetailsWidget from './DetailsWidget.svelte';
	import TabsWidget from './TabsWidget.svelte';
	import CodeBlock from './CodeBlock.svelte';
	import MermaidDiagram from './MermaidDiagram.svelte';
	import * as Table from '$lib/components/ui/table';
	import ResultTable from '$lib/components/ResultTable.svelte';
	import { resolveHeadingAnchorId, textFromMarkdocChildren } from '$lib/services/notebook-outline';
	import { sanitizeUrl } from '$lib/services/safe-url';

	interface Props {
		node: RenderableTreeNode;
		notebookId?: string;
		headingSlugPrefix?: string;
		headingSlugTracker?: Set<string>;
	}

	const {
		node,
		notebookId = '',
		headingSlugPrefix = '',
		headingSlugTracker = new Set<string>()
	}: Props = $props();

	const isTag = $derived(TagImpl.isTag(node));
	const tag = $derived(isTag ? (node as Tag) : null);
	const isHeading = $derived(tag ? /^h[1-6]$/.test(tag.name) : false);
	const headingId = $derived.by(() => {
		if (!isHeading || !tag || !headingSlugPrefix) return undefined;
		const label = textFromMarkdocChildren(tag.children as unknown[]);
		if (!label.trim()) return undefined;
		return resolveHeadingAnchorId(headingSlugPrefix, label, headingSlugTracker);
	});
	const nodeProps = $derived({ notebookId, headingSlugPrefix, headingSlugTracker });

	// Strip dangerous URL schemes (javascript:, data:, …) from link/image
	// attributes before they reach the DOM. Escaping alone doesn't stop them.
	const safeAttributes = $derived.by(() => {
		const attrs = (tag?.attributes ?? {}) as Record<string, unknown>;
		if (!tag || (tag.name !== 'a' && tag.name !== 'img')) return attrs;
		const copy = { ...attrs };
		for (const key of ['href', 'src']) {
			if (typeof copy[key] === 'string') {
				const safe = sanitizeUrl(copy[key]);
				if (safe) copy[key] = safe;
				else delete copy[key];
			}
		}
		return copy;
	});

	function parseSimpleMarkdocTable(
		input: Tag
	): { columns: string[]; rows: Record<string, unknown>[] } | null {
		const children = (input.children ?? []) as unknown[];

		const thead = children.find((c) => TagImpl.isTag(c) && (c as Tag).name === 'thead') as
			| Tag
			| undefined;
		const tbody = children.find((c) => TagImpl.isTag(c) && (c as Tag).name === 'tbody') as
			| Tag
			| undefined;
		if (!thead || !tbody) return null;

		const headerTr = (thead.children ?? []).find(
			(c) => TagImpl.isTag(c) && (c as Tag).name === 'tr'
		) as Tag | undefined;

		const headerCells = (headerTr?.children ?? []).filter(
			(c) => TagImpl.isTag(c) && ((c as Tag).name === 'th' || (c as Tag).name === 'td')
		) as Tag[];

		const columns = headerCells
			.map((th) => textFromMarkdocChildren(th.children as unknown[]).trim())
			.filter(Boolean);

		if (columns.length === 0) return null;
		if (columns.length > 30) return null;

		const rowTrs = (tbody.children ?? []).filter(
			(c) => TagImpl.isTag(c) && (c as Tag).name === 'tr'
		) as Tag[];

		const MAX_ROWS = 500;
		const trimmedTrs = rowTrs.slice(0, MAX_ROWS);

		const rows = trimmedTrs.map((tr) => {
			const cellTags = (tr.children ?? []).filter(
				(c) => TagImpl.isTag(c) && ((c as Tag).name === 'td' || (c as Tag).name === 'th')
			) as Tag[];

			const row: Record<string, unknown> = {};
			for (let i = 0; i < columns.length; i++) {
				const cell = cellTags[i];
				row[columns[i]] = cell ? textFromMarkdocChildren(cell.children as unknown[]).trim() : '';
			}
			return row;
		});

		return { columns, rows };
	}
</script>

{#if !isTag}
	{#if node !== null && node !== undefined && node !== false}{node}{/if}
{:else if tag?.name === 'metric'}
	<MetricWidget {...tag.attributes} />
{:else if tag?.name === 'chart'}
	<ChartWidget {...tag.attributes} />
{:else if tag?.name === 'datatable'}
	<TableWidget {...tag.attributes} />
{:else if tag?.name === 'filter'}
	<FilterWidget {notebookId} {...tag.attributes} />
{:else if tag?.name === 'badge'}
	<BadgeWidget {...tag.attributes} />
{:else if tag?.name === 'progress'}
	<ProgressWidget {...tag.attributes} />
{:else if tag?.name === 'columns'}
	<div class="md-columns">
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</div>
{:else if tag?.name === 'column'}
	<div
		class="md-column"
		style={tag.attributes.width ? `flex-basis:${tag.attributes.width}` : undefined}
	>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</div>
{:else if tag?.name === 'grid'}
	<div class="md-grid" style="--md-grid-cols: {tag.attributes.cols ?? 3}">
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</div>
{:else if tag?.name === 'callout'}
	<div class="md-callout md-callout--{tag.attributes.type ?? 'info'}">
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</div>
{:else if tag?.name === 'card'}
	<div class="md-card">
		{#if tag.attributes.title}<div class="md-card-title">{tag.attributes.title}</div>{/if}
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</div>
{:else if tag?.name === 'details'}
	<DetailsWidget summary={tag.attributes.summary} open={tag.attributes.open}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</DetailsWidget>
{:else if tag?.name === 'tabs'}
	<TabsWidget tabs={tag.children as Tag[]} {notebookId} />
{:else if tag?.name === 'mermaid'}
	<MermaidDiagram code={tag.attributes?.code ?? ''} />
{:else if tag?.name === 'pre'}
	<CodeBlock lang={tag.attributes?.['data-language'] ?? ''} children={tag.children} />
{:else if tag?.name === 'table'}
	{@const parsed = parseSimpleMarkdocTable(tag)}
	{#if parsed}
		<ResultTable
			rows={parsed.rows}
			columns={parsed.columns}
			name="table"
			pageSize={10}
			headerInsights="compact"
		/>
	{:else}
		<Table.Root containerClass="rounded-md border my-2" {...tag.attributes}>
			{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
		</Table.Root>
	{/if}
{:else if tag?.name === 'thead'}
	<Table.Header {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</Table.Header>
{:else if tag?.name === 'tbody'}
	<Table.Body {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</Table.Body>
{:else if tag?.name === 'tr'}
	<Table.Row {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</Table.Row>
{:else if tag?.name === 'th'}
	<Table.Head class="bg-background p-2 align-middle text-xs font-semibold" {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</Table.Head>
{:else if tag?.name === 'td'}
	<Table.Cell class="p-2 align-middle font-mono text-xs" {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</Table.Cell>
{:else if isHeading && tag}
	<svelte:element this={tag.name} {...tag.attributes} id={headingId} class="scroll-mt-24">
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</svelte:element>
{:else}
	<svelte:element this={tag?.name} {...safeAttributes}>
		{#each tag?.children ?? [] as child, i (i)}<MarkdocNode node={child} {...nodeProps} />{/each}
	</svelte:element>
{/if}

<style>
	.md-columns {
		display: flex;
		gap: 1rem;
		margin: 0.5rem 0;
	}
	.md-column {
		flex: 1 1 0%;
		min-width: 0;
	}
	.md-grid {
		display: grid;
		grid-template-columns: repeat(var(--md-grid-cols), minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0.5rem 0;
	}
	.md-callout {
		padding: 0.6rem 0.8rem;
		border-radius: 0.5rem;
		border: 1px solid;
		margin: 0.5rem 0;
		font-size: 0.9em;
	}
	.md-callout--info {
		background: color-mix(in oklch, var(--chart-1, #3b82f6) 8%, transparent);
		border-color: color-mix(in oklch, var(--chart-1, #3b82f6) 25%, transparent);
	}
	.md-callout--success {
		background: color-mix(in oklch, var(--chart-2, #16a34a) 8%, transparent);
		border-color: color-mix(in oklch, var(--chart-2, #16a34a) 25%, transparent);
	}
	.md-callout--warning {
		background: color-mix(in oklch, #d97706 8%, transparent);
		border-color: color-mix(in oklch, #d97706 25%, transparent);
	}
	.md-callout--error {
		background: color-mix(in oklch, var(--destructive, #dc2626) 8%, transparent);
		border-color: color-mix(in oklch, var(--destructive, #dc2626) 25%, transparent);
	}
	.md-card {
		border: 1px solid color-mix(in oklch, currentColor 15%, transparent);
		border-radius: 0.5rem;
		padding: 0.6rem 0.8rem;
		margin: 0.5rem 0;
	}
	.md-card-title {
		font-weight: 600;
		font-size: 0.85em;
		margin-bottom: 0.3rem;
		opacity: 0.8;
	}
</style>
