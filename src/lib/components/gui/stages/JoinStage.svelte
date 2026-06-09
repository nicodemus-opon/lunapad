<script lang="ts">
	import type { JoinStage, JoinType, JoinCondition } from '$lib/types/gui-pipeline';
	import { InlineChipLabel } from '$lib/components/ui/inline-chip-label';
	import { ChipInput } from '$lib/components/ui/chip-input';
	import { pickJoinColumn } from '$lib/components/gui/chip-intelligence';
	import { Plus, X } from '@lucide/svelte';

	interface Props {
		stage: JoinStage;
		availableColumns: string[];
		availableTables: string[];
		onUpdate: (stage: JoinStage) => void;
	}

	let { stage, availableColumns, availableTables, onUpdate }: Props = $props();

	const JOIN_TYPES: { value: JoinType; short: string }[] = [
		{ value: 'inner', short: 'INNER' },
		{ value: 'left', short: 'LEFT' },
		{ value: 'right', short: 'RIGHT' },
		{ value: 'full', short: 'FULL' }
	];

	function updateCond(idx: number, patch: Partial<JoinCondition>) {
		const conditions = stage.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c));
		onUpdate({ ...stage, conditions });
	}

	function removeCond(idx: number) {
		onUpdate({ ...stage, conditions: stage.conditions.filter((_, i) => i !== idx) });
	}

	// ── Drag-to-reorder conditions ─────────────────────────────────────────────
	let dragCondIdx = $state<number | null>(null);

	function reorderConditions(from: number, to: number) {
		const conditions = [...stage.conditions];
		const [moved] = conditions.splice(from, 1);
		conditions.splice(to, 0, moved);
		onUpdate({ ...stage, conditions });
	}

	// ── Expanded condition idx ────────────────────────────────────────────────
	let expandedCondIdx = $state<number | null>(null);

	function addCondInline() {
		const newIdx = stage.conditions.length;
		const leftCol = pickJoinColumn(availableColumns);
		onUpdate({
			...stage,
			conditions: [
				...stage.conditions,
				{ left: leftCol, right: leftCol, shorthand: false }
			]
		});
		requestAnimationFrame(() => (expandedCondIdx = newIdx));
	}

	function humanizeCond(cond: JoinCondition): string {
		if (cond.shorthand) return `==${cond.left || '?'}`;
		const ref = stage.alias ?? stage.table;
		return `${cond.left || '?'} == ${ref}.${cond.right || '?'}`;
	}
</script>

