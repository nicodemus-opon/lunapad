<script lang="ts">
	import type { FilterStage, FilterCondition, FilterOp } from '$lib/types/gui-pipeline';
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { ChipInput } from '$lib/components/ui/chip-input';
	import { pickDefaultFilter } from '$lib/components/gui/chip-intelligence';
	import { Plus, X, Loader2 } from '@lucide/svelte';

	interface UpstreamResult {
		rows: Record<string, unknown>[];
		columns: string[];
	}

	interface Props {
		stage: FilterStage;
		availableColumns: string[];
		onUpdate: (stage: FilterStage) => void;
		getUpstreamData?: () => Promise<UpstreamResult | { error: string } | null>;
	}

	let { stage, availableColumns, onUpdate, getUpstreamData }: Props = $props();

	const OPS: { value: FilterOp; label: string; short: string }[] = [
		{ value: '==', label: '= equals', short: 'is' },
		{ value: '!=', label: '≠ not equals', short: '≠' },
		{ value: '>', label: '> greater than', short: '>' },
		{ value: '>=', label: '≥ greater or equal', short: '≥' },
		{ value: '<', label: '< less than', short: '<' },
		{ value: '<=', label: '≤ less or equal', short: '≤' },
		{ value: 'like', label: '~ like (pattern)', short: 'like' },
		{ value: 'in', label: '∈ in (list)', short: 'in' },
		{ value: 'not in', label: '∉ not in (list)', short: 'not in' },
		{ value: 'is null', label: '∅ is null', short: 'is null' },
		{ value: 'is not null', label: '≠∅ is not null', short: 'is not null' }
	];

	const noValueOps: FilterOp[] = ['is null', 'is not null'];
	const multiValueOps: FilterOp[] = ['in', 'not in'];

	function opShort(op: FilterOp): string {
		return OPS.find((o) => o.value === op)?.short ?? op;
	}

	function humanize(cond: FilterCondition): string {
		const short = opShort(cond.op);
		const col = cond.column || '?';
		if (noValueOps.includes(cond.op)) return `${col} ${short}`;
		const val = cond.value || '…';
		return `${col} ${short} ${val}`;
	}

	function updateCond(idx: number, patch: Partial<FilterCondition>) {
		const conditions = stage.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c));
		onUpdate({ ...stage, conditions });
	}

	function removeCond(idx: number) {
		onUpdate({ ...stage, conditions: stage.conditions.filter((_, i) => i !== idx) });
	}

	function toggleLogic() {
		onUpdate({ ...stage, logic: stage.logic === 'and' ? 'or' : 'and' });
	}

	// ── Drag-to-reorder conditions ───────────────────────────────────────────────
	let dragCondIdx = $state<number | null>(null);

	function reorderConditions(from: number, to: number) {
		const conditions = [...stage.conditions];
		const [moved] = conditions.splice(from, 1);
		conditions.splice(to, 0, moved);
		onUpdate({ ...stage, conditions });
	}

	// ── Upstream data & column intelligence ─────────────────────────────────────
	let upstreamData = $state<UpstreamResult | null>(null);
	let upstreamLoading = $state(false);

	async function ensureUpstreamData() {
		if (upstreamData || upstreamLoading || !getUpstreamData) return;
		upstreamLoading = true;
		try {
			const result = await getUpstreamData();
			if (result && !('error' in result)) {
				upstreamData = result;
			}
		} finally {
			upstreamLoading = false;
		}
	}

	function getDistinctValues(col: string, maxItems = 200): string[] {
		if (!upstreamData) return [];
		const seen = new Set<string>();
		for (const row of upstreamData.rows) {
			const v = row[col];
			if (v !== null && v !== undefined) {
				seen.add(String(v));
				if (seen.size >= maxItems) break;
			}
		}
		return [...seen].sort((a, b) => a.localeCompare(b));
	}

	type ColType = 'date' | 'numeric' | 'text';

	function getColType(col: string): ColType {
		if (!upstreamData) return 'text';
		const nonNulls = upstreamData.rows
			.map((r) => r[col])
			.filter((v) => v !== null && v !== undefined);
		if (nonNulls.length === 0) return 'text';
		if (nonNulls.every((v) => v instanceof Date)) return 'date';
		const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
		if (nonNulls.every((v) => typeof v === 'string' && ISO_DATE.test(v))) return 'date';
		if (nonNulls.every((v) => typeof v === 'number')) return 'numeric';
		return 'text';
	}

	// ── Multi-value (in / not in) helpers ────────────────────────────────────────
	function parseMultiValue(val: string): string[] {
		return val
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}

	function serializeMultiValue(values: string[]): string {
		return values.join(', ');
	}

	function toggleMultiValue(current: string, item: string): string {
		const parts = parseMultiValue(current);
		const idx = parts.indexOf(item);
		if (idx === -1) return serializeMultiValue([...parts, item]);
		return serializeMultiValue(parts.filter((_, i) => i !== idx));
	}

	// ── Date helpers ─────────────────────────────────────────────────────────────
	/** Strip leading @ from PRQL date literal for <input type="date"> */
	function toDateInputValue(val: string): string {
		return val.startsWith('@') ? val.slice(1) : val;
	}

	/** Add @ prefix for PRQL date literal format */
	function fromDateInputValue(val: string): string {
		return val ? `@${val}` : '';
	}

	// ── Inline expanded condition index ──────────────────────────────────────────
	let expandedCondIdx = $state<number | null>(null);

	function expandCond(idx: number) {
		expandedCondIdx = idx;
		ensureUpstreamData();
		// Auto-focus column input so keyboard events (Escape, Tab) work immediately
		requestAnimationFrame(() => {
			const input = document.querySelector<HTMLInputElement>('[data-testid="filter-column-input"]');
			input?.focus();
		});
	}

	function collapseCond() {
		expandedCondIdx = null;
	}

	function addInline() {
		const newIdx = stage.conditions.length;
		const suggested = pickDefaultFilter(availableColumns, stage.conditions);
		onUpdate({
			...stage,
			conditions: [...stage.conditions, { column: suggested.column, op: suggested.op, value: suggested.value }]
		});
		// expand immediately — use requestAnimationFrame so the DOM updates first
		requestAnimationFrame(() => {
			expandedCondIdx = newIdx;
			ensureUpstreamData();
			requestAnimationFrame(() => {
				const input = document.querySelector<HTMLInputElement>('[data-testid="filter-column-input"]');
				input?.focus();
			});
		});
	}
