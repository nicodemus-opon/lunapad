<script lang="ts">
	import { Trash2, Minus, Plus, SlidersHorizontal, Check, X } from '@lucide/svelte';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { renderMarkdocCell, resolveBareVariablePath } from '$lib/services/markdoc-interp';

	interface Props {
		tagName: string;
		attrs: Record<string, unknown>;
		cells?: Cell[];
		selected?: boolean;
		logicMode?: 'preview' | 'template' | null;
		hasElse?: boolean;
		onSelect?: () => void;
		onDelete?: () => void;
		onPatchAttrs?: (patch: Record<string, unknown>) => void;
		onAddChild?: () => void;
		onToggleLogicMode?: () => void;
		onIfState?: (state: string | null) => void;
	}

	const {
		tagName,
		attrs,
		cells = [],
		selected = false,
		logicMode = null,
		hasElse = false,
		onSelect,
		onDelete,
		onPatchAttrs,
		onAddChild,
		onToggleLogicMode,
		onIfState
	}: Props = $props();

	/** Resolve a data attr that is either a literal array or a `$cell.rows` ref string. */
	function resolveDataRows(data: unknown): unknown[] | null {
		if (Array.isArray(data)) return data;
		if (typeof data === 'string' && data.trim().startsWith('$')) {
			const value = resolveBareVariablePath(data, cells);
			if (Array.isArray(value)) return value;
		}
		return null;
	}

	function resolveRowValue(row: unknown, path: string): unknown {
		let value = row;
		for (const key of path.split('.').filter(Boolean)) {
			if (!value || typeof value !== 'object') return undefined;
			value = (value as Record<string, unknown>)[key];
		}
		return value;
	}

	// Live data badge: "N items" (each), "N groups" (group), ✓/✗ (if).
	const dataBadge = $derived.by(() => {
		if (tagName === 'each') {
			const rows = resolveDataRows(attrs.data);
			return rows === null ? 'no data' : `${rows.length} item${rows.length === 1 ? '' : 's'}`;
		}
		if (tagName === 'group') {
			const rows = resolveDataRows(attrs.data);
			const by = String(attrs.by ?? '');
			if (rows === null || !by) return 'no data';
			const keys = new Set(rows.map((row) => String(resolveRowValue(row, by) ?? '')));
			return `${keys.size} group${keys.size === 1 ? '' : 's'}`;
		}
		return null;
	});

	function treeText(node: unknown): string {
		if (typeof node === 'string' || typeof node === 'number') return String(node);
		if (Array.isArray(node)) return node.map(treeText).join('');
		if (node && typeof node === 'object' && 'children' in node) {
			return treeText((node as { children: unknown[] }).children ?? []);
		}
		return '';
	}

	const ifState = $derived.by(() => {
		if (tagName !== 'if') return null;
		const condition = String(attrs.condition ?? '').trim();
		if (!condition) return null;
		const result = renderMarkdocCell(`{% if ${condition} %}1{% else /%}0{% /if %}`, cells);
		if (result.errors.length) return 'invalid';
		const text = treeText(result.tree);
		return text.includes('1') ? 'true' : 'false';
	});

	// Push the live condition state up to the node view so it can mark the
	// container (data-if-state) for inactive-branch dimming via CSS.
	$effect(() => {
		onIfState?.(ifState);
	});

	const label = $derived.by(() => {
		if (tagName === 'callout') return `Callout (${attrs.type ?? 'info'})`;
		if (tagName === 'card') return String(attrs.title ?? 'Card');
		if (tagName === 'details') return String(attrs.summary ?? 'Details');
		if (tagName === 'tab') return String(attrs.label ?? 'Tab');
		if (tagName === 'grid') return 'Grid';
		if (tagName === 'columns') return 'Columns';
		if (tagName === 'column') return 'Column';
		if (tagName === 'tabs') return 'Tabs';
		if (tagName === 'mermaid') return 'Mermaid';
		if (tagName === 'if') return 'Conditional';
		if (tagName === 'each') return 'Each loop';
		if (tagName === 'group') return 'Group';
		return tagName;
	});

	const gridCols = $derived(Number(attrs.cols ?? 3));

	function setGridCols(next: number) {
		onPatchAttrs?.({ cols: Math.max(1, Math.min(6, next)) });
	}

	const GAP_STEPS = ['compact', 'default', 'comfortable'] as const;
	const gap = $derived(String(attrs.gap ?? 'default'));

	function cycleGap() {
		const idx = GAP_STEPS.indexOf(gap as (typeof GAP_STEPS)[number]);
		const next = GAP_STEPS[(idx + 1) % GAP_STEPS.length];
		onPatchAttrs?.({ gap: next });
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="container-chrome flex items-center gap-1 px-1 py-0.5 text-2xs opacity-0 transition-opacity group-hover/container:opacity-100 {selected
		? 'opacity-100'
		: ''}"
	role="button"
	tabindex="0"
	onclick={() => onSelect?.()}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect?.();
		}
	}}
