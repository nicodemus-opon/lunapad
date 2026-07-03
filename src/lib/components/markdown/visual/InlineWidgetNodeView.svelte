<script lang="ts">
	import MarkdocRenderer from '$lib/components/markdown/MarkdocRenderer.svelte';
	import { renderMarkdocCell } from '$lib/services/markdoc-interp';
	import { serializeMarkdocTag } from '$lib/services/markdoc-ast';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { getAllCellsAcrossNotebooks } from '$lib/stores/notebook.svelte';
	import { Trash2, Settings2 } from '@lucide/svelte';

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
		notebookId = '',
		selected = false,
		onSelect,
		onDelete,
		onOpenInspector,
		onPatch
	}: Props = $props();

	const source = $derived(
		serializeMarkdocTag(tagName, attrs, { selfClosing, body: '' })
	);

	const isElseDivider = $derived(tagName === 'else');

	// Resolve against live store cells so widget data tracks upstream results and
	// filter changes exactly like the report renderer (the node view mounts us
	// once, so a static `cells` snapshot would go stale).
	const liveCells = $derived(getAllCellsAcrossNotebooks());
	const rendered = $derived(isElseDivider ? null : renderMarkdocCell(source, liveCells));
	const hasErrors = $derived((rendered?.errors.length ?? 0) > 0);

	function setAttr(key: string, value: unknown) {
		onPatch({ attrs: { [key]: value } });
	}

	const chips = $derived.by(() => {
		if (tagName === 'metric') {
			return [
				{ key: 'label', label: 'Label', value: String(attrs.label ?? '') },
				{ key: 'value', label: 'Value', value: String(attrs.value ?? '') },
				{ key: 'format', label: 'Format', value: String(attrs.format ?? 'number') }
			];
		}
		if (tagName === 'filter') {
			return [
				{ key: 'param', label: 'Param', value: String(attrs.param ?? '') },
				{ key: 'label', label: 'Label', value: String(attrs.label ?? '') }
			];
		}
		if (tagName === 'chart' || tagName === 'datatable') {
			return [{ key: 'title', label: 'Title', value: String(attrs.title ?? tagName) }];
		}
		return [];
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="inline-widget-view group/iw relative transition-colors"
	class:is-selected={selected}
	role="button"
	tabindex="0"
	onclick={(e) => {
		if ((e.target as HTMLElement).closest('.iw-chrome, .iw-chip, .md-filter, .md-chart, .md-datatable, .md-tabs, .md-details, .md-metric-copy, select, input, button, textarea, a')) return;
		onSelect?.();
	}}
	onkeydown={(e) => {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		e.preventDefault();
		onSelect?.();
	}}
>
	<div
		class="iw-chrome absolute -top-2 right-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-hover/iw:opacity-100 {selected
			? 'opacity-100'
			: ''}"
	>
		{#if onOpenInspector}
			<button
				type="button"
				class="md-action"
				title="Properties"
				onclick={(e) => {
					e.stopPropagation();
					onOpenInspector();
				}}
			>
				<Settings2 class="h-3 w-3" />
			</button>
		{/if}
		<button
			type="button"
			class="md-action md-action--danger"
			title="Delete"
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
			<span class="font-medium uppercase tracking-wide">Otherwise</span>
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
	{/if}

	{#if selected && chips.length}
		<div class="iw-chips mt-1 flex flex-wrap gap-1 px-1 pb-1">
			{#each chips as chip (chip.key)}
				<label class="md-chip iw-chip">
					<span class="text-muted-foreground">{chip.label}</span>
					<input
						class="md-control-sm w-20 border-0 bg-transparent p-0 shadow-none focus:shadow-none"
						value={chip.value}
						oninput={(e) => setAttr(chip.key, e.currentTarget.value)}
						onclick={(e) => e.stopPropagation()}
					/>
				</label>
			{/each}
		</div>
	{/if}
</div>