</script>

<!-- ── Shared value editor snippet ──────────────────────────────────────────── -->
{#snippet valueEditor(col: string, op: FilterOp, value: string, onChange: (v: string) => void)}
	{#if !noValueOps.includes(op)}
		{@const colType = getColType(col)}
		{@const distinctVals = getDistinctValues(col)}

		{#if multiValueOps.includes(op)}
			{@const selected = parseMultiValue(value)}
			<!-- Multi-select for in / not in -->
			<div class="space-y-1.5">
				{#if selected.length > 0}
					<div class="flex flex-wrap gap-1">
						{#each selected as item (item)}
							<span class="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-1 text-[11px] font-mono">
								{item}
								<button
									class="hover:text-destructive transition-colors"
									onclick={() => onChange(serializeMultiValue(selected.filter((s) => s !== item)))}
									aria-label="Remove {item}"
								>
									<X class="w-2.5 h-2.5" />
								</button>
							</span>
						{/each}
					</div>
				{/if}
				{#if distinctVals.length > 0}
					<div class="max-h-36 overflow-y-auto rounded border divide-y text-xs">
						{#each distinctVals as val (val)}
							{@const checked = selected.includes(val)}
							<label class="flex items-center gap-2 px-2 py-1 hover:bg-muted/50 cursor-pointer">
								<input
									type="checkbox"
									class="accent-primary"
									{checked}
									onchange={() => onChange(toggleMultiValue(value, val))}
								/>
								<span class="font-mono truncate">{val}</span>
							</label>
						{/each}
					</div>
				{:else}
					<Input
						class="h-7 text-xs font-mono w-full"
						placeholder="a, b, c"
						{value}
						oninput={(e) => onChange((e.target as HTMLInputElement).value)}
					/>
					{#if upstreamLoading}
						<div class="flex items-center gap-1 text-[10px] text-muted-foreground">
							<Loader2 class="w-3 h-3 animate-spin" /> loading suggestions…
						</div>
					{/if}
				{/if}
			</div>
		{:else if colType === 'date'}
			<!-- Date picker -->
			<input
				type="date"
				class="h-7 w-full rounded-md border border-input bg-background px-2 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				value={toDateInputValue(value)}
				oninput={(e) => onChange(fromDateInputValue((e.target as HTMLInputElement).value))}
			/>
		{:else}
			<!-- Text / numeric input with suggestions -->
			<div class="space-y-1">
				<Input
					class="h-7 text-xs font-mono w-full"
					placeholder="value…"
					{value}
					oninput={(e) => onChange((e.target as HTMLInputElement).value)}
				/>
				{#if upstreamLoading}
					<div class="flex items-center gap-1 text-[10px] text-muted-foreground">
						<Loader2 class="w-3 h-3 animate-spin" /> loading suggestions…
					</div>
				{:else if distinctVals.length > 0}
					<div class="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
						{#each distinctVals.slice(0, 12) as val (val)}
							<button
								class="rounded px-1.5 py-1 text-[11px] font-mono bg-muted hover:bg-primary/10 hover:text-primary transition-colors truncate max-w-full"
								onclick={() => onChange(val)}
								title={val}
							>
								{val}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	{/if}
{/snippet}

<div class="flex items-center gap-1.5 flex-wrap">
	{#if stage.conditions.length === 0}
		<span class="text-xs text-muted-foreground/60 italic">no conditions</span>
	{/if}

	{#each stage.conditions as cond, idx}
		{#if idx > 0}
			<!-- AND / OR logic toggle badge -->
			<button
				class="text-[9px] font-bold uppercase rounded px-1.5 py-1 bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
				onclick={toggleLogic}
				title="Click to toggle AND / OR"
			>
				{stage.logic}
			</button>
		{/if}

		<!-- Condition pill -->
		<div
			role="listitem"
			draggable={expandedCondIdx !== idx}
			ondragstart={() => (dragCondIdx = idx)}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => { e.preventDefault(); if (dragCondIdx !== null && dragCondIdx !== idx) { reorderConditions(dragCondIdx, idx); dragCondIdx = null; } }}
			ondragend={() => (dragCondIdx = null)}
			class="inline-flex items-center text-xs overflow-hidden group/pill shrink-0 transition-all"
			class:opacity-40={dragCondIdx !== null && dragCondIdx === idx}
			class:cursor-grab={expandedCondIdx !== idx}
			class:active:cursor-grabbing={expandedCondIdx !== idx}
		>
			{#if expandedCondIdx === idx}
				<!-- ── Expanded inline form ── -->
				{@const distinctVals = getDistinctValues(cond.column)}
				{@const invalid = availableColumns.length > 0 && cond.column && !availableColumns.includes(cond.column)}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div
					class="inline-flex items-center gap-1 rounded-lg border border-primary/50 bg-background px-1.5 py-0.5 ring-1 ring-primary/20"
					style="border-colorb: hsl(var(--chart-{(idx % 5) + 1}))"
					onkeydown={(e) => { if (e.key === 'Escape') collapseCond(); }}
					onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) collapseCond(); }}
					role="group"
				>
					<!-- Column input with proper autocomplete -->
					<ChipInput
						value={cond.column}
						suggestions={availableColumns}
						placeholder="column…"
						class="font-mono text-xs {invalid ? 'text-destructive' : ''}"
						data-testid="filter-column-input"
						oninput={(v) => { updateCond(idx, { column: v }); ensureUpstreamData(); }}
					/>

					<!-- Op select -->
					<select
						value={cond.op}
						class="bg-transparent text-xs text-muted-foreground outline-none cursor-pointer hover:text-foreground transition-colors"
						onchange={(e) => updateCond(idx, { op: (e.target as HTMLSelectElement).value as FilterOp })}
					>
						{#each OPS as op}
							<option value={op.value}>{op.short}</option>
						{/each}
					</select>

					<!-- Value input (not shown for is null / is not null) -->
					{#if !noValueOps.includes(cond.op)}
						{#if multiValueOps.includes(cond.op)}
							<!-- Multi-value: keep popover for this complex case -->
							<Popover.Root>
								<Popover.Trigger class="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors px-1">
									{cond.value ? `${parseMultiValue(cond.value).length} values` : 'values…'}
								</Popover.Trigger>
								<Popover.Content class="w-72 p-3">
									{@render valueEditor(cond.column, cond.op, cond.value, (v) => updateCond(idx, { value: v }))}
								</Popover.Content>
							</Popover.Root>
						{:else}
							<ChipInput
								value={cond.value}
								suggestions={distinctVals.slice(0, 20)}
								placeholder="value…"
								class="font-mono text-xs"
								oninput={(v) => updateCond(idx, { value: v })}
							/>
						{/if}
					{/if}

					<!-- Confirm -->
					<button
						class="text-muted-foreground hover:text-primary transition-colors px-0.5"
						onclick={collapseCond}
						aria-label="Done editing"
					>
						✓
					</button>
				</div>
			{:else}
				<!-- ── Collapsed chip ── -->
				{@const invalid = availableColumns.length > 0 && cond.column && !availableColumns.includes(cond.column)}
				<div
					class="inline-flex items-center rounded-full border bg-muted/60 overflow-hidden group/inner {invalid ? 'border-destructive/50' : ''}"
					style={invalid ? '' : `border-color: hsl(var(--chart-${(idx % 5) + 1}))`}
				>
					<button
						class="px-2.5 py-1 hover:bg-muted transition-colors font-mono text-left {invalid ? 'text-destructive/70' : ''}"
						onclick={() => expandCond(idx)}
						data-testid="filter-condition-pill"
					>
						{humanize(cond)}
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

	<!-- Add condition — immediate inline add (no popover) -->
	<button
		class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 px-2 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
		onclick={addInline}
	>
		<Plus class="w-3 h-3" /> add
	</button>
</div>
