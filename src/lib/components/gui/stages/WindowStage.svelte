<script lang="ts">
	import type {
		WindowStage,
		SortKey,
		DeriveStage as DeriveStageModel
	} from '$lib/types/gui-pipeline';
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { InlineChipLabel } from '$lib/components/ui/inline-chip-label';
	import { pickSortColumn, pickSortDir } from '$lib/components/gui/chip-intelligence';
	import { ArrowUp, ArrowDown, Plus, X } from '@lucide/svelte';
	import DeriveStageEditor from './DeriveStage.svelte';
	import { CHIP, CHIP_ADD, CHIP_INVALID, CHIP_X } from '../chip-styles';

	interface Props {
		stage: WindowStage;
		availableColumns: string[];
		onUpdate: (stage: WindowStage) => void;
	}

	let { stage, availableColumns, onUpdate }: Props = $props();

	function updateSortKey(idx: number, patch: Partial<SortKey>) {
		const sortKeys = stage.sortKeys.map((key, i) => (i === idx ? { ...key, ...patch } : key));
		onUpdate({ ...stage, sortKeys });
	}

	function removeSortKey(idx: number) {
		onUpdate({ ...stage, sortKeys: stage.sortKeys.filter((_, i) => i !== idx) });
	}

	function toggleSortDir(idx: number) {
		const sortKeys = stage.sortKeys.map((key, i) =>
			i === idx ? { ...key, dir: (key.dir === 'asc' ? 'desc' : 'asc') as SortKey['dir'] } : key
		);
		onUpdate({ ...stage, sortKeys });
	}

	// ── Pending new sort key (replaces add popover) ───────────────────────
	let pendingNewSort = $state(false);
	let pendingNewSortValue = $state('');

	function startAddSort() {
		pendingNewSortValue = pickSortColumn(
			availableColumns,
			stage.sortKeys.map((k) => k.column)
		);
		pendingNewSort = true;
	}

	function commitAddSort(col: string) {
		const column = col.trim();
		if (column) {
			onUpdate({ ...stage, sortKeys: [...stage.sortKeys, { column, dir: pickSortDir(column) }] });
		}
		pendingNewSort = false;
	}
</script>

<div class="flex flex-wrap items-center gap-1.5">
	<!-- Frame chip — keep popover (raw PRQL expression, not a column name) -->
	<Popover.Root>
		<Popover.Trigger class="{CHIP} px-2 hover:bg-muted/60">
			window {stage.frame || 'rows:-2..0'}
		</Popover.Trigger>
		<Popover.Content class="w-72 p-3">
			<Input
				class="h-7 font-mono text-xs"
				placeholder="rows:-2..0"
				value={stage.frame}
				oninput={(event) => onUpdate({ ...stage, frame: (event.target as HTMLInputElement).value })}
			/>
		</Popover.Content>
	</Popover.Root>

	<!-- Sort key chips — inline column editing (same pattern as SortStage) -->
	{#each stage.sortKeys as key, idx (`${key.column}-${key.dir}-${idx}`)}
		{@const invalid =
			availableColumns.length > 0 && key.column && !availableColumns.includes(key.column)}
		<div class="{CHIP} cursor-grab active:cursor-grabbing {invalid ? CHIP_INVALID : ''}">
			<!-- Direction toggle -->
			<button
				class="flex h-full items-center pr-0.5 pl-1.5 text-muted-foreground transition-colors duration-(--motion-fast) hover:bg-muted/60 hover:text-foreground"
				onclick={() => toggleSortDir(idx)}
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
				value={key.column}
				suggestions={availableColumns}
				placeholder="column…"
				class="px-2 py-1 font-mono text-xs {invalid ? 'text-destructive/70' : ''}"
				oncommit={(v) => updateSortKey(idx, { column: v })}
			/>

			<button class={CHIP_X} onclick={() => removeSortKey(idx)} aria-label="Remove sort key">
				<X class="h-3 w-3" />
			</button>
		</div>
	{/each}

	<!-- Pending new sort key -->
	{#if pendingNewSort}
		<div class="{CHIP} border-ring">
			<span class="flex h-full items-center pr-0.5 pl-1.5 text-muted-foreground"
				><ArrowUp class="h-3 w-3" /></span
			>
			<InlineChipLabel
				value={pendingNewSortValue}
				suggestions={availableColumns}
				initialEditing={true}
				placeholder="column…"
				class="px-2 py-1 font-mono text-xs"
				oncommit={commitAddSort}
				oncancel={() => (pendingNewSort = false)}
			/>
		</div>
	{/if}

	{#if !pendingNewSort}
		<button class={CHIP_ADD} onclick={startAddSort}>
			<Plus class="h-3 w-3" /> sort
		</button>
	{/if}

	<div class="h-0 basis-full"></div>
	<DeriveStageEditor
		stage={{ type: 'derive', columns: stage.derives }}
		{availableColumns}
		onUpdate={(next: DeriveStageModel) => onUpdate({ ...stage, derives: next.columns })}
	/>
</div>
