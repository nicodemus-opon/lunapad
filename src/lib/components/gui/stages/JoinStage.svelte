<script lang="ts">
	import type { JoinStage, JoinType, JoinCondition } from '$lib/types/gui-pipeline';
	import { InlineChipLabel } from '$lib/components/ui/inline-chip-label';
	import { ChipInput } from '$lib/components/ui/chip-input';
	import { pickJoinColumn } from '$lib/components/gui/chip-intelligence';
	import { Plus, X } from '@lucide/svelte';
	import { CHIP, CHIP_ADD, CHIP_EDITING, CHIP_META, CHIP_SECTION, CHIP_X } from '../chip-styles';

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
			conditions: [...stage.conditions, { left: leftCol, right: leftCol, shorthand: false }]
		});
		requestAnimationFrame(() => (expandedCondIdx = newIdx));
	}

	function humanizeCond(cond: JoinCondition): string {
		if (cond.shorthand) return `==${cond.left || '?'}`;
		const ref = stage.alias ?? stage.table;
		return `${cond.left || '?'} == ${ref}.${cond.right || '?'}`;
	}
</script>

<div class="flex flex-wrap items-center gap-1.5">
	<!-- Main join chip: join type segmented + table reference -->
	<div class={CHIP} data-testid="join-main-pill">
		<!-- Join type segmented control (inner/left/right/full) — no popover needed -->
		<div class="flex h-full border-r border-border/50">
			{#each JOIN_TYPES as jt}
				<button
					class="flex h-full items-center px-1.5 font-mono text-2xs transition-colors duration-150
						{stage.joinType === jt.value
						? 'bg-muted font-medium text-foreground'
						: 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'}"
					onclick={() => onUpdate({ ...stage, joinType: jt.value })}
					title="{jt.short} JOIN">{jt.value}</button
				>
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
			<span class={CHIP_META}>=</span>
		{/if}

		<!-- Table name (inline editable with autocomplete) -->
		<InlineChipLabel
			value={stage.table || ''}
			suggestions={availableTables}
			placeholder="table…"
			class="px-1.5 py-1 font-mono text-xs"
			oncommit={(v) =>
				onUpdate({
					...stage,
					table: v,
					alias: stage.alias,
					conditions: stage.table !== v ? [] : stage.conditions
				})}
		/>

		<!-- Add alias button (if no alias yet) -->
		{#if stage.alias === undefined && stage.table}
			<button
				class="flex h-full items-center px-1.5 text-2xs text-muted-foreground/50 transition-colors duration-150 hover:bg-muted/60 hover:text-muted-foreground"
				onclick={() => onUpdate({ ...stage, alias: stage.table.slice(0, 1) })}
				title="Add alias">≡</button
			>
		{/if}
	</div>

	{#if stage.table}
		<!-- "on" separator -->
		<span class="shrink-0 font-mono text-2xs text-muted-foreground/60">on</span>

		<!-- Condition pills -->
		{#each stage.conditions as cond, idx}
			<div
				role="listitem"
				draggable={expandedCondIdx !== idx}
				ondragstart={() => (dragCondIdx = idx)}
				ondragover={(e) => e.preventDefault()}
				ondrop={(e) => {
					e.preventDefault();
					if (dragCondIdx !== null && dragCondIdx !== idx) {
						reorderConditions(dragCondIdx, idx);
						dragCondIdx = null;
					}
				}}
				ondragend={() => (dragCondIdx = null)}
				class="inline-flex shrink-0 items-center text-xs"
				class:opacity-40={dragCondIdx !== null && dragCondIdx === idx}
				class:cursor-grab={expandedCondIdx !== idx}
			>
				{#if expandedCondIdx === idx}
					<!-- Expanded inline form -->
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<div
						class={CHIP_EDITING}
						onkeydown={(e) => {
							if (e.key === 'Escape') expandedCondIdx = null;
						}}
						role="group"
					>
						{#if cond.shorthand}
							<span class="{CHIP_META} font-mono">==</span>
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
							<span class="{CHIP_META} px-0.5 font-mono">==</span>
							<span class="{CHIP_META} font-mono">{stage.alias ?? stage.table}.</span>
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
							class="ml-0.5 rounded border border-border/60 px-1 py-0.5 font-mono text-2xs text-muted-foreground/60 transition-colors duration-150 hover:text-foreground"
							onclick={() =>
								updateCond(idx, {
									shorthand: !cond.shorthand,
									right: cond.shorthand ? '' : cond.left
								})}
							title="Toggle shorthand / full">{cond.shorthand ? '==' : 'l==r'}</button
						>
						<button
							class="px-1 text-muted-foreground transition-colors duration-150 hover:text-foreground"
							onclick={() => (expandedCondIdx = null)}>✓</button
						>
					</div>
				{:else}
					<!-- Collapsed pill -->
					<div class={CHIP}>
						<button class={CHIP_SECTION} onclick={() => (expandedCondIdx = idx)}>
							{humanizeCond(cond)}
						</button>
						<button class={CHIP_X} onclick={() => removeCond(idx)} aria-label="Remove condition">
							<X class="h-3 w-3" />
						</button>
					</div>
				{/if}
			</div>
		{/each}

		<!-- Add ON condition — immediate inline -->
		<button class={CHIP_ADD} onclick={addCondInline}>
			<Plus class="h-3 w-3" /> on
		</button>
	{/if}
</div>
