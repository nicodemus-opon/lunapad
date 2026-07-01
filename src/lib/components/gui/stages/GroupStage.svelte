<script lang="ts">
	import type {
		GroupStage,
		AggFunc,
		AggregationRow,
		SortKey,
		DeriveStage as DeriveStageModel
	} from '$lib/types/gui-pipeline';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import { ColumnInput } from '$lib/components/ui/column-input';
	import { ArrowUp, ArrowDown, Plus, X } from '@lucide/svelte';
	import DeriveStageEditor from './DeriveStage.svelte';
	import { InlineChipLabel } from '$lib/components/ui/inline-chip-label';
	import { ChipInput } from '$lib/components/ui/chip-input';
	import { pickDefaultAgg, pickGroupByColumn } from '$lib/components/gui/chip-intelligence';
	import { Button } from '$lib/components/ui/button';
	import {
		CHIP,
		CHIP_ADD,
		CHIP_EDITING,
		CHIP_INVALID,
		CHIP_META,
		CHIP_SECTION,
		CHIP_SELECT,
		CHIP_X,
		SECTION_LABEL
	} from '../chip-styles';

	interface Props {
		stage: GroupStage;
		availableColumns: string[];
		onUpdate: (stage: GroupStage) => void;
	}

	let { stage, availableColumns, onUpdate }: Props = $props();

	// ── Aggregate mode ───────────────────────────────────────────────────────

	const AGG_FUNCS: { value: AggFunc; label: string }[] = [
		{ value: 'sum', label: 'sum()' },
		{ value: 'avg', label: 'avg()' },
		{ value: 'average', label: 'average()' },
		{ value: 'count', label: 'count()' },
		{ value: 'count_distinct', label: 'count distinct' },
		{ value: 'min', label: 'min()' },
		{ value: 'max', label: 'max()' },
		{ value: 'stddev', label: 'stddev()' },
		{ value: 'all', label: 'all()' },
		{ value: 'any', label: 'any()' },
		{ value: 'concat_array', label: 'concat_array()' },
		{ value: 'first', label: 'first()' },
		{ value: 'last', label: 'last()' }
	];

	const noColFuncs: AggFunc[] = ['count'];
	const STRUCTURED_AGG_FUNCS: Exclude<AggFunc, 'raw'>[] = [
		'sum',
		'avg',
		'average',
		'count',
		'count_distinct',
		'min',
		'max',
		'stddev',
		'all',
		'any',
		'concat_array',
		'first',
		'last'
	];
	const STRUCTURED_AGG_OPS = ['+', '-', '*', '/'] as const;

	type StructuredAggFunc = Exclude<AggFunc, 'raw'>;
	type StructuredAggOp = (typeof STRUCTURED_AGG_OPS)[number];

	interface StructuredAggTerm {
		func: StructuredAggFunc;
		column: string;
	}

	interface StructuredAggExpr {
		left: StructuredAggTerm;
		op: StructuredAggOp;
		right: StructuredAggTerm;
	}

	let rawAggStructuredMode = $state<Record<number, boolean>>({});

	function unquoteAggColumn(column: string): string {
		const t = column.trim();
		if (t === 'this') return '';
		if (t.startsWith('`') && t.endsWith('`')) return t.slice(1, -1);
		return t;
	}

	function parseStructuredAggTerm(text: string): StructuredAggTerm | null {
		const trimmed = text.trim();
		const match =
			/^(sum|avg|average|count_distinct|count|min|max|stddev|all|any|concat_array|first|last)(?:\s+([\s\S]+))?$/i.exec(
				trimmed
			);
		if (!match) return null;
		const func = match[1].toLowerCase() as StructuredAggFunc;
		const rawColumn = (match[2] ?? '').trim();
		const column = unquoteAggColumn(rawColumn);
		if (func !== 'count' && !column) return null;
		return { func, column };
	}

	function parseStructuredAggExpr(expr: string): StructuredAggExpr | null {
		const trimmed = expr.trim();
		const match = /^([\s\S]+?)\s*([+\-*/])\s*([\s\S]+)$/.exec(trimmed);
		if (!match) return null;
		const left = parseStructuredAggTerm(match[1]);
		const right = parseStructuredAggTerm(match[3]);
		if (!left || !right) return null;
		return {
			left,
			op: match[2] as StructuredAggOp,
			right
		};
	}

	function defaultStructuredAggExpr(): StructuredAggExpr {
		const seedCol = availableColumns[0] ?? '';
		return {
			left: { func: seedCol ? 'sum' : 'count', column: seedCol },
			op: '-',
			right: { func: 'count', column: '' }
		};
	}

	function structuredAggTermToExpr(term: StructuredAggTerm): string {
		if (term.func === 'count' && !term.column.trim()) return 'count';
		return `${term.func} ${term.column}`.trim();
	}

	function structuredAggExprToString(expr: StructuredAggExpr): string {
		return `${structuredAggTermToExpr(expr.left)} ${expr.op} ${structuredAggTermToExpr(expr.right)}`;
	}

	function isRawAggStructured(idx: number, agg: AggregationRow): boolean {
		if (!isRawAgg(agg)) return false;
		const forced = rawAggStructuredMode[idx];
		if (forced !== undefined) return forced;
		return parseStructuredAggExpr(agg.expr ?? '') !== null;
	}

	function canUseStructuredRawAgg(agg: AggregationRow): boolean {
		return isRawAgg(agg) && parseStructuredAggExpr(agg.expr ?? '') !== null;
	}

	function setRawAggMode(idx: number, agg: AggregationRow, structured: boolean) {
		if (!isRawAgg(agg)) return;
		if (!structured) {
			rawAggStructuredMode = { ...rawAggStructuredMode, [idx]: false };
			return;
		}

		if (!canUseStructuredRawAgg(agg)) {
			rawAggStructuredMode = { ...rawAggStructuredMode, [idx]: false };
			return;
		}

		rawAggStructuredMode = { ...rawAggStructuredMode, [idx]: true };
	}

	function updateStructuredRawAggExpr(idx: number, patch: Partial<StructuredAggExpr>) {
		const agg = stage.aggregations[idx];
		if (!agg || !isRawAgg(agg)) return;
		const current = parseStructuredAggExpr(agg.expr ?? '') ?? defaultStructuredAggExpr();
		const next: StructuredAggExpr = {
			left: patch.left ?? current.left,
			op: patch.op ?? current.op,
			right: patch.right ?? current.right
		};
		updateAgg(idx, { expr: structuredAggExprToString(next) });
	}

	function updateStructuredRawAggTerm(
		idx: number,
		side: 'left' | 'right',
		patch: Partial<StructuredAggTerm>
	) {
		const agg = stage.aggregations[idx];
		if (!agg || !isRawAgg(agg)) return;
		const current = parseStructuredAggExpr(agg.expr ?? '') ?? defaultStructuredAggExpr();
		const term = current[side];
		const nextTerm: StructuredAggTerm = {
			func: patch.func ?? term.func,
			column: patch.column ?? term.column
		};
		if (nextTerm.func === 'count' && !nextTerm.column) {
			nextTerm.column = '';
		}
		updateStructuredRawAggExpr(idx, { [side]: nextTerm } as Partial<StructuredAggExpr>);
	}

	function isRawAgg(agg: AggregationRow): boolean {
		return agg.func === 'raw';
	}

	function humanizeAgg(agg: AggregationRow): string {
		if (isRawAgg(agg)) {
			const expr = agg.expr?.trim() || '?';
			return agg.name ? `${agg.name} = ${expr}` : expr;
		}
		const col = agg.column || '?';
		const expr = noColFuncs.includes(agg.func) ? `${agg.func}()` : `${agg.func}(${col})`;
		return agg.name ? `${agg.name} = ${expr}` : expr;
	}

	function updateAgg(idx: number, patch: Partial<AggregationRow>) {
		const aggregations = stage.aggregations.map((a, i) => (i === idx ? { ...a, ...patch } : a));
		onUpdate({ ...stage, aggregations });
	}

	function removeAgg(idx: number) {
		onUpdate({ ...stage, aggregations: stage.aggregations.filter((_, i) => i !== idx) });
	}

	// ── Expanded inline agg chip ────────────────────────────────────────────
	let expandedAggIdx = $state<number | null>(null);

	function addAggInline() {
		const newIdx = stage.aggregations.length;
		const suggested = pickDefaultAgg(availableColumns, stage.aggregations);
		onUpdate({
			...stage,
			aggregations: [
				...stage.aggregations,
				{ name: '', func: suggested.func, column: suggested.column }
			]
		});
		requestAnimationFrame(() => (expandedAggIdx = newIdx));
	}

	// ── Window mode ─────────────────────────────────────────────────────────

	function toggleWindowSortDir(idx: number) {
		const sortKeys = stage.window!.sortKeys.map((k, i) =>
			i === idx ? ({ ...k, dir: k.dir === 'asc' ? 'desc' : 'asc' } as SortKey) : k
		);
		onUpdate({ ...stage, window: { ...stage.window!, sortKeys } });
	}

	function removeWindowSortKey(idx: number) {
		const sortKeys = stage.window!.sortKeys.filter((_, i) => i !== idx);
		onUpdate({ ...stage, window: { ...stage.window!, sortKeys } });
	}

	let addWindowSortOpen = $state(false);
	let draftSortCol = $state('');

	function confirmAddWindowSort() {
		const col = draftSortCol.trim();
		if (!col) return;
		onUpdate({
			...stage,
			window: {
				...stage.window!,
				sortKeys: [...stage.window!.sortKeys, { column: col, dir: 'asc' }]
			}
		});
		draftSortCol = '';
		addWindowSortOpen = false;
	}

	// ── Shared: group-by ────────────────────────────────────────────────────

	function removeGroupBy(col: string) {
		onUpdate({ ...stage, by: stage.by.filter((c) => c !== col) });
	}

	function addGroupBy(col: string) {
		if (!stage.by.includes(col)) onUpdate({ ...stage, by: [...stage.by, col] });
	}

	// ── Drag-to-reorder ─────────────────────────────────────────────────────
	let dragAggIdx = $state<number | null>(null);
	let dragByIdx = $state<number | null>(null);
	let dragWinSortIdx = $state<number | null>(null);

	function reorderAggs(from: number, to: number) {
		const aggregations = [...stage.aggregations];
		const [moved] = aggregations.splice(from, 1);
		aggregations.splice(to, 0, moved);
		onUpdate({ ...stage, aggregations });
	}

	function reorderBy(from: number, to: number) {
		const by = [...stage.by];
		const [moved] = by.splice(from, 1);
		by.splice(to, 0, moved);
		onUpdate({ ...stage, by });
	}

	function reorderWinSortKeys(from: number, to: number) {
		const sortKeys = [...stage.window!.sortKeys];
		const [moved] = sortKeys.splice(from, 1);
		sortKeys.splice(to, 0, moved);
		onUpdate({ ...stage, window: { ...stage.window!, sortKeys } });
	}

	// ── Pending new by-column (replaces add popover) ────────────────────────
	let pendingNewBy = $state(false);
	let pendingNewByValue = $state('');

	function commitAddBy(col: string) {
		const trimmed = col.trim();
		if (trimmed && !stage.by.includes(trimmed)) {
			onUpdate({ ...stage, by: [...stage.by, trimmed] });
		}
		pendingNewBy = false;
	}

	function renameBy(idx: number, newVal: string) {
		const trimmed = newVal.trim();
		if (!trimmed || (stage.by.includes(trimmed) && stage.by[idx] !== trimmed)) return;
		const by = stage.by.map((c, i) => (i === idx ? trimmed : c));
		onUpdate({ ...stage, by });
	}

	function removeGroupByIdx(idx: number) {
		onUpdate({ ...stage, by: stage.by.filter((_, i) => i !== idx) });
	}
