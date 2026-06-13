<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Sortable from 'sortablejs';
	import type { GUIPipelineStage, GUISourceSchema } from '$lib/types/gui-pipeline';
	import type { UploadedTable } from '$lib/stores/notebook.svelte';
	import type { ConnectionType } from '$lib/types/connection';
	import { getAvailableColumns, deriveChipErrors, reconcileStagesAfterSourceChange } from '$lib/services/gui-prql';
	import type { PRQLStageError } from '$lib/services/gui-prql';
	import {
		getIntelligentPresetSuggestions,
		getIntelligentQuickChips
	} from '$lib/services/intelligence-db';
	import {
		pickSelectColumn,
		pickSortColumn,
		pickSortDir,
		pickGroupByColumn,
		pickDefaultAgg,
		pickDefaultFilter,
		pickJoinColumn,
		pickDeriveColumn,
		makeIntelligentDefaultStage
	} from '$lib/components/gui/chip-intelligence';
	import type { QuickChip, StagePresetSuggestion } from '$lib/services/stage-catalog';
	import PipelineStageCard from './PipelineStageCard.svelte';
	import AddStageMenu from './AddStageMenu.svelte';
	import FromStage from './stages/FromStage.svelte';
	import AppendStage from './stages/AppendStage.svelte';
	import FilterStage from './stages/FilterStage.svelte';
	import SelectStage from './stages/SelectStage.svelte';
	import DeriveStage from './stages/DeriveStage.svelte';
	import GroupStage from './stages/GroupStage.svelte';
	import WindowStage from './stages/WindowStage.svelte';
	import LoopStage from './stages/LoopStage.svelte';
	import SortStage from './stages/SortStage.svelte';
	import TakeStage from './stages/TakeStage.svelte';
	import JoinStage from './stages/JoinStage.svelte';
	import RawStage from './stages/RawStage.svelte';

	interface Props {
		stages: GUIPipelineStage[];
		tables: UploadedTable[];
		prevCellSources: GUISourceSchema[];
		dark?: boolean;
		stageResultsCollapsed?: boolean[];
		stageErrorMap?: Map<number, PRQLStageError[]>;
		connectionId?: string;
		connectionType?: ConnectionType;
		onStagesChange: (stages: GUIPipelineStage[]) => void;
		onRunStage?: (upToStageIdx: number) => Promise<{ rows: Record<string, unknown>[]; columns: string[] } | { error: string }>;
		onStageResultCollapsedChange?: (stageIdx: number, collapsed: boolean) => void;
		onEscapeEditor?: () => void;
	}

	let {
		stages,
		tables,
		prevCellSources,
		dark = false,
		stageResultsCollapsed = [],
		stageErrorMap,
		connectionId = 'builtin.duckdb',
		connectionType = 'duckdb-wasm',
		onStagesChange,
		onRunStage,
		onStageResultCollapsedChange,
		onEscapeEditor
	}: Props = $props();

	const coercionDialect = $derived.by(() => {
		if (connectionType !== 'duckdb-wasm') return 'postgres'; // ANSI SQL, Trino-compatible
		return 'duckdb';
	});

	// Build schema map: tableName -> columns[]
	const tableSchemas = $derived(
		Object.fromEntries([
			...tables.map((t) => [t.name, t.columns] as const),
			...prevCellSources.map((source) => [source.name, source.columns] as const)
		]) as Record<string, string[]>
	);

	// All available source names (tables + prev cell views)
	const allSources = $derived.by(() => {
		const names: string[] = [];
		for (const table of tables) {
			if (!names.includes(table.name)) names.push(table.name);
		}
		for (const source of prevCellSources) {
			if (!names.includes(source.name)) names.push(source.name);
		}
		return names.sort((a, b) => a.localeCompare(b));
	});

	function updateStage(idx: number, stage: GUIPipelineStage) {
		const current = stages[idx];
		let next = stages.map((s, i) => (i === idx ? stage : s));
		if (idx === 0 && current?.type === 'from' && stage.type === 'from' && current.table !== stage.table) {
			next = reconcileStagesAfterSourceChange(next, tableSchemas);
		}
		onStagesChange(next);
	}

	function removeStage(idx: number) {
		stageKeys = stageKeys.filter((_, i) => i !== idx);
		onStagesChange(stages.filter((_, i) => i !== idx));
		if (activeStageIndex === null) return;
		if (activeStageIndex === idx) {
			const nextIdx = Math.max(0, idx - 1);
			activeStageIndex = nextIdx;
			focusStageCard(nextIdx);
			return;
		}
		if (activeStageIndex > idx) {
			activeStageIndex -= 1;
			focusStageCard(activeStageIndex);
		}
	}

	function addStage(stage: GUIPipelineStage) {
		stageUsage = { ...stageUsage, [stage.type]: (stageUsage[stage.type] ?? 0) + 1 };
		stageKeys = [...stageKeys, makeKey()];
		onStagesChange([...stages, stage]);
	}

	function addPreset(stagesToAdd: Exclude<GUIPipelineStage, { type: 'raw' }>[]) {
		if (stagesToAdd.length === 0) return;

		const usageDelta: Partial<Record<GUIPipelineStage['type'], number>> = {};
		for (const stage of stagesToAdd) {
			usageDelta[stage.type] = (usageDelta[stage.type] ?? 0) + 1;
		}

		stageUsage = {
			...stageUsage,
			...Object.fromEntries(
				Object.entries(usageDelta).map(([type, count]) => [
					type,
					(stageUsage[type as GUIPipelineStage['type']] ?? 0) + (count ?? 0)
				])
			)
		};

		stageKeys = [...stageKeys, ...stagesToAdd.map(() => makeKey())];
		onStagesChange([...stages, ...stagesToAdd]);
		activeStageIndex = stages.length;
	}

	function insertStageAfter(idx: number, stage: GUIPipelineStage) {
		stageUsage = { ...stageUsage, [stage.type]: (stageUsage[stage.type] ?? 0) + 1 };
		const insertAt = idx + 1;
		const nextKeys = [...stageKeys];
		nextKeys.splice(insertAt, 0, makeKey());
		stageKeys = nextKeys;
		const next = [...stages];
		next.splice(insertAt, 0, stage);
		onStagesChange(next);
		activeStageIndex = insertAt;
	}

	function duplicateStage(idx: number) {
		const source = stages[idx];
		if (!source) return;
		const clone = JSON.parse(JSON.stringify(source)) as GUIPipelineStage;
		insertStageAfter(idx, clone);
	}

	function moveStage(fromIdx: number, toIdx: number) {
		if (fromIdx === toIdx) return;
		if (fromIdx < 1 || toIdx < 1) return;
		if (fromIdx >= stages.length || toIdx >= stages.length) return;

		const next = [...stages];
		const [moved] = next.splice(fromIdx, 1);
		next.splice(toIdx, 0, moved);

		const nextKeys = [...stageKeys];
		const [movedKey] = nextKeys.splice(fromIdx, 1);
		nextKeys.splice(toIdx, 0, movedKey);
		stageKeys = nextKeys;

		onStagesChange(next);
		activeStageIndex = toIdx;
	}

	function activateStage(idx: number) {
		activeStageIndex = idx;
	}

	function focusStageCard(idx: number) {
		tick().then(() => {
			stageEditorEl?.querySelector<HTMLElement>(`[data-stage-index="${idx}"]`)?.focus();
		});
	}

	function addChipToStage(idx: number) {
		const stage = stages[idx];
		if (!stage) return;
		const cols = colsAt(idx);

		if (stage.type === 'derive') {
			const leftCol = pickDeriveColumn(cols);
			updateStage(idx, {
				...stage,
				columns: [
					...stage.columns,
					{
						name: '',
						expr: {
							mode: 'binary',
							left: { kind: 'column', value: leftCol },
							op: '+',
							right: { kind: 'literal', value: '0' }
						}
					}
				]
			});
			return;
		}

		if (stage.type === 'window') {
			const col = pickSortColumn(cols, stage.sortKeys.map((k) => k.column));
			updateStage(idx, {
				...stage,
				sortKeys: [...stage.sortKeys, { column: col, dir: pickSortDir(col) }]
			});
			return;
		}

		if (stage.type === 'filter') {
			const suggested = pickDefaultFilter(cols, stage.conditions);
			updateStage(idx, {
				...stage,
				conditions: [...stage.conditions, { column: suggested.column, op: suggested.op, value: suggested.value }]
			});
			return;
		}

		if (stage.type === 'sort') {
			const col = pickSortColumn(cols, stage.keys.map((k) => k.column));
			updateStage(idx, {
				...stage,
				keys: [...stage.keys, { column: col, dir: pickSortDir(col) }]
			});
			return;
		}

		if (stage.type === 'group') {
			const suggested = pickDefaultAgg(cols, stage.aggregations);
			updateStage(idx, {
				...stage,
				aggregations: [...stage.aggregations, { name: '', func: suggested.func, column: suggested.column }]
			});
			return;
		}

		if (stage.type === 'join') {
			const col = pickJoinColumn(cols);
			updateStage(idx, {
				...stage,
				conditions: [...stage.conditions, { left: col, right: col, shorthand: true }]
			});
			return;
		}

		if (stage.type === 'select') {
			const candidate = pickSelectColumn(cols, stage.columns);
			if (!candidate || stage.columns.includes(candidate)) return;
			updateStage(idx, { ...stage, columns: [...stage.columns, candidate] });
		}
	}

	function colsAt(idx: number): string[] {
		return getAvailableColumns(stages, tableSchemas, idx);
	}

	const menuColumns = $derived(colsAt(stages.length));
	let intelligentQuickChips = $state<QuickChip[]>([]);
	let intelligentPresets = $state<StagePresetSuggestion[]>([]);
	let quickChipLoadSeq = 0;

	$effect(() => {
		const seq = ++quickChipLoadSeq;
		const nextColumns = [...menuColumns];
		const nextStages = [...stages];
		const nextConnectionId = connectionId;
		const nextCoercionDialect = coercionDialect;
		void (async () => {
			const [chips, presets] = await Promise.all([
				getIntelligentQuickChips({
					connectionId: nextConnectionId,
					stages: nextStages,
					availableColumns: nextColumns,
					coercionDialect: nextCoercionDialect
				}),
				getIntelligentPresetSuggestions({
					connectionId: nextConnectionId,
					stages: nextStages,
					availableColumns: nextColumns,
					coercionDialect: nextCoercionDialect
				})
			]);
			if (seq !== quickChipLoadSeq) return;
			intelligentQuickChips = chips;
			intelligentPresets = presets;
		})();
	});

	// ── Stable stage keys for {#each} — prevents Svelte fighting SortableJS ──
	function makeKey() { return Math.random().toString(36).slice(2, 10); }
	let stageKeys = $state<string[]>([]);
	let stageUsage = $state<Partial<Record<GUIPipelineStage['type'], number>>>({});
	let activeStageIndex = $state<number | null>(null);
	let stageEditorEl = $state<HTMLElement | undefined>();
	let collapsedStages = $state<Set<number>>(new Set());

	function toggleCollapse(idx: number) {
		const next = new Set(collapsedStages);
		if (next.has(idx)) next.delete(idx);
		else next.add(idx);
		collapsedStages = next;
	}

	// Keep stageKeys length in sync when stages are added/removed externally
	$effect(() => {
		const n = stages.length;
		if (stageKeys.length !== n) {
			stageKeys = Array.from({ length: n }, (_, i) => stageKeys[i] ?? makeKey());
		}
	});

	$effect(() => {
		if (activeStageIndex === null) return;
		if (stages.length === 0) {
			activeStageIndex = null;
			return;
		}
		if (activeStageIndex > stages.length - 1) {
			activeStageIndex = stages.length - 1;
		}
	});

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName.toLowerCase();
		return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
	}

	function isEventInsideEditor(target: EventTarget | null): boolean {
		if (!stageEditorEl || !(target instanceof Node)) return false;
		return stageEditorEl.contains(target);
	}

	function onWindowKeydown(event: KeyboardEvent) {
		// Escape from a chip input → focus the parent stage card (not cell command mode)
		if (event.key === 'Escape' && isTypingTarget(event.target) && isEventInsideEditor(event.target)) {
			event.preventDefault();
			event.stopPropagation(); // prevent cell container's broader Escape handler
			const card = (event.target as Element).closest<HTMLElement>('[data-stage-index]');
			card?.focus();
			return;
		}

		if (isTypingTarget(event.target)) return;
		if (!isEventInsideEditor(event.target) && !isEventInsideEditor(document.activeElement)) return;

		const idx = activeStageIndex;
		if (idx === null) {
			// Even with no active stage, Escape from inside the editor exits to cell command mode
			if (event.key === 'Escape') {
				event.preventDefault();
				onEscapeEditor?.();
			}
			return;
		}
		const key = event.key.toLowerCase();

		if (key === 'x' || event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			if (idx > 0) removeStage(idx);
			return;
		}

		if (event.shiftKey && key === 'd') {
			event.preventDefault();
			duplicateStage(idx);
			return;
		}

		if (key === 'v') {
			const current = stages[idx];
			if (!current || idx === 0) return;
			event.preventDefault();
			updateStage(idx, { ...current, disabled: !current.disabled });
			return;
		}

		if (event.shiftKey && key === 'k') {
			event.preventDefault();
			moveStage(idx, idx - 1);
			return;
		}

		if (event.shiftKey && key === 'j') {
			event.preventDefault();
			moveStage(idx, idx + 1);
			return;
		}

		if (key === 'k') {
			event.preventDefault();
			if (idx > 0) {
				activeStageIndex = idx - 1;
				focusStageCard(idx - 1);
			}
			// at first stage: stay put — only Escape exits stage mode
			return;
		}

		if (key === 'j') {
			event.preventDefault();
			if (idx < stages.length - 1) {
				activeStageIndex = idx + 1;
				focusStageCard(idx + 1);
			}
			// at last stage: stay put — only Escape exits stage mode
			return;
		}

		if (key === 'n') {
			event.preventDefault();
			addChipToStage(idx);
			return;
		}

		if (key === 'c') {
			event.preventDefault();
			toggleCollapse(idx);
			return;
		}

		if (key === 'r') {
			event.preventDefault();
			onRunStage?.(idx);
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			activeStageIndex = null;
			onEscapeEditor?.();
		}
	}

	// ── Drag-and-drop ──────────────────────────────────────────────────────────
	let stageListEl: HTMLElement | undefined = $state();

	onMount(() => {
		if (!stageListEl) return;
		const sortable = Sortable.create(stageListEl, {
			handle: '[data-drag-handle]',
			animation: 150,
			ghostClass: 'stage-sort-ghost',
			chosenClass: 'stage-sort-chosen',
			dragClass: 'stage-sort-drag',
			// Use a body-appended ghost so overflow:hidden on the container doesn't clip it
			forceFallback: false,
			onEnd(evt) {
				const oldIdx = evt.oldIndex ?? 0;
				const newIdx = evt.newIndex ?? 0;
				if (oldIdx === newIdx) return;
				// Lock the first (from) stage in place
				if (oldIdx === 0 || newIdx === 0) {
					// Force Svelte to re-render, undoing the DOM move
					onStagesChange([...stages]);
					return;
				}
				const next = [...stages];
				const [moved] = next.splice(oldIdx, 1);
				next.splice(newIdx, 0, moved);

				// Reorder stageKeys in parallel so Svelte tracks the moved card
				const nextKeys = [...stageKeys];
				const [movedKey] = nextKeys.splice(oldIdx, 1);
				nextKeys.splice(newIdx, 0, movedKey);
				stageKeys = nextKeys;

				onStagesChange(next);
			}
		});
		return () => sortable.destroy();
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- Pipeline stages -->
<div bind:this={stageEditorEl} class="stage-editor" role="region" aria-label="Pipeline stages">
	<div class="stage-wrapper">
		<div bind:this={stageListEl} class="stage-stack">
			{#each stages as stage, idx (stageKeys[idx] ?? idx)}
				{#if idx > 0}
					<!-- Insert-between zone -->
					<div class="insert-zone group/insert">
						<div class="insert-zone-line"></div>
						<div class="insert-zone-pills">
							{#each (['filter', 'select', 'derive', 'sort', 'group'] as const) as stageType}
								<button
									class="insert-type-btn"
									onclick={() => insertStageAfter(idx - 1, makeIntelligentDefaultStage(stageType, colsAt(idx)))}
									title="Insert {stageType} after stage {idx}"
								>{stageType}</button>
							{/each}
						</div>
					</div>
				{/if}
				<div class="stage-item" style={`--stage-enter-delay: ${Math.min(idx, 7) * 26}ms`}>
				<PipelineStageCard
					{stage}
					index={idx}
					active={activeStageIndex === idx}
					draggable={idx > 0}
					isLast={idx === stages.length - 1}
					collapsed={collapsedStages.has(idx)}
					onCollapsedChange={() => toggleCollapse(idx)}
					resultCollapsed={stageResultsCollapsed[idx] ?? false}
					stageErrors={stageErrorMap?.get(idx) ?? []}
					onActivate={() => activateStage(idx)}
					onResultCollapsedChange={(c) => onStageResultCollapsedChange?.(idx, c)}
					onRemove={idx > 0 ? () => removeStage(idx) : undefined}
					onToggleDisabled={idx > 0 ? () => updateStage(idx, { ...stage, disabled: !stage.disabled }) : undefined}
					onRun={onRunStage ? () => onRunStage(idx) : undefined}
					onAddSort={(col, dir) => insertStageAfter(idx, { type: 'sort', keys: [{ column: col, dir }] })}
					onAddFilter={(col) => insertStageAfter(idx, { type: 'filter', conditions: [{ column: col, op: '==', value: '' }], logic: 'and' })}
					onAddSuggestedStage={(nextStage) => insertStageAfter(idx, nextStage)}
				>
					{#if stage.type === 'from'}
						<FromStage
							{stage}
							availableTables={allSources}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
						/>
					{:else if stage.type === 'append'}
						<AppendStage
							{stage}
							availableTables={allSources}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
						/>
					{:else if stage.type === 'filter'}
						<FilterStage
							{stage}
							availableColumns={colsAt(idx)}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
							getUpstreamData={onRunStage && idx > 0 ? () => onRunStage(idx - 1) : undefined}
						/>
					{:else if stage.type === 'select'}
						<SelectStage
							{stage}
							availableColumns={colsAt(idx)}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
						/>
					{:else if stage.type === 'derive'}
						<DeriveStage
							{stage}
							availableColumns={colsAt(idx)}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
							erroredChipIndices={(() => { const e = stageErrorMap?.get(idx); return e?.length ? deriveChipErrors(stage, e) : undefined; })()}
						/>
					{:else if stage.type === 'group'}
						<GroupStage
							{stage}
							availableColumns={colsAt(idx)}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
						/>
					{:else if stage.type === 'window'}
						<WindowStage
							{stage}
							availableColumns={colsAt(idx)}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
						/>
					{:else if stage.type === 'loop'}
						<LoopStage
							{stage}
							availableColumns={colsAt(idx)}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
						/>
					{:else if stage.type === 'sort'}
						<SortStage
							{stage}
							availableColumns={colsAt(idx)}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
						/>
					{:else if stage.type === 'take'}
						<TakeStage
							{stage}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
						/>
					{:else if stage.type === 'join'}
						<JoinStage
							{stage}
							availableColumns={colsAt(idx)}
							availableTables={allSources}
							onUpdate={(s: GUIPipelineStage) => updateStage(idx, s)}
						/>
					{:else if stage.type === 'raw'}
						<RawStage {stage} />
					{/if}
				</PipelineStageCard>
			</div>
		{/each}
		</div><!-- end stage-stack -->
	</div><!-- end stage-wrapper -->

	<AddStageMenu
		onAdd={addStage}
		onAddPreset={addPreset}
		{stages}
		{connectionId}
		keyboardScope={stageEditorEl}
		availableColumns={menuColumns}
		availableColumnCount={menuColumns.length}
		recentUsage={stageUsage}
		quickChips={intelligentQuickChips}
		presetSuggestions={intelligentPresets}
	/>
</div>

<style>
	.stage-editor {
		position: relative;
		padding: 0.2rem 0 0.4rem;
	}

	.stage-stack {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.stage-wrapper {
		position: relative;
	}

	:global(.stage-editor [data-slot='input']),
	:global(.stage-editor [data-slot='select-trigger']) {
		border-radius: var(--radius-sm);
	}

	:global(.stage-editor [data-slot='input']) {
		padding-inline: 0.5rem;
	}

	:global(.stage-editor [data-slot='select-trigger']) {
		padding-left: 0.5rem;
		padding-right: 0.4rem;
	}

	.stage-item {
		position: relative;
		/* backwards: only fills before animation starts (prevents flash), element returns
		   to natural state (no transform/filter) after — avoids creating a containing block
		   for position:fixed descendants (chip dropdowns, popovers) */
		animation: gui-stage-enter var(--motion-medium) var(--motion-ease-flow) backwards;
		animation-delay: var(--stage-enter-delay, 0ms);
	}

	/* ── Insert-between zone ── */
	.insert-zone {
		position: relative;
		height: 0.875rem;
		display: flex;
		align-items: center;
		margin-inline-start: 2.25rem;
		margin-inline-end: 0.5rem;
	}

	.insert-zone-line {
		position: absolute;
		inset: 50% 0;
		height: 1px;
		background: hsl(var(--primary) / 0);
		transition: background var(--motion-fast) var(--motion-ease-out);
		pointer-events: none;
	}

	.insert-zone:hover .insert-zone-line,
	.insert-zone:focus-within .insert-zone-line {
		background: hsl(var(--border));
	}

	.insert-zone-pills {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		gap: 0.25rem;
		opacity: 0;
		transition: opacity var(--motion-fast) var(--motion-ease-out);
		pointer-events: none;
	}

	.insert-zone:hover .insert-zone-pills,
	.insert-zone:focus-within .insert-zone-pills {
		opacity: 1;
		pointer-events: auto;
	}

	.insert-type-btn {
		font-size: var(--text-2xs, 0.6875rem);
		line-height: 1;
		padding: 0.15rem 0.45rem;
		border-radius: calc(var(--radius) - 2px);
		border: 1px solid hsl(var(--border));
		background: hsl(var(--background));
		color: hsl(var(--muted-foreground));
		font-family: var(--font-mono, monospace);
		cursor: pointer;
		transition:
			background var(--motion-fast) var(--motion-ease-out),
			color var(--motion-fast) var(--motion-ease-out);
		white-space: nowrap;
	}

	.insert-type-btn:hover {
		background: hsl(var(--muted));
		color: hsl(var(--foreground));
	}

	:global(.stage-editor .stage-sort-ghost [data-testid='stage-card']) {
		opacity: 0.4;
		background: hsl(var(--muted) / 0.4);
	}

	:global(.stage-editor .stage-sort-chosen [data-testid='stage-card']) {
		background: hsl(var(--muted) / 0.4);
		box-shadow: inset 0 0 0 1px hsl(var(--ring) / 0.35);
	}
</style>
