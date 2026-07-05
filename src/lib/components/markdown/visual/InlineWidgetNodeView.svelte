<script lang="ts">
	import MarkdocRenderer from '$lib/components/markdown/MarkdocRenderer.svelte';
	import { renderMarkdocCell } from '$lib/services/markdoc-interp';
	import { markdocAttrToDisplay as attr, serializeMarkdocTag } from '$lib/services/markdoc-ast';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { Trash2, SlidersHorizontal } from '@lucide/svelte';

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

	const source = $derived(
		serializeMarkdocTag(tagName, attrs, { selfClosing, body: '' })
	);

	const isElseDivider = $derived(tagName === 'else');

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
	<div
		class="iw-chrome absolute -top-2.5 right-1 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/iw:opacity-100 {selected
			? 'opacity-100'
			: ''}"
	>
		{#if onOpenInspector}
			<button
				type="button"
				class="iw-action"
				title="Edit properties"
				onclick={(e) => {
					e.stopPropagation();
					onOpenInspector();
				}}
			>
				<SlidersHorizontal class="h-3 w-3" />
				<span class="iw-action-label">Properties</span>
			</button>
		{/if}
		<button
			type="button"
			class="iw-action iw-action--danger"
			title="Delete block"
			onclick={(e) => {
				e.stopPropagation();
				onDelete?.();
			}}
		>
			<Trash2 class="h-3 w-3" />
		</button>
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
			<MarkdocRenderer
				content={rendered!.tree}
				errors={[]}
				{notebookId}
				headingSlugPrefix=""
			/>
		</div>
		{#if selected}
			<div class="iw-meta px-1 pb-1 text-3xs text-muted-foreground">{summary}</div>
		{/if}
	{/if}
</div>

<style>
	.iw-action {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		height: 1.35rem;
		padding: 0 0.35rem;
		border: 1px solid color-mix(in oklab, var(--border) 80%, transparent);
		border-radius: var(--radius-sm);
		background: var(--popover);
		color: var(--muted-foreground);
		font-size: var(--text-3xs);
		font-weight: 500;
		cursor: pointer;
		box-shadow: 0 1px 2px color-mix(in oklab, var(--foreground) 6%, transparent);
		transition:
			background var(--motion-fast) var(--motion-ease-out),
			color var(--motion-fast) var(--motion-ease-out),
			border-color var(--motion-fast) var(--motion-ease-out);
	}
	.iw-action:hover {
		background: var(--muted);
		color: var(--foreground);
	}
	.iw-action--danger:hover {
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