</script>

<div class="flex w-full flex-col gap-1.5">
	<!-- ── Top row: aggregate / window chips ──────────────────────────────── -->
	<div class="flex flex-wrap items-center gap-1.5">
		{#if stage.window}
			<!-- ── Window mode: sort keys + window derive columns ────────────── -->

			<!-- Sort key pills -->
			{#each stage.window.sortKeys as key, idx (`${key.column}-${key.dir}-${idx}`)}
				<div
					role="listitem"
					draggable="true"
					ondragstart={() => (dragWinSortIdx = idx)}
					ondragover={(e) => e.preventDefault()}
					ondrop={(e) => {
						e.preventDefault();
						if (dragWinSortIdx !== null && dragWinSortIdx !== idx) {
							reorderWinSortKeys(dragWinSortIdx, idx);
							dragWinSortIdx = null;
						}
					}}
					ondragend={() => (dragWinSortIdx = null)}
					class="{CHIP} cursor-grab active:cursor-grabbing"
					class:opacity-40={dragWinSortIdx !== null && dragWinSortIdx === idx}
				>
					<button
						class="{CHIP_SECTION} gap-1"
						onclick={() => toggleWindowSortDir(idx)}
						title="Toggle sort direction"
					>
						{#if key.dir === 'asc'}
							<ArrowUp class="h-3 w-3 text-muted-foreground" />
						{:else}
							<ArrowDown class="h-3 w-3 text-muted-foreground" />
						{/if}
						{key.column}
					</button>
					<button
						class={CHIP_X}
						onclick={() => removeWindowSortKey(idx)}
						aria-label="Remove sort key"
					>
						<X class="h-3 w-3" />
					</button>
				</div>
			{/each}

			<!-- Add sort key -->
			<Popover.Root bind:open={addWindowSortOpen}>
				<Popover.Trigger class={CHIP_ADD} title="Add sort key">
					<ArrowUp class="h-3 w-3" />
					<Plus class="h-3 w-3" />
				</Popover.Trigger>
				<Popover.Content class="w-48 p-2">
					<ColumnInput
						value={draftSortCol}
						suggestions={availableColumns}
						placeholder="column…"
						onchange={(v) => (draftSortCol = v)}
					/>
					<Button size="sm" class="mt-1 w-full" onclick={confirmAddWindowSort}>Add sort key</Button>
				</Popover.Content>
			</Popover.Root>

			<!-- Separator arrow -->
			<span class="px-0.5 text-xs text-muted-foreground/50">↳</span>
			<div class="h-0 basis-full"></div>
			<DeriveStageEditor
				stage={{ type: 'derive', columns: stage.window.derives }}
				{availableColumns}
				onUpdate={(next: DeriveStageModel) =>
					onUpdate({
						...stage,
						window: {
							...stage.window!,
							derives: next.columns
						}
					})}
			/>
		{:else}
			<!-- ── Aggregate mode ──────────────────────────────────────────────── -->
			<span class="{SECTION_LABEL} w-8 shrink-0 pr-1.5 text-right">agg</span>

			{#if stage.aggregations.length === 0}
				<span class="text-xs text-muted-foreground/60 italic">none</span>
			{/if}

			{#each stage.aggregations as agg, idx (`${agg.name}-${agg.func}-${idx}`)}
				<div
					role="listitem"
					draggable={expandedAggIdx !== idx}
					ondragstart={() => (dragAggIdx = idx)}
					ondragover={(e) => e.preventDefault()}
					ondrop={(e) => {
						e.preventDefault();
						if (dragAggIdx !== null && dragAggIdx !== idx) {
							reorderAggs(dragAggIdx, idx);
							dragAggIdx = null;
						}
					}}
					ondragend={() => (dragAggIdx = null)}
					class="group/pill inline-flex shrink-0 items-center text-xs"
					class:cursor-grab={expandedAggIdx !== idx}
					class:opacity-40={dragAggIdx !== null && dragAggIdx === idx}
				>
					{#if expandedAggIdx === idx && !isRawAgg(agg)}
						<!-- ── Expanded inline form for structured aggs ── -->
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							class={CHIP_EDITING}
							onkeydown={(e) => {
								if (e.key === 'Escape') expandedAggIdx = null;
							}}
							onfocusout={(e) => {
								if (!e.currentTarget.contains(e.relatedTarget as Node | null))
									expandedAggIdx = null;
							}}
							role="group"
						>
							<!-- Alias (optional) -->
							<ChipInput
								value={agg.name}
								placeholder="alias…"
								class="font-mono text-xs text-muted-foreground"
								oninput={(v) => updateAgg(idx, { name: v })}
							/>
							{#if agg.name}
								<span class={CHIP_META}>=</span>
							{/if}

							<!-- Function selector (native select, styled inline) -->
							<select
								value={agg.func}
								class="{CHIP_SELECT} text-foreground"
								onchange={(e) =>
									updateAgg(idx, { func: (e.target as HTMLSelectElement).value as AggFunc })}
							>
								{#each AGG_FUNCS as f (f.value)}
									<option value={f.value}>{f.value}</option>
								{/each}
							</select>
							<span class="{CHIP_META} font-mono">(</span>

							<!-- Column input (hidden for count) -->
							{#if !noColFuncs.includes(agg.func)}
								<ChipInput
									value={agg.column}
									suggestions={availableColumns}
									placeholder="col…"
									class="font-mono text-xs"
									data-testid="group-agg-column"
									oninput={(v) => updateAgg(idx, { column: v })}
								/>
							{/if}
							<span class="{CHIP_META} font-mono">)</span>

							<!-- Confirm -->
							<button
								class="px-1 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
								onclick={() => (expandedAggIdx = null)}
								aria-label="Done editing">✓</button
							>
						</div>
					{:else if isRawAgg(agg)}
						<!-- Raw agg: keep the existing popover (complex structured expr) -->
						<div class="{CHIP} cursor-grab">
							<Popover.Root>
								<Popover.Trigger class={CHIP_SECTION}>
									{humanizeAgg(agg)}
								</Popover.Trigger>
								<Popover.Content class="w-64 space-y-2 p-3">
									<Input
										class="h-7 font-mono text-xs"
										placeholder="alias (optional)…"
										value={agg.name}
										oninput={(e) => updateAgg(idx, { name: (e.target as HTMLInputElement).value })}
									/>
									<div class="space-y-2">
										<div class="flex items-center gap-2">
											<button
												class="h-7 rounded border px-2 font-mono text-xs transition-colors duration-150 {isRawAggStructured(
													idx,
													agg
												)
													? 'border-primary/40 bg-primary/10 text-primary'
													: 'border-border/70 text-muted-foreground hover:bg-muted/40 hover:text-foreground'} disabled:cursor-not-allowed disabled:opacity-50"
												disabled={!canUseStructuredRawAgg(agg) && !isRawAggStructured(idx, agg)}
												title={!canUseStructuredRawAgg(agg) && !isRawAggStructured(idx, agg)
													? 'Structured mode requires a parseable aggregate expression'
													: undefined}
												onclick={() => setRawAggMode(idx, agg, true)}>structured</button
											>
											<button
												class="h-7 rounded border px-2 font-mono text-xs transition-colors duration-150 {!isRawAggStructured(
													idx,
													agg
												)
													? 'border-primary/40 bg-primary/10 text-primary'
													: 'border-border/70 text-muted-foreground hover:bg-muted/40 hover:text-foreground'}"
												onclick={() => setRawAggMode(idx, agg, false)}>raw</button
											>
										</div>
										{#if isRawAggStructured(idx, agg)}
											{@const parsed =
												parseStructuredAggExpr(agg.expr ?? '') ?? defaultStructuredAggExpr()}
											<div class="space-y-2 rounded border bg-muted/20 p-2">
												<div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
													<div class="space-y-1">
														<Select.Root
															type="single"
															value={parsed.left.func}
															onValueChange={(v) =>
																updateStructuredRawAggTerm(idx, 'left', {
																	func: v as StructuredAggFunc
																})}
														>
															<Select.Trigger class="h-7 w-full text-xs"
																>{parsed.left.func}</Select.Trigger
															>
															<Select.Content
																>{#each STRUCTURED_AGG_FUNCS as func (func)}<Select.Item
																		value={func}
																		class="text-xs">{func}</Select.Item
																	>{/each}</Select.Content
															>
														</Select.Root>
														{#if parsed.left.func !== 'count'}
															<ColumnInput
																value={parsed.left.column}
																suggestions={availableColumns}
																placeholder="column…"
																onchange={(v) =>
																	updateStructuredRawAggTerm(idx, 'left', { column: v })}
															/>
														{/if}
													</div>
													<Select.Root
														type="single"
														value={parsed.op}
														onValueChange={(v) =>
															updateStructuredRawAggExpr(idx, { op: v as StructuredAggOp })}
													>
														<Select.Trigger class="h-7 w-14 text-xs">{parsed.op}</Select.Trigger>
														<Select.Content
															>{#each STRUCTURED_AGG_OPS as op (op)}<Select.Item
																	value={op}
																	class="text-xs">{op}</Select.Item
																>{/each}</Select.Content
														>
													</Select.Root>
													<div class="space-y-1">
														<Select.Root
															type="single"
															value={parsed.right.func}
															onValueChange={(v) =>
																updateStructuredRawAggTerm(idx, 'right', {
																	func: v as StructuredAggFunc
																})}
														>
															<Select.Trigger class="h-7 w-full text-xs"
																>{parsed.right.func}</Select.Trigger
															>
															<Select.Content
																>{#each STRUCTURED_AGG_FUNCS as func (func)}<Select.Item
																		value={func}
																		class="text-xs">{func}</Select.Item
																	>{/each}</Select.Content
															>
														</Select.Root>
														{#if parsed.right.func !== 'count'}
															<ColumnInput
																value={parsed.right.column}
																suggestions={availableColumns}
																placeholder="column…"
																onchange={(v) =>
																	updateStructuredRawAggTerm(idx, 'right', { column: v })}
															/>
														{/if}
													</div>
												</div>
												<p class="font-mono text-2xs text-muted-foreground">
													{structuredAggExprToString(parsed)}
												</p>
											</div>
										{:else}
											<Input
												class="h-7 font-mono text-xs"
												placeholder="PRQL aggregation expression…"
												value={agg.expr ?? ''}
												oninput={(e) =>
													updateAgg(idx, { expr: (e.target as HTMLInputElement).value })}
											/>
										{/if}
									</div>
								</Popover.Content>
							</Popover.Root>
						</div>
					{:else}
						<!-- Collapsed structured agg chip -->
						<div class={CHIP}>
							<button class={CHIP_SECTION} onclick={() => (expandedAggIdx = idx)}
								>{humanizeAgg(agg)}</button
							>
						</div>
					{/if}

					<!-- Remove button — always outside the inner chip div -->
					<button
						class="{CHIP_X} py-1"
						onclick={() => removeAgg(idx)}
						aria-label="Remove aggregation"
					>
						<X class="h-3 w-3" />
					</button>
				</div>
			{/each}

			<!-- Add aggregation — immediate inline (no popover) -->
			<button class={CHIP_ADD} onclick={addAggInline} aria-label="Add aggregation">
				<Plus class="h-3 w-3" />
			</button>
		{/if}
	</div>
	<!-- end top row -->

	<!-- ── Bottom row: group-by columns ──────────────────────────────────── -->
	<div class="flex flex-wrap items-center gap-1.5">
		<span class="{SECTION_LABEL} w-8 shrink-0 pr-1.5 text-right">by</span>

		{#if stage.by.length === 0 && !pendingNewBy}
			<span class="text-xs text-muted-foreground/60 italic">none</span>
		{/if}

		{#each stage.by as col, idx (`${col}-${idx}`)}
			{@const invalid = availableColumns.length > 0 && !availableColumns.includes(col)}
			<div
				role="listitem"
				draggable="true"
				ondragstart={() => (dragByIdx = idx)}
				ondragover={(e) => e.preventDefault()}
				ondrop={(e) => {
					e.preventDefault();
					if (dragByIdx !== null && dragByIdx !== idx) {
						reorderBy(dragByIdx, idx);
						dragByIdx = null;
					}
				}}
				ondragend={() => (dragByIdx = null)}
				class="{CHIP} cursor-grab active:cursor-grabbing {dragByIdx !== null && dragByIdx === idx
					? 'opacity-40'
					: ''} {invalid ? CHIP_INVALID : ''}"
			>
				<InlineChipLabel
					value={col}
					suggestions={availableColumns.filter((c) => !stage.by.includes(c) || c === col)}
					class="px-2 py-1 font-mono text-xs"
					oncommit={(v) => renameBy(idx, v)}
					oncancel={() => {
						if (!col) removeGroupByIdx(idx);
					}}
				/>
				<button class={CHIP_X} onclick={() => removeGroupByIdx(idx)} aria-label="Remove {col}">
					<X class="h-3 w-3" />
				</button>
			</div>
		{/each}

		<!-- Pending new by-column (inline, no popover) -->
		{#if pendingNewBy}
			<div class="{CHIP} border-ring/60">
				<InlineChipLabel
					value={pendingNewByValue}
					suggestions={availableColumns.filter((c) => !stage.by.includes(c))}
					initialEditing={true}
					placeholder="column…"
					class="px-2 py-1 font-mono text-xs"
					oncommit={commitAddBy}
					oncancel={() => (pendingNewBy = false)}
				/>
			</div>
		{/if}

		{#if !pendingNewBy}
			<button
				class={CHIP_ADD}
				onclick={() => {
					pendingNewByValue = pickGroupByColumn(availableColumns, stage.by);
					pendingNewBy = true;
				}}
				aria-label="Add group-by column"
			>
				<Plus class="h-3 w-3" />
			</button>
		{/if}
	</div>
	<!-- end by row -->
</div>
