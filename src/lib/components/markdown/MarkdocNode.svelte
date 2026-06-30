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
	import * as Table from '$lib/components/ui/table';

	interface Props {
		node: RenderableTreeNode;
		notebookId?: string;
	}

	const { node, notebookId = '' }: Props = $props();

	const isTag = $derived(TagImpl.isTag(node));
	const tag = $derived(isTag ? (node as Tag) : null);
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
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</div>
{:else if tag?.name === 'column'}
	<div class="md-column" style={tag.attributes.width ? `flex-basis:${tag.attributes.width}` : undefined}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</div>
{:else if tag?.name === 'grid'}
	<div class="md-grid" style="--md-grid-cols: {tag.attributes.cols ?? 3}">
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</div>
{:else if tag?.name === 'callout'}
	<div class="md-callout md-callout--{tag.attributes.type ?? 'info'}">
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</div>
{:else if tag?.name === 'card'}
	<div class="md-card">
		{#if tag.attributes.title}<div class="md-card-title">{tag.attributes.title}</div>{/if}
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</div>
{:else if tag?.name === 'details'}
	<DetailsWidget summary={tag.attributes.summary} open={tag.attributes.open}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</DetailsWidget>
{:else if tag?.name === 'tabs'}
	<TabsWidget tabs={tag.children as Tag[]} {notebookId} />
{:else if tag?.name === 'pre'}
	<CodeBlock lang={tag.attributes?.['data-language'] ?? ''} children={tag.children} />
{:else if tag?.name === 'table'}
	<Table.Root containerClass="rounded-md border my-2" {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</Table.Root>
{:else if tag?.name === 'thead'}
	<Table.Header {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</Table.Header>
{:else if tag?.name === 'tbody'}
	<Table.Body {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</Table.Body>
{:else if tag?.name === 'tr'}
	<Table.Row {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</Table.Row>
{:else if tag?.name === 'th'}
	<Table.Head class="p-2 align-middle bg-background text-xs font-semibold" {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</Table.Head>
{:else if tag?.name === 'td'}
	<Table.Cell class="p-2 align-middle font-mono text-xs" {...tag.attributes}>
		{#each tag.children as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
	</Table.Cell>
{:else}
	<svelte:element this={tag?.name} {...tag?.attributes}>
		{#each tag?.children ?? [] as child, i (i)}<MarkdocNode node={child} {notebookId} />{/each}
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