<div class="flex items-center gap-1.5 flex-wrap">
	<!-- Main join chip: join type segmented + table reference -->
	<div
		class="inline-flex items-center rounded-full border border-chart-1 bg-muted/30 text-xs overflow-hidden group/pill shrink-0"
	>
		<!-- Join type segmented control (INNER/LEFT/RIGHT/FULL) — no popover needed -->
		<div class="flex border-r border-border/50">
			{#each JOIN_TYPES as jt}
				<button
					class="px-1.5 py-1 font-mono transition-colors text-[10px]
						{stage.joinType === jt.value
						? 'bg-primary/20 text-primary font-semibold'
						: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
					onclick={() => onUpdate({ ...stage, joinType: jt.value })}
					title="{jt.short} JOIN"
				>{jt.short}</button>
			{/each}
		</div>

		<!-- Alias (inline editable) -->
		{#if stage.alias !== undefined}
			<InlineChipLabel
				value={stage.alias}
				placeholder="alias…"
				class="px-1.5 py-1 font-mono text-xs text-muted-foreground"
				oncommit={(v) => onUpdate({ ...stage, alias: v || undefined })}
			/>
			<span class="py-1 text-muted-foreground/50 text-[10px] select-none">=</span>
		{/if}

		<!-- Table name (inline editable with autocomplete) -->
		<InlineChipLabel
			value={stage.table || ''}
			suggestions={availableTables}
			placeholder="table…"
			class="px-1.5 py-1 font-mono text-xs"
			oncommit={(v) => onUpdate({ ...stage, table: v, alias: stage.alias, conditions: stage.table !== v ? [] : stage.conditions })}
		/>

		<!-- Add alias button (if no alias yet) -->
		{#if stage.alias === undefined && stage.table}
			<button
				class="px-1.5 py-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors text-[10px] border-l border-border/40"
				onclick={() => onUpdate({ ...stage, alias: stage.table.slice(0, 1) })}
				title="Add alias"
			>≡</button>
		{/if}
	</div>

	{#if stage.table}
		<!-- "on" separator -->
		<span class="text-xs text-muted-foreground font-mono shrink-0">on</span>

		<!-- Condition pills -->
		{#each stage.conditions as cond, idx}
			<div
				role="listitem"
				draggable={expandedCondIdx !== idx}
				ondragstart={() => (dragCondIdx = idx)}
				ondragover={(e) => e.preventDefault()}
				ondrop={(e) => { e.preventDefault(); if (dragCondIdx !== null && dragCondIdx !== idx) { reorderConditions(dragCondIdx, idx); dragCondIdx = null; } }}
				ondragend={() => (dragCondIdx = null)}
				class="inline-flex items-center text-xs overflow-hidden shrink-0"
				class:opacity-40={dragCondIdx !== null && dragCondIdx === idx}
				class:cursor-grab={expandedCondIdx !== idx}
			>
				{#if expandedCondIdx === idx}
					<!-- Expanded inline form -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class="inline-flex items-center gap-1 rounded-lg border border-primary/50 bg-muted/30 px-1.5 py-0.5 ring-1 ring-primary/20"
						style="border-colorb: hsl(var(--chart-{(idx % 5) + 1}))"
						onkeydown={(e) => { if (e.key === 'Escape') expandedCondIdx = null; }}
						role="group"
					>
						{#if cond.shorthand}
							<span class="text-muted-foreground/60 font-mono text-[10px] select-none">==</span>
							<ChipInput
								value={cond.left}
								suggestions={availableColumns}
								placeholder="shared col…"
								class="font-mono text-xs"
								oninput={(v) => updateCond(idx, { left: v, right: v })}
							/>
						{:else}
							<ChipInput
								value={cond.left}
								suggestions={availableColumns}
								placeholder="left col…"
								class="font-mono text-xs"
								oninput={(v) => updateCond(idx, { left: v })}
							/>
							<span class="text-muted-foreground/60 font-mono text-[10px] select-none px-0.5">==</span>
							<span class="text-muted-foreground/50 text-[10px] select-none font-mono">{stage.alias ?? stage.table}.</span>
							<ChipInput
								value={cond.right}
								suggestions={[]}
								placeholder="right col…"
								class="font-mono text-xs"
								oninput={(v) => updateCond(idx, { right: v })}
							/>
						{/if}
						<!-- shorthand toggle -->
						<button
							class="text-[9px] px-1 py-0.5 rounded border text-muted-foreground/60 hover:text-muted-foreground transition-colors font-mono ml-0.5"
							onclick={() => updateCond(idx, { shorthand: !cond.shorthand, right: cond.shorthand ? '' : cond.left })}
							title="Toggle shorthand / full"
						>{cond.shorthand ? '==' : 'l==r'}</button>
						<button
							class="text-muted-foreground hover:text-primary transition-colors px-0.5"
							onclick={() => (expandedCondIdx = null)}
						>✓</button>
					</div>
				{:else}
					<!-- Collapsed pill -->
					<div
						class="inline-flex items-center rounded-full border bg-muted/30 overflow-hidden group/inner"
						style="border-colorb: hsl(var(--chart-{(idx % 5) + 1}))"
					>
						<button
							class="px-2.5 py-1 hover:bg-muted/60 transition-colors font-mono"
							onclick={() => (expandedCondIdx = idx)}
						>
							{humanizeCond(cond)}
						</button>
						<button
							class="px-1.5 py-1 text-muted-foreground opacity-0 group-hover/inner:opacity-100 hover:text-destructive transition-all"
							onclick={() => removeCond(idx)}
							aria-label="Remove condition"
						>
							<X class="w-3 h-3" />
						</button>
					</div>
				{/if}
			</div>
		{/each}

		<!-- Add ON condition — immediate inline -->
		<button
			class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
			onclick={addCondInline}
		>
			<Plus class="w-3 h-3" /> on
		</button>
	{/if}
</div>
