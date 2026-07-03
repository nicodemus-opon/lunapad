<script lang="ts">
	import type { SelectStage } from '$lib/types/gui-pipeline';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { InlineChipLabel } from '$lib/components/ui/inline-chip-label';
	import { pickSelectColumn } from '$lib/components/gui/chip-intelligence';
	import { X, Plus, CheckSquare, Square } from '@lucide/svelte';
	import { CHIP, CHIP_ADD, CHIP_INVALID, CHIP_X } from '../chip-styles';

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

<div class="flex flex-wrap items-center gap-1.5">
	{#if stage.columns.length === 0 && !pendingNew}
		<span class="text-xs text-muted-foreground/60 italic">all columns</span>
	{:else if showSummary}
		<!-- Summary pill when many columns selected -->
		<Popover.Root>
			<Popover.Trigger class="{CHIP} gap-1 px-2 text-foreground hover:bg-muted/60">
				{stage.columns.length} columns
			</Popover.Trigger>
			<Popover.Content class="w-64 p-3">
				<div class="mb-2 flex items-center gap-2">
					<Button variant="outline" size="sm" class="h-6 px-2 text-xs" onclick={selectAll}
						>All</Button
					>
					<Button variant="outline" size="sm" class="h-6 px-2 text-xs" onclick={selectNone}
						>None</Button
					>
					<span class="ml-auto text-xs text-muted-foreground"
						>{stage.columns.length} / {availableColumns.length}</span
					>
				</div>
				<div class="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
					{#each availableColumns as col}
						{@const selected = stage.columns.includes(col)}
						<button
							class="flex items-center gap-1 rounded border px-2 py-0.5 text-xs transition-colors duration-(--motion-fast)
								{selected
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-border bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground'}"
							onclick={() => toggle(col)}
						>
							{#if selected}<CheckSquare class="h-3 w-3" />{:else}<Square class="h-3 w-3" />{/if}
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
				ondrop={(e) => {
					e.preventDefault();
					if (dragColIdx !== null && dragColIdx !== idx) {
						reorderColumns(dragColIdx, idx);
						dragColIdx = null;
					}
				}}
				ondragend={() => (dragColIdx = null)}
				class="{CHIP} cursor-grab active:cursor-grabbing {dragColIdx !== null && dragColIdx === idx
					? 'opacity-40'
					: ''} {invalid ? CHIP_INVALID : ''}"
			>
				<InlineChipLabel
					value={col}
					suggestions={availableColumns}
					class="px-2 py-1 font-mono text-xs"
					oncommit={(v) => renameCol(idx, v)}
					oncancel={() => {
						if (!col) remove(col);
					}}
				/>
				<button class={CHIP_X} onclick={() => remove(col)} aria-label="Remove {col}">
					<X class="h-3 w-3" />
				</button>
			</div>
		{/each}
	{/if}

	<!-- Pending new chip (in edit mode immediately) -->
	{#if pendingNew && !showSummary}
		<div class="{CHIP} border-ring">
			<InlineChipLabel
				value={pendingNewValue}
				suggestions={unselected}
				initialEditing={true}
				placeholder="column…"
				class="px-2 py-1 font-mono text-xs"
				oncommit={commitPending}
				oncancel={cancelPending}
			/>
		</div>
	{/if}

	<!-- Add button — only shown when not in summary mode -->
	{#if !showSummary && !pendingNew}
		<button class={CHIP_ADD} onclick={addPending}>
			<Plus class="h-3 w-3" /> add
		</button>
	{/if}
</div>
