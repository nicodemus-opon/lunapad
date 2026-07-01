<script lang="ts">
	import type { SortStage, SortKey } from '$lib/types/gui-pipeline';
	import { InlineChipLabel } from '$lib/components/ui/inline-chip-label';
	import { pickSortColumn, pickSortDir } from '$lib/components/gui/chip-intelligence';
	import { Plus, X, ArrowUp, ArrowDown } from '@lucide/svelte';
	import { CHIP, CHIP_ADD, CHIP_INVALID, CHIP_X } from '../chip-styles';

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
		pendingNewValue = pickSortColumn(
			availableColumns,
			stage.keys.map((k) => k.column)
		);
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

<div class="flex flex-wrap items-center gap-1.5">
	{#if stage.keys.length === 0 && !pendingNew}
		<span class="text-xs text-muted-foreground/60 italic">no sort keys</span>
	{/if}

	{#each stage.keys as key, idx}
		{@const invalid =
			availableColumns.length > 0 && key.column && !availableColumns.includes(key.column)}
		<div
			role="listitem"
			draggable="true"
			ondragstart={() => (dragKeyIdx = idx)}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				e.preventDefault();
				if (dragKeyIdx !== null && dragKeyIdx !== idx) {
					reorderKeys(dragKeyIdx, idx);
					dragKeyIdx = null;
				}
			}}
			ondragend={() => (dragKeyIdx = null)}
			class="{CHIP} cursor-grab active:cursor-grabbing {dragKeyIdx !== null && dragKeyIdx === idx
				? 'opacity-40'
				: ''} {invalid ? CHIP_INVALID : ''}"
		>
			<!-- Direction toggle -->
			<button
				class="flex h-full items-center pr-0.5 pl-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground"
				onclick={() => updateKey(idx, { dir: key.dir === 'asc' ? 'desc' : 'asc' })}
				title="Click to toggle direction"
			>
				{#if key.dir === 'asc'}
					<ArrowUp class="h-3 w-3" />
				{:else}
					<ArrowDown class="h-3 w-3" />
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
			<button class={CHIP_X} onclick={() => removeKey(idx)} aria-label="Remove sort key">
				<X class="h-3 w-3" />
			</button>
		</div>
	{/each}

	<!-- Pending new key (opens in edit mode immediately) -->
	{#if pendingNew}
		<div class="{CHIP} border-ring/60">
			<span class="flex h-full items-center pr-0.5 pl-1.5 text-muted-foreground"
				><ArrowUp class="h-3 w-3" /></span
			>
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
		<button class={CHIP_ADD} onclick={addPending}>
			<Plus class="h-3 w-3" /> add
		</button>
	{/if}
</div>