>
	<span class="font-medium text-muted-foreground">{label}</span>

	{#if dataBadge !== null}
		<span
			class="rounded-sm border px-1 py-px text-3xs tabular-nums {dataBadge === 'no data'
				? 'border-warning/40 text-warning'
				: 'border-border bg-background/80 text-muted-foreground'}"
		>
			{dataBadge}
		</span>
	{/if}

	{#if ifState !== null}
		<span
			class="inline-flex items-center gap-0.5 rounded-sm border px-1 py-px text-3xs {ifState ===
			'true'
				? 'border-success/40 text-success'
				: ifState === 'false'
					? 'border-border text-muted-foreground'
					: 'border-warning/40 text-warning'}"
			title={ifState === 'invalid'
				? 'Condition could not be evaluated'
				: `Condition is currently ${ifState}`}
		>
			{#if ifState === 'true'}<Check class="h-2.5 w-2.5" />true
			{:else if ifState === 'false'}<X class="h-2.5 w-2.5" />false
			{:else}invalid{/if}
		</span>
	{/if}

	{#if tagName === 'grid' && onPatchAttrs}
		<div class="flex items-center gap-0.5 rounded-sm border bg-background/80 px-0.5">
			<button
				type="button"
				class="md-action"
				title="Fewer columns"
				onclick={(e) => {
					e.stopPropagation();
					setGridCols(gridCols - 1);
				}}
			>
				<Minus class="h-3 w-3" />
			</button>
			<span class="min-w-4 text-center tabular-nums">{gridCols}</span>
			<button
				type="button"
				class="md-action"
				title="More columns"
				onclick={(e) => {
					e.stopPropagation();
					setGridCols(gridCols + 1);
				}}
			>
				<Plus class="h-3 w-3" />
			</button>
		</div>
	{/if}

	{#if logicMode !== null && onToggleLogicMode}
		<div class="flex items-center gap-0 rounded-sm border bg-background/80">
			<button
				type="button"
				class="md-action px-1.5 py-0.5 text-2xs font-medium {logicMode === 'preview'
					? 'bg-accent text-accent-foreground'
					: ''}"
				title="Show live output with real data"
				onclick={(e) => {
					e.stopPropagation();
					if (logicMode !== 'preview') onToggleLogicMode();
				}}
			>
				Preview
			</button>
			<button
				type="button"
				class="md-action px-1.5 py-0.5 text-2xs font-medium {logicMode === 'template'
					? 'bg-accent text-accent-foreground'
					: ''}"
				title="Edit the repeating template"
				onclick={(e) => {
					e.stopPropagation();
					if (logicMode !== 'template') onToggleLogicMode();
				}}
			>
				Template
			</button>
		</div>
	{/if}

	{#if (tagName === 'grid' || tagName === 'columns') && onPatchAttrs}
		<button
			type="button"
			class="md-action rounded-sm border bg-background/80 px-1.5 py-0.5 text-2xs font-medium capitalize"
			title="Cycle cell spacing (compact / default / comfortable)"
			onclick={(e) => {
				e.stopPropagation();
				cycleGap();
			}}
		>
			{gap} gap
		</button>
	{/if}

	{#if (tagName === 'columns' || tagName === 'tabs') && onAddChild}
		<button
			type="button"
			class="md-action rounded-sm border bg-background/80 px-1.5 py-0.5 text-2xs font-medium"
			title={tagName === 'columns' ? 'Add column' : 'Add tab'}
			onclick={(e) => {
				e.stopPropagation();
				onAddChild();
			}}
		>
			{tagName === 'columns' ? 'Add column' : 'Add tab'}
		</button>
	{/if}

	{#if tagName === 'if' && !hasElse && onAddChild}
		<button
			type="button"
			class="md-action rounded-sm border bg-background/80 px-1.5 py-0.5 text-2xs font-medium"
			title="Add an otherwise branch shown when the condition is false"
			onclick={(e) => {
				e.stopPropagation();
				onAddChild();
			}}
		>
			Add else
		</button>
	{/if}

	<span class="flex-1"></span>
	<button
		type="button"
		class="md-action"
		title="Edit properties"
		onclick={(e) => {
			e.stopPropagation();
			onSelect?.();
		}}
	>
		<SlidersHorizontal class="h-3 w-3" />
	</button>
	<button
		type="button"
		class="md-action md-action--danger"
		title="Delete container"
		onclick={(e) => {
			e.stopPropagation();
			onDelete?.();
		}}
	>
		<Trash2 class="h-3 w-3" />
	</button>
</div>
