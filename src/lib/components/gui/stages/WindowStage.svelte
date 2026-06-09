<script lang="ts">
	import type { WindowStage, SortKey, DeriveStage as DeriveStageModel } from '$lib/types/gui-pipeline';
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { InlineChipLabel } from '$lib/components/ui/inline-chip-label';
	import { pickSortColumn, pickSortDir } from '$lib/components/gui/chip-intelligence';
	import { ArrowUp, ArrowDown, Plus, X } from '@lucide/svelte';
	import DeriveStageEditor from './DeriveStage.svelte';

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
		pendingNewSortValue = pickSortColumn(availableColumns, stage.sortKeys.map((k) => k.column));
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

<div class="flex items-center gap-1.5 flex-wrap">
	<!-- Frame chip — keep popover (raw PRQL expression, not a column name) -->
	<Popover.Root>
		<Popover.Trigger class="inline-flex items-center rounded-full border border-chart-2 bg-muted/35 px-2.5 py-1 text-xs font-mono hover:bg-muted/60 transition-colors">
			window {stage.frame || 'rows:-2..0'}
		</Popover.Trigger>
		<Popover.Content class="w-72 p-3">
			<Input
				class="h-7 text-xs font-mono"
				placeholder="rows:-2..0"
				value={stage.frame}
				oninput={(event) => onUpdate({ ...stage, frame: (event.target as HTMLInputElement).value })}
			/>
		</Popover.Content>
	</Popover.Root>

	<!-- Sort key chips — inline column editing (same pattern as SortStage) -->
	{#each stage.sortKeys as key, idx (`${key.column}-${key.dir}-${idx}`)}
		{@const invalid = availableColumns.length > 0 && key.column && !availableColumns.includes(key.column)}
		<div
			class="inline-flex items-center rounded border bg-background text-xs overflow-hidden group/pill shrink-0 cursor-grab active:cursor-grabbing transition-colors {invalid ? 'border-destructive/50' : ''}"
			style={invalid ? '' : `border-color: hsl(var(--chart-${(idx % 5) + 1}))`}
		>
			<!-- Direction toggle -->
			<button
				class="flex items-center gap-0.5 pl-1.5 py-1 transition-colors hover:bg-muted text-primary"
				onclick={() => toggleSortDir(idx)}
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
				value={key.column}
				suggestions={availableColumns}
				placeholder="column…"
				class="px-2 py-1 font-mono text-xs {invalid ? 'text-destructive/70' : ''}"
				oncommit={(v) => updateSortKey(idx, { column: v })}
			/>

			<button
				class="px-1.5 py-1 text-muted-foreground opacity-0 group-hover/pill:opacity-100 hover:text-destructive transition-all"
				onclick={() => removeSortKey(idx)}
				aria-label="Remove sort key"
			>
				<X class="w-3 h-3" />
			</button>
		</div>
	{/each}

	<!-- Pending new sort key -->
	{#if pendingNewSort}
		<div class="inline-flex items-center rounded border border-primary/50 bg-background text-xs overflow-hidden shrink-0">
			<span class="pl-1.5 py-1 text-primary"><ArrowUp class="w-3 h-3" /></span>
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
		<button
			class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 px-2 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
			onclick={startAddSort}
		>
			<Plus class="w-3 h-3" /> sort
		</button>
	{/if}

	<div class="basis-full h-0"></div>
	<DeriveStageEditor
		stage={{ type: 'derive', columns: stage.derives }}
		{availableColumns}
		onUpdate={(next: DeriveStageModel) => onUpdate({ ...stage, derives: next.columns })}
	/>
</div>
