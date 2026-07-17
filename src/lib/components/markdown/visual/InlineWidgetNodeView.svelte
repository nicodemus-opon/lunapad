<script lang="ts">
	import MarkdocRenderer from '$lib/components/markdown/MarkdocRenderer.svelte';
	import { renderMarkdocCell } from '$lib/services/markdoc-interp';
	import { markdocAttrToDisplay as attr, serializeMarkdocTag } from '$lib/services/markdoc-ast';
	import { findFilterUsages } from '$lib/services/markdoc-visual-analysis';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Trash2, SlidersHorizontal, TriangleAlert } from '@lucide/svelte';

	interface Props {
		tagName: string;
		attrs: Record<string, unknown>;
		selfClosing?: boolean;
		cells?: Cell[];
		notebookId?: string;
		selected?: boolean;
		onSelect?: () => void;
		onDelete?: () => void;
		onOpenInspector?: () => void;
		onPatch: (patch: {
			tagName?: string;
			attrs?: Record<string, unknown>;
			attrsJson?: string;
		}) => void;
	}

	let {
		tagName,
		attrs,
		selfClosing = true,
		cells = [],
		notebookId = '',
		selected = false,
		onSelect,
		onDelete,
		onOpenInspector
	}: Props = $props();

	const source = $derived(serializeMarkdocTag(tagName, attrs, { selfClosing, body: '' }));

	const isElseDivider = $derived(tagName === 'else');

	// Editor-only orphan check: a filter whose param no query cell consumes.
	const filterParam = $derived(tagName === 'filter' ? attr(attrs.param).trim() : '');
	const filterOrphaned = $derived(
		Boolean(filterParam) && findFilterUsages(cells ?? [], filterParam).length === 0
	);
	const orphanTitle = $derived(
		`No query uses \${${filterParam}} — add \${${filterParam}} to a query cell's code`
	);

	const rendered = $derived(isElseDivider ? null : renderMarkdocCell(source, cells ?? []));
	const hasErrors = $derived((rendered?.errors.length ?? 0) > 0);

	const summary = $derived.by(() => {
		if (tagName === 'metric') {
			const label = attr(attrs.label, 'Metric');
			const value = attr(attrs.value);
			return value ? `${label} · ${value}` : label;
		}
		if (tagName === 'filter') {
			const param = attr(attrs.param);
			return param ? `Filter · ${param}` : 'Filter';
		}
		if (tagName === 'chart') {
			return attr(attrs.title, attr(attrs.type, 'Chart'));
		}
		if (tagName === 'datatable') {
			return attr(attrs.title, 'Table');
		}
		return tagName;
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="inline-widget-view group/iw relative rounded-sm transition-[box-shadow,background] duration-(--motion-fast) ease-(--motion-ease-out) {selected
		? 'is-selected bg-muted/10 ring-1 ring-ring/35'
		: 'hover:bg-muted/8'}"
	role="button"
	tabindex="0"
	onclick={(e) => {
		if (
			(e.target as HTMLElement).closest(
				'.iw-chrome, .md-filter, .md-chart, .md-datatable, .md-tabs, .md-details, .md-metric-copy, select, input, button, textarea, a'
			)
		)
			return;
		onSelect?.();
	}}
	onkeydown={(e) => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		onSelect?.();
	}}
>
	{#if filterOrphaned}
		<div
			class="iw-orphan absolute -top-2.5 left-1 z-10 inline-flex items-center gap-0.5 rounded-sm border border-warning/50 bg-background/90 px-1 py-px text-3xs text-warning"
			title={orphanTitle}
		>
			<TriangleAlert class="h-2.5 w-2.5" />
			unused
		</div>
	{/if}
	<div
		class="iw-chrome absolute -top-2.5 right-1 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/iw:opacity-100 {selected
			? 'opacity-100'
			: ''}"
	>
		{#if onOpenInspector}
			<Button
				type="button"
				variant="ghost"
				size="xs"
				class="iw-action"
				title="Edit properties"
				onclick={(e) => {
					e.stopPropagation();
					onOpenInspector();
				}}
			>
				<SlidersHorizontal class="h-3 w-3" />
				<span class="iw-action-label">Properties</span>
			</Button>
		{/if}
		<Button
			type="button"
			variant="ghost"
			size="xs"
			class="iw-action iw-action--danger"
			title="Delete block"
			onclick={(e) => {
				e.stopPropagation();
				onDelete?.();
			}}
		>
			<Trash2 class="h-3 w-3" />
		</Button>
	</div>

	{#if hasErrors}
		<div class="md-panel mb-1 text-2xs text-warning">
			{rendered?.errors[0]}
		</div>
	{/if}

	{#if isElseDivider}
		<div class="md-else-divider flex items-center gap-2 py-1 text-2xs text-muted-foreground">
			<span class="h-px flex-1 bg-border/70"></span>
			<span class="font-medium">Otherwise</span>
			<span class="h-px flex-1 bg-border/70"></span>
		</div>
	{:else}
		<div class="iw-preview">
			<MarkdocRenderer content={rendered!.tree} errors={[]} {notebookId} headingSlugPrefix="" />
		</div>
		{#if selected}
			<div class="iw-meta px-1 pb-1 text-3xs text-muted-foreground">{summary}</div>
		{/if}
	{/if}
</div>

<style>
	:global(.iw-action) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		height: 1.45rem;
		padding: 0 0.35rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--popover);
		color: var(--muted-foreground);
		font-size: var(--text-3xs);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--motion-fast) var(--motion-ease-out),
			color var(--motion-fast) var(--motion-ease-out),
			border-color var(--motion-fast) var(--motion-ease-out);
	}
	:global(.iw-action:hover) {
		background: var(--muted);
		color: var(--foreground);
	}
	:global(.iw-action--danger:hover) {
		background: color-mix(in oklab, var(--destructive) 10%, transparent);
		color: var(--destructive);
		border-color: color-mix(in oklab, var(--destructive) 25%, transparent);
	}
	.iw-action-label {
		display: none;
	}
	.group\/iw.is-selected .iw-action-label,
	.group\/iw:hover .iw-action-label {
		display: inline;
	}
</style>
