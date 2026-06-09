<script lang="ts">
	import type { SortStage, SortKey } from '$lib/types/gui-pipeline';
	import { InlineChipLabel } from '$lib/components/ui/inline-chip-label';
	import { pickSortColumn, pickSortDir } from '$lib/components/gui/chip-intelligence';
	import { Plus, X, ArrowUp, ArrowDown } from '@lucide/svelte';

	interface Props {
		stage: SortStage;
		availableColumns: string[];
		onUpdate: (stage: SortStage) => void;
	}

	let { stage, availableColumns, onUpdate }: Props = $props();

	function updateKey(idx: number, patch: Partial<SortKey>) {
		const keys = stage.keys.map((k, i) => (i === idx ? { ...k, ...patch } : k));
		onUpdate({ ...stage, keys });
	}

	function removeKey(idx: number) {
		onUpdate({ ...stage, keys: stage.keys.filter((_, i) => i !== idx) });
	}

	// ── Drag-to-reorder keys ──────────────────────────────────────────────
	let dragKeyIdx = $state<number | null>(null);

	function reorderKeys(from: number, to: number) {
		const keys = [...stage.keys];
		const [moved] = keys.splice(from, 1);
		keys.splice(to, 0, moved);
		onUpdate({ ...stage, keys });
	}

	// ── Pending new sort key (replaces add popover) ───────────────────────
	let pendingNew = $state(false);
	let pendingNewValue = $state('');

	function addPending() {
		pendingNewValue = pickSortColumn(availableColumns, stage.keys.map((k) => k.column));
		pendingNew = true;
	}

	function commitPending(col: string) {
		const trimmed = col.trim();
		if (trimmed) {
			onUpdate({ ...stage, keys: [...stage.keys, { column: trimmed, dir: pickSortDir(trimmed) }] });
		}
		pendingNew = false;
	}

	function cancelPending() {
		pendingNew = false;
	}
</script>

<div class="flex items-center gap-1.5 flex-wrap">
	{#if stage.keys.length === 0 && !pendingNew}
		<span class="text-xs text-muted-foreground/60 italic">no sort keys</span>
	{/if}

	{#each stage.keys as key, idx}
		{@const invalid = availableColumns.length > 0 && key.column && !availableColumns.includes(key.column)}
		<div
			role="listitem"
			draggable="true"
			ondragstart={() => (dragKeyIdx = idx)}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => { e.preventDefault(); if (dragKeyIdx !== null && dragKeyIdx !== idx) { reorderKeys(dragKeyIdx, idx); dragKeyIdx = null; } }}
			ondragend={() => (dragKeyIdx = null)}
			class="inline-flex items-center rounded-full border bg-background text-xs overflow-hidden group/pill shrink-0 cursor-grab active:cursor-grabbing transition-colors {dragKeyIdx !== null && dragKeyIdx === idx ? 'opacity-40' : ''} {invalid ? 'border-destructive/50' : ''}"
			style={invalid ? '' : `border-color: hsl(var(--chart-${(idx % 5) + 1}))`}
		>
			<!-- Direction toggle -->
			<button
				class="flex items-center gap-0.5 pl-1.5 py-1 transition-colors hover:bg-muted text-primary"
				onclick={() => updateKey(idx, { dir: key.dir === 'asc' ? 'desc' : 'asc' })}
				title="Click to toggle direction"
			>
				{#if key.dir === 'asc'}
					<ArrowUp class="w-3 h-3" />
				{:else}
					<ArrowDown class="w-3 h-3" />
				{/if}
			</button>

			<!-- Column name — inline edit, no popover -->
			<InlineChipLabel
				value={key.column || ''}
				suggestions={availableColumns}
				placeholder="column…"
				class="px-2 py-1 font-mono text-xs"
				oncommit={(v) => updateKey(idx, { column: v })}
			/>

			<!-- Delete -->
			<button
				class="px-1.5 py-1 text-muted-foreground opacity-0 group-hover/pill:opacity-100 hover:text-destructive transition-all"
				onclick={() => removeKey(idx)}
				aria-label="Remove sort key"
			>
				<X class="w-3 h-3" />
			</button>
		</div>
	{/each}

	<!-- Pending new key (opens in edit mode immediately) -->
	{#if pendingNew}
		<div class="inline-flex items-center rounded-full border border-primary/50 bg-background text-xs overflow-hidden shrink-0">
			<span class="pl-1.5 py-1 text-primary"><ArrowUp class="w-3 h-3" /></span>
			<InlineChipLabel
				value={pendingNewValue}
				suggestions={availableColumns}
				initialEditing={true}
				placeholder="column…"
				class="px-2 py-1 font-mono text-xs"
				oncommit={commitPending}
				oncancel={cancelPending}
			/>
		</div>
	{/if}

	<!-- Add sort key button -->
	{#if !pendingNew}
		<button
			class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 px-2 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
			onclick={addPending}
		>
			<Plus class="w-3 h-3" /> add
		</button>
	{/if}
</div>
