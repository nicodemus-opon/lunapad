<script lang="ts">
	import type { SelectStage } from '$lib/types/gui-pipeline';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { InlineChipLabel } from '$lib/components/ui/inline-chip-label';
	import { pickSelectColumn } from '$lib/components/gui/chip-intelligence';
	import { X, Plus, CheckSquare, Square } from '@lucide/svelte';

	interface Props {
		stage: SelectStage;
		availableColumns: string[];
		onUpdate: (stage: SelectStage) => void;
	}

	let { stage, availableColumns, onUpdate }: Props = $props();

	function remove(col: string) {
		onUpdate({ ...stage, columns: stage.columns.filter((c) => c !== col) });
	}

	function add(col: string) {
		const trimmed = col.trim();
		if (trimmed && !stage.columns.includes(trimmed)) {
			onUpdate({ ...stage, columns: [...stage.columns, trimmed] });
		}
	}

	function renameCol(idx: number, newVal: string) {
		const trimmed = newVal.trim();
		if (!trimmed || (stage.columns.includes(trimmed) && stage.columns[idx] !== trimmed)) return;
		const columns = stage.columns.map((c, i) => (i === idx ? trimmed : c));
		onUpdate({ ...stage, columns });
	}

	function toggle(col: string) {
		const columns = stage.columns.includes(col)
			? stage.columns.filter((c) => c !== col)
			: [...stage.columns, col];
		onUpdate({ ...stage, columns });
	}

	// ── Drag-to-reorder columns ─────────────────────────────────────
	let dragColIdx = $state<number | null>(null);

	function reorderColumns(from: number, to: number) {
		const columns = [...stage.columns];
		const [moved] = columns.splice(from, 1);
		columns.splice(to, 0, moved);
		onUpdate({ ...stage, columns });
	}

	function selectAll() {
		onUpdate({ ...stage, columns: [...availableColumns] });
	}

	function selectNone() {
		onUpdate({ ...stage, columns: [] });
	}

	// ── Pending new chip (replaces add popover) ─────────────────────
	let pendingNew = $state(false);
	let pendingNewValue = $state('');

	function addPending() {
		pendingNewValue = pickSelectColumn(availableColumns, stage.columns);
		pendingNew = true;
	}

	function commitPending(v: string) {
		add(v);
		pendingNew = false;
	}

	function cancelPending() {
		pendingNew = false;
	}

	const PILL_LIMIT = 8;
	const showSummary = $derived(stage.columns.length > PILL_LIMIT);
	const unselected = $derived(availableColumns.filter((c) => !stage.columns.includes(c)));
</script>

<div class="flex items-center gap-1.5 flex-wrap">
	{#if stage.columns.length === 0 && !pendingNew}
		<span class="text-xs text-muted-foreground/60 italic">all columns</span>
	{:else if showSummary}
		<!-- Summary pill when many columns selected -->
		<Popover.Root>
			<Popover.Trigger
				class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs bg-primary/10 border-primary/30 text-primary hover:bg-primary/20 transition-colors"
			>
				{stage.columns.length} columns
			</Popover.Trigger>
			<Popover.Content class="w-64 p-3">
				<div class="flex items-center gap-2 mb-2">
					<Button variant="outline" size="sm" class="h-6 text-xs px-2" onclick={selectAll}
						>All</Button
					>
					<Button variant="outline" size="sm" class="h-6 text-xs px-2" onclick={selectNone}
						>None</Button
					>
					<span class="text-xs text-muted-foreground ml-auto"
						>{stage.columns.length} / {availableColumns.length}</span
					>
				</div>
				<div class="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
					{#each availableColumns as col}
						{@const selected = stage.columns.includes(col)}
						<button
							class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors
								{selected
								? 'bg-primary text-primary-foreground border-primary'
								: 'bg-transparent text-muted-foreground border-muted-foreground/30 hover:border-primary/50'}"
							onclick={() => toggle(col)}
						>
							{#if selected}<CheckSquare class="w-3 h-3" />{:else}<Square class="w-3 h-3" />{/if}
							{col}
						</button>
					{/each}
				</div>
			</Popover.Content>
		</Popover.Root>
	{:else}
		<!-- Individual column pills -->
		{#each stage.columns as col, idx}
			{@const invalid = availableColumns.length > 0 && !availableColumns.includes(col)}
			<div
				role="listitem"
				draggable="true"
				ondragstart={() => (dragColIdx = idx)}
				ondragover={(e) => e.preventDefault()}
				ondrop={(e) => { e.preventDefault(); if (dragColIdx !== null && dragColIdx !== idx) { reorderColumns(dragColIdx, idx); dragColIdx = null; } }}
				ondragend={() => (dragColIdx = null)}
				class="inline-flex items-center rounded-full border bg-primary/10 text-primary text-xs overflow-hidden group/pill shrink-0 cursor-grab active:cursor-grabbing transition-colors {dragColIdx !== null && dragColIdx === idx ? 'opacity-40' : ''} {invalid ? 'border-destructive/50 text-destructive/70' : ''}"
				style={invalid ? '' : `border-color: hsl(var(--chart-${(idx % 5) + 1}))`}
			>
				<InlineChipLabel
					value={col}
					suggestions={availableColumns}
					class="px-2.5 py-1 font-mono text-xs"
					oncommit={(v) => renameCol(idx, v)}
					oncancel={() => { if (!col) remove(col); }}
				/>
				<button
					class="px-1.5 py-1 opacity-0 group-hover/pill:opacity-100 hover:text-destructive transition-all"
					onclick={() => remove(col)}
					aria-label="Remove {col}"
				>
					<X class="w-3 h-3" />
				</button>
			</div>
		{/each}
	{/if}

	<!-- Pending new chip (in edit mode immediately) -->
	{#if pendingNew && !showSummary}
		<div class="inline-flex items-center rounded-full border border-primary/50 bg-primary/5 text-primary text-xs overflow-hidden shrink-0">
			<InlineChipLabel
				value={pendingNewValue}
				suggestions={unselected}
				initialEditing={true}
				placeholder="column…"
				class="px-2.5 py-1 font-mono text-xs"
				oncommit={commitPending}
				oncancel={cancelPending}
			/>
		</div>
	{/if}

	<!-- Add button — only shown when not in summary mode -->
	{#if !showSummary && !pendingNew}
		<button
			class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
			onclick={addPending}
		>
			<Plus class="w-3 h-3" /> add
		</button>
	{/if}
</div>
