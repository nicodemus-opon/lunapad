<script lang="ts">
	import NodeConfigField from './NodeConfigField.svelte';
	import Editor from '$lib/components/Editor.svelte';
	import { CUSTOM_CHART_GLOBALS_DTS } from '$lib/services/plot-cell';
	import { DEFAULT_CUSTOM_CHART_CODE } from '$lib/utils';
	import type { VisualBlock } from '$lib/services/markdoc-ast';
	import { markdocAttrToDisplay as attr, parseBlockWidget } from '$lib/services/markdoc-ast';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
	import { MARKDOC_TAG_CATALOG } from '$lib/services/markdoc-catalog';
	import type { TableAggKind } from '$lib/services/report-table-summary';
	import {
		buildVisualRefOptions,
		columnsForRef,
		type FilterUsage
	} from '$lib/services/markdoc-visual-analysis';
	import { toast } from 'svelte-sonner';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import { resolveBareVariablePath } from '$lib/services/markdoc-interp';

	/** Resolve a loop `data` attr (literal array or `$cell.rows` ref) to rows, or null. */
	function resolveLoopRows(data: unknown, cellList: Cell[]): unknown[] | null {
		if (Array.isArray(data)) return data;
		if (typeof data === 'string' && data.trim().startsWith('$')) {
			const value = resolveBareVariablePath(data, cellList);
			if (Array.isArray(value)) return value;
		}
		return null;
	}

	function copyVariable(token: string) {
		navigator.clipboard?.writeText(token).then(
			() => toast.success(`Copied ${token}`),
			() => toast.error('Copy failed')
		);
	}

	interface Props {
		block: VisualBlock | null;
		refEntries?: MarkdownRefEntry[];
		filterUsages?: Record<string, FilterUsage[]>;
		cells?: Cell[];
		onPatch: (patch: { attrs?: Record<string, unknown>; body?: string; source?: string }) => void;
		variant?: 'sidebar' | 'popover';
	}

	const {
		block,
		refEntries = [],
		filterUsages = {},
		cells = [],
		onPatch,
		variant = 'popover'
	}: Props = $props();

	let showAdvanced = $state(false);

	const parsed = $derived(block ? parseBlockWidget(block) : null);
	const catalog = $derived(parsed ? MARKDOC_TAG_CATALOG[parsed.tagName] : null);

	const aggOptions: TableAggKind[] = ['sum', 'avg', 'min', 'max', 'count'];
	const chartTypes = [
		'table',
		'big-value',
		'delta',
		'value',
		'line',
		'bar',
		'bar-horizontal',
		'area',
		'scatter',
		'bubble',
		'pie',
		'histogram',
		'heatmap',
		'calendar-heatmap',
		'funnel',
		'box-plot',
		'sankey',
		'map',
		'choropleth',
		'custom',
		'sparkline'
	] as const;
	const quickChartTypes = ['line', 'bar', 'area', 'pie', 'table', 'sparkline'] as const;
	const formatKinds = [
		'number',
		'currency',
		'percentage',
		'compact',
		'date',
		'datetime',
		'text',
		'category',
		'boolean'
	] as const;
	const metricFormats = ['number', 'currency', 'compact', 'percent'] as const;
	const filterKinds = [
		'dropdown',
		'text-input',
		'date-range',
		'button-group',
		'multi-select',
		'relative-date',
		'numeric-range',
		'searchable-dropdown'
	] as const;
	const quickFilterKinds = ['dropdown', 'text-input', 'date-range', 'button-group'] as const;
	const BOX_LABELS = ['Min', 'Q1 (25th)', 'Median', 'Q3 (75th)', 'Max'] as const;

	function setBoxPlotCol(idx: number, col: string) {
		if (!parsed) return;
		const next = [...((parsed.attrs.yColumns as string[] | undefined) ?? [])];
		next[idx] = col;
		while (next.length < 5) next.push('');
		setAttr('yColumns', next.filter(Boolean));
	}

	function setAttr(key: string, value: unknown) {
		onPatch({ attrs: { [key]: value } });
	}

	function refOptions(): string[] {
		return buildVisualRefOptions(refEntries).map((o) => o.value);
	}

	const rowRefOptions = $derived(refOptions().filter((r) => r.endsWith('.rows')));
	const cellRefOptions = $derived(refOptions().filter((r) => !r.includes('.', 1)));
	const availableColumns = $derived(
		parsed ? columnsForRef(refEntries, parsed.attrs.data ?? parsed.attrs.ref) : []
	);

	// parseBlockWidget stores `data` as a Markdoc Variable object; coerce to its
	// `$cell.rows` source form so column/row resolution can match on it.
	const loopDataRef = $derived(parsed ? attr(parsed.attrs.data ?? parsed.attrs.ref) : '');
	const loopColumns = $derived(columnsForRef(refEntries, loopDataRef));

	/** Live group keys derived the same way expandGroupBlock does: unique values of
	 * the `by` column across the resolved data rows, in first-seen order. */
	const groupKeys = $derived.by(() => {
		if (!parsed || parsed.tagName !== 'group') return [];
		const by = String(attr(parsed.attrs.by) ?? '');
		if (!by) return [];
		const rows = resolveLoopRows(loopDataRef, cells);
		if (!rows) return [];
		const seen: string[] = [];
		for (const row of rows) {
			const key = String((row as Record<string, unknown>)?.[by] ?? '');
			if (key && !seen.includes(key)) seen.push(key);
		}
		return seen;
	});

	/** Order attr as a string list, defaulting to the natural group-key order. */
	const orderList = $derived.by(() => {
		if (!parsed || parsed.tagName !== 'group') return [];
		const stored = parsed.attrs.order;
		if (Array.isArray(stored)) return stored.map(String);
		return [...groupKeys];
	});

	function moveOrderKey(index: number, delta: number) {
		const next = [...orderList];
		const target = index + delta;
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target], next[index]];
		setAttr('order', next);
	}

	function setJsonArrayAttr(key: string, value: string) {
		try {
			const trimmed = value.trim();
			setAttr(key, trimmed ? JSON.parse(trimmed) : undefined);
		} catch {
			/* wait for valid JSON */
		}
	}

	const tableMode = $derived.by(() => {
		if (!parsed || parsed.tagName !== 'datatable') return 'raw';
		if (parsed.attrs.pivotBy) return 'pivot';
		if (parsed.attrs.valueCol && parsed.attrs.index) return 'summary';
		return 'raw';
	});

	function setDatatableMode(mode: 'raw' | 'summary' | 'pivot') {
		if (!parsed) return;
		if (mode === 'raw') {
			onPatch({
				attrs: { pivotBy: undefined, valueCol: undefined, index: undefined }
			});
		} else if (mode === 'summary') {
			onPatch({
				attrs: {
					pivotBy: undefined,
					valueCol: parsed.attrs.valueCol ?? '',
					index: parsed.attrs.index ?? []
				}
			});
		} else {
			onPatch({
				attrs: {
					index: undefined,
					pivotBy: parsed.attrs.pivotBy ?? '',
					valueCol: parsed.attrs.valueCol ?? ''
				}
			});
		}
	}

	function humanize(value: string): string {
		return value
			.replace(/-/g, ' ')
			.replace(/\b\w/g, (c) => c.toUpperCase());
	}

	// ── if-condition builder ─────────────────────────────────────────────
	// Simple conditions of the shape fn($path, literal) get a structured
	// operand/operator/value UI; anything else falls back to the raw input.
	const CONDITION_OPERATORS = [
		{ fn: 'equals', label: '=' },
		{ fn: 'gt', label: '>' },
		{ fn: 'gte', label: '≥' },
		{ fn: 'lt', label: '<' },
		{ fn: 'lte', label: '≤' }
	] as const;

	const SIMPLE_CONDITION_RE =
		/^\s*(equals|gt|gte|lt|lte)\(\s*(\$[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*,\s*(.+?)\s*\)\s*$/;

	function parseSimpleCondition(src: string): { fn: string; operand: string; value: string } | null {
		const m = SIMPLE_CONDITION_RE.exec(src);
		if (!m) return null;
		let value = m[3];
		if (/^".*"$/.test(value)) {
			try {
				value = JSON.parse(value);
			} catch {
				/* keep the raw literal */
			}
		}
		return { fn: m[1], operand: m[2], value };
	}

	function composeCondition(fn: string, operand: string, value: string): string {
		const trimmed = value.trim();
		const literal =
			trimmed !== '' && !Number.isNaN(Number(trimmed))
				? trimmed
				: trimmed === 'true' || trimmed === 'false'
					? trimmed
					: JSON.stringify(trimmed);
		return `${fn}(${operand.trim() || '$cell.count'}, ${literal})`;
	}

	let conditionCustom = $state(false);
</script>

{#if !block}
	<div class="nc-empty">
		<p class="nc-empty-title">Nothing selected</p>
		<p class="nc-empty-copy">Choose a block in the document to edit its properties.</p>
	</div>
{:else if block.kind === 'fence'}
	<div class="nc-stack">
		<p class="nc-section-label">Source</p>
		<textarea
			class="nc-textarea font-mono"
			value={block.source}
			oninput={(e) => onPatch({ source: e.currentTarget.value })}
		></textarea>
	</div>
{:else if !parsed}
	<div class="nc-empty">
		<p class="nc-empty-title">Edit in place</p>
		<p class="nc-empty-copy">This text block is edited directly in the canvas.</p>
	</div>
{:else}
	<div class="nc-panel" class:nc-panel--sidebar={variant === 'sidebar'}>
		{#if catalog?.detail}
			<p class="nc-lead">{catalog.detail}</p>
		{/if}

		{#if parsed.tagName === 'metric'}
			<div class="nc-stack">
				<NodeConfigField label="Value">
					{#snippet control()}
						<input
							class="nc-input"
							value={attr(parsed.attrs.value)}
							placeholder="$cell.value"
							oninput={(e) => setAttr('value', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Label">
					{#snippet control()}
						<input
							class="nc-input"
							value={attr(parsed.attrs.label)}
							oninput={(e) => setAttr('label', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Compare to" hint="Optional trend">
					{#snippet control()}
						<input
							class="nc-input"
							value={attr(parsed.attrs.vs)}
							placeholder="$prev.value"
							oninput={(e) => setAttr('vs', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Format">
					{#snippet control()}
						<div class="nc-segments">
							{#each metricFormats as fmt (fmt)}
								<button
									type="button"
									class="nc-segment"
									class:is-active={attr(parsed.attrs.format, 'number') === fmt}
									onclick={() => setAttr('format', fmt)}
								>
									{fmt}
								</button>
							{/each}
						</div>
					{/snippet}
				</NodeConfigField>
			</div>

		{:else if parsed.tagName === 'chart'}
			<div class="nc-stack">
				<NodeConfigField label="Chart type">
					{#snippet control()}
						<div class="nc-segments nc-segments--wrap">
							{#each quickChartTypes as type (type)}
								<button
									type="button"
									class="nc-segment"
									class:is-active={attr(parsed.attrs.type, 'bar') === type}
									onclick={() => setAttr('type', type)}
								>
									{humanize(type)}
								</button>
							{/each}
						</div>
						<select
							class="nc-select mt-1.5"
							value={attr(parsed.attrs.type, 'bar')}
							onchange={(e) => setAttr('type', e.currentTarget.value)}
						>
							{#each chartTypes as type (type)}
								<option value={type}>{humanize(type)}</option>
							{/each}
						</select>
					{/snippet}
				</NodeConfigField>

				<NodeConfigField label="Data">
					{#snippet control()}
						<select
							class="nc-select"
							value={attr(parsed.attrs.data)}
							onchange={(e) => setAttr('data', e.currentTarget.value)}
						>
							<option value="">Pick a result…</option>
							{#each rowRefOptions as r (r)}
								<option value={r}>{r}</option>
							{/each}
						</select>
					{/snippet}
				</NodeConfigField>

				<NodeConfigField label="Inherit from cell" hint="Reuse saved chart settings">
					{#snippet control()}
						<select
							class="nc-select"
							value={attr(parsed.attrs.ref)}
							onchange={(e) => {
								const ref = e.currentTarget.value || undefined;
								onPatch({ attrs: { ref, data: ref ? undefined : parsed.attrs.data } });
							}}
						>
							<option value="">Configure here</option>
							{#each cellRefOptions as r (r)}
								<option value={r}>{r}</option>
							{/each}
						</select>
					{/snippet}
				</NodeConfigField>

				<NodeConfigField label="X axis">
					{#snippet control()}
						<input
							class="nc-input"
							list="visual-columns"
							value={attr(parsed.attrs.x)}
							oninput={(e) => setAttr('x', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Y axis">
					{#snippet control()}
						<input
							class="nc-input"
							list="visual-columns"
							value={attr(parsed.attrs.y)}
							oninput={(e) => setAttr('y', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Title">
					{#snippet control()}
						<input
							class="nc-input"
							value={attr(parsed.attrs.title)}
							oninput={(e) => setAttr('title', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>

				<details class="nc-advanced" bind:open={showAdvanced}>
					<summary class="nc-advanced-toggle">Advanced</summary>
					<div class="nc-stack nc-stack--nested">
						{#if attr(parsed.attrs.type, 'bar') === 'custom'}
							<p class="nc-lead">Custom Plotly spec</p>
							<div class="h-48 overflow-hidden rounded-md border border-border">
								<Editor
									code={attr(parsed.attrs.code, DEFAULT_CUSTOM_CHART_CODE)}
									language="javascript"
									plotGlobalsDts={CUSTOM_CHART_GLOBALS_DTS}
									onchange={(code) => setAttr('code', code)}
								/>
							</div>
						{/if}
						{#if attr(parsed.attrs.type, 'bar') === 'box-plot'}
							{#each BOX_LABELS as blabel, idx (blabel)}
								<NodeConfigField label={blabel}>
									{#snippet control()}
										<select
											class="nc-select"
											value={((parsed.attrs.yColumns as string[] | undefined) ?? [])[idx] ?? ''}
											onchange={(e) => setBoxPlotCol(idx, e.currentTarget.value)}
										>
											<option value="">Column…</option>
											{#each availableColumns as col (col)}
												<option value={col}>{col}</option>
											{/each}
										</select>
									{/snippet}
								</NodeConfigField>
							{/each}
						{/if}
						{#if attr(parsed.attrs.type, 'bar') === 'histogram'}
							<NodeConfigField label="Histogram bins">
								{#snippet control()}
									<input
										class="nc-input"
										type="number"
										min="1"
										value={parsed.attrs.histogramBins != null
											? Number(parsed.attrs.histogramBins)
											: ''}
										placeholder="auto"
										oninput={(e) => {
											const raw = e.currentTarget.value.trim();
											setAttr('histogramBins', raw ? Number(raw) : undefined);
										}}
									/>
								{/snippet}
							</NodeConfigField>
						{/if}
						<NodeConfigField label="Y columns (JSON)">
							{#snippet control()}
								<input
									class="nc-input font-mono"
									value={parsed.attrs.yColumns ? JSON.stringify(parsed.attrs.yColumns) : ''}
									oninput={(e) => setJsonArrayAttr('yColumns', e.currentTarget.value)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Secondary Y (JSON)">
							{#snippet control()}
								<input
									class="nc-input font-mono"
									value={parsed.attrs.yColumnsSecondary
										? JSON.stringify(parsed.attrs.yColumnsSecondary)
										: ''}
									oninput={(e) => setJsonArrayAttr('yColumnsSecondary', e.currentTarget.value)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Color column">
							{#snippet control()}
								<input
									class="nc-input"
									list="visual-columns"
									value={attr(parsed.attrs.colorColumn)}
									oninput={(e) => setAttr('colorColumn', e.currentTarget.value || undefined)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Size column">
							{#snippet control()}
								<input
									class="nc-input"
									list="visual-columns"
									value={attr(parsed.attrs.sizeColumn)}
									oninput={(e) => setAttr('sizeColumn', e.currentTarget.value || undefined)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Series mode">
							{#snippet control()}
								<select
									class="nc-select"
									value={attr(parsed.attrs.seriesMode, 'auto')}
									onchange={(e) => setAttr('seriesMode', e.currentTarget.value)}
								>
									{#each ['auto', 'grouped', 'stacked'] as mode (mode)}
										<option value={mode}>{mode}</option>
									{/each}
								</select>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Sort">
							{#snippet control()}
								<select
									class="nc-select"
									value={attr(parsed.attrs.sortOrder, 'none')}
									onchange={(e) => setAttr('sortOrder', e.currentTarget.value)}
								>
									{#each ['none', 'asc', 'desc'] as order (order)}
										<option value={order}>{order === 'none' ? 'Data order' : order}</option>
									{/each}
								</select>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Click filter param">
							{#snippet control()}
								<input
									class="nc-input"
									value={attr(parsed.attrs.filterParam)}
									oninput={(e) => setAttr('filterParam', e.currentTarget.value || undefined)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Filter column">
							{#snippet control()}
								<input
									class="nc-input"
									list="visual-columns"
									value={attr(parsed.attrs.filterColumn)}
									oninput={(e) => setAttr('filterColumn', e.currentTarget.value || undefined)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Drill cell">
							{#snippet control()}
								<select
									class="nc-select"
									value={attr(parsed.attrs.drillCell)}
									onchange={(e) => setAttr('drillCell', e.currentTarget.value || undefined)}
								>
									<option value="">None</option>
									{#each cellRefOptions as r (r)}
										<option value={r.replace('$', '')}>{r.replace('$', '')}</option>
									{/each}
								</select>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Height">
							{#snippet control()}
								<input
									class="nc-input"
									type="number"
									value={Number(parsed.attrs.height ?? 280)}
									oninput={(e) => setAttr('height', Number(e.currentTarget.value))}
								/>
							{/snippet}
						</NodeConfigField>
					</div>
				</details>
			</div>

		{:else if parsed.tagName === 'datatable'}
			<div class="nc-stack">
				<NodeConfigField label="View">
					{#snippet control()}
						<div class="nc-segments">
							{#each ['raw', 'summary', 'pivot'] as mode (mode)}
								<button
									type="button"
									class="nc-segment"
									class:is-active={tableMode === mode}
									onclick={() => setDatatableMode(mode as 'raw' | 'summary' | 'pivot')}
								>
									{mode}
								</button>
							{/each}
						</div>
					{/snippet}
				</NodeConfigField>

				<NodeConfigField label="Data">
					{#snippet control()}
						<select
							class="nc-select"
							value={attr(parsed.attrs.data)}
							onchange={(e) => setAttr('data', e.currentTarget.value)}
						>
							<option value="">Pick a result…</option>
							{#each rowRefOptions as r (r)}
								<option value={r}>{r}</option>
							{/each}
						</select>
					{/snippet}
				</NodeConfigField>

				<NodeConfigField label="Rows shown">
					{#snippet control()}
						<input
							class="nc-input"
							type="number"
							value={Number(parsed.attrs.limit ?? 10)}
							oninput={(e) => setAttr('limit', Number(e.currentTarget.value))}
						/>
					{/snippet}
				</NodeConfigField>

				<NodeConfigField label="Page size">
					{#snippet control()}
						<input
							class="nc-input"
							type="number"
							value={Number(parsed.attrs.pageSize ?? 10)}
							oninput={(e) => setAttr('pageSize', Number(e.currentTarget.value))}
						/>
					{/snippet}
				</NodeConfigField>

				<NodeConfigField label="Header style">
					{#snippet control()}
						<div class="nc-segments">
							{#each ['compact', 'full'] as style (style)}
								<button
									type="button"
									class="nc-segment"
									class:is-active={attr(parsed.attrs.headerInsights, 'compact') === style}
									onclick={() => setAttr('headerInsights', style)}
								>
									{style}
								</button>
							{/each}
						</div>
					{/snippet}
				</NodeConfigField>

				<details class="nc-advanced">
					<summary class="nc-advanced-toggle">Pivot & formatting</summary>
					<div class="nc-stack nc-stack--nested">
						<NodeConfigField label="Columns (JSON)">
							{#snippet control()}
								<input
									class="nc-input font-mono"
									value={parsed.attrs.cols ? JSON.stringify(parsed.attrs.cols) : ''}
									oninput={(e) => setJsonArrayAttr('cols', e.currentTarget.value)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Group by (JSON)">
							{#snippet control()}
								<input
									class="nc-input font-mono"
									value={parsed.attrs.index ? JSON.stringify(parsed.attrs.index) : ''}
									oninput={(e) => setJsonArrayAttr('index', e.currentTarget.value)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Pivot column">
							{#snippet control()}
								<input
									class="nc-input"
									list="visual-columns"
									value={attr(parsed.attrs.pivotBy)}
									oninput={(e) => setAttr('pivotBy', e.currentTarget.value || undefined)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Value column">
							{#snippet control()}
								<input
									class="nc-input"
									list="visual-columns"
									value={attr(parsed.attrs.valueCol)}
									oninput={(e) => setAttr('valueCol', e.currentTarget.value || undefined)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Aggregation">
							{#snippet control()}
								<select
									class="nc-select"
									value={attr(parsed.attrs.agg, 'sum')}
									onchange={(e) => setAttr('agg', e.currentTarget.value)}
								>
									{#each aggOptions as a (a)}
										<option value={a}>{a}</option>
									{/each}
								</select>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Linked filter">
							{#snippet control()}
								<input
									class="nc-input"
									value={attr(parsed.attrs.linkedFilter)}
									oninput={(e) => setAttr('linkedFilter', e.currentTarget.value)}
								/>
							{/snippet}
						</NodeConfigField>
					</div>
				</details>
			</div>

		{:else if parsed.tagName === 'filter'}
			{@const param = attr(parsed.attrs.param)}
			<div class="nc-stack">
				<NodeConfigField label="Param" hint="Used in ${param || 'name'}">
					{#snippet control()}
						<input
							class="nc-input font-mono"
							value={attr(parsed.attrs.param)}
							oninput={(e) => setAttr('param', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Label">
					{#snippet control()}
						<input
							class="nc-input"
							value={attr(parsed.attrs.label)}
							oninput={(e) => setAttr('label', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Control">
					{#snippet control()}
						<div class="nc-segments nc-segments--wrap">
							{#each quickFilterKinds as kind (kind)}
								<button
									type="button"
									class="nc-segment"
									class:is-active={attr(parsed.attrs.kind, 'dropdown') === kind}
									onclick={() => setAttr('kind', kind)}
								>
									{humanize(kind)}
								</button>
							{/each}
						</div>
						<select
							class="nc-select mt-1.5"
							value={attr(parsed.attrs.kind, 'dropdown')}
							onchange={(e) => setAttr('kind', e.currentTarget.value)}
						>
							{#each filterKinds as k (k)}
								<option value={k}>{humanize(k)}</option>
							{/each}
						</select>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Default">
					{#snippet control()}
						<input
							class="nc-input"
							value={attr(parsed.attrs.default ?? parsed.attrs.defaultValue)}
							oninput={(e) => setAttr('default', e.currentTarget.value || undefined)}
						/>
					{/snippet}
				</NodeConfigField>

				<details class="nc-advanced">
					<summary class="nc-advanced-toggle">Options & wiring</summary>
					<div class="nc-stack nc-stack--nested">
						<NodeConfigField label="Options">
							{#snippet control()}
								<input
									class="nc-input font-mono"
									value={Array.isArray(parsed.attrs.options)
										? JSON.stringify(parsed.attrs.options)
										: attr(parsed.attrs.options)}
									placeholder="$cell.rows or JSON array"
									oninput={(e) => {
										const raw = e.currentTarget.value.trim();
										if (raw.startsWith('$')) setAttr('options', raw);
										else setJsonArrayAttr('options', raw);
									}}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Options column">
							{#snippet control()}
								<input
									class="nc-input"
									list="visual-columns"
									value={attr(parsed.attrs.optionsColumn)}
									oninput={(e) => setAttr('optionsColumn', e.currentTarget.value || undefined)}
								/>
							{/snippet}
						</NodeConfigField>
					</div>
				</details>

				{#if parsed.attrs.kind === 'relative-date' || parsed.attrs.kind === 'date-range'}
					<NodeConfigField label="Start param">
						{#snippet control()}
							<input
								class="nc-input font-mono"
								value={attr(parsed.attrs.startParam)}
								oninput={(e) => setAttr('startParam', e.currentTarget.value || undefined)}
							/>
						{/snippet}
					</NodeConfigField>
					<NodeConfigField label="End param">
						{#snippet control()}
							<input
								class="nc-input font-mono"
								value={attr(parsed.attrs.endParam)}
								oninput={(e) => setAttr('endParam', e.currentTarget.value || undefined)}
							/>
						{/snippet}
					</NodeConfigField>
				{/if}
				{#if parsed.attrs.kind === 'numeric-range'}
					<NodeConfigField label="Min param">
						{#snippet control()}
							<input
								class="nc-input font-mono"
								value={attr(parsed.attrs.minParam)}
								oninput={(e) => setAttr('minParam', e.currentTarget.value || undefined)}
							/>
						{/snippet}
					</NodeConfigField>
					<NodeConfigField label="Max param">
						{#snippet control()}
							<input
								class="nc-input font-mono"
								value={attr(parsed.attrs.maxParam)}
								oninput={(e) => setAttr('maxParam', e.currentTarget.value || undefined)}
							/>
						{/snippet}
					</NodeConfigField>
				{/if}

				<div class="nc-callout">
					<p class="nc-callout-title">Query wiring</p>
					{#if param && filterUsages[param]?.length}
						<ul class="nc-callout-list">
							{#each filterUsages[param] as usage (usage.cellId)}
								<li><code>{usage.outputName}</code> uses <code>{'${' + param + '}'}</code></li>
							{/each}
						</ul>
					{:else if param}
						<p class="nc-callout-warn">No query references <code>{'${' + param + '}'}</code> yet.</p>
					{:else}
						<p class="nc-callout-copy">Set a param to see linked cells.</p>
					{/if}
				</div>
			</div>

		{:else if parsed.tagName === 'badge'}
			<div class="nc-stack">
				<NodeConfigField label="Value">
					{#snippet control()}
						<input
							class="nc-input"
							value={attr(parsed.attrs.value)}
							oninput={(e) => setAttr('value', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Color">
					{#snippet control()}
						<div class="nc-segments nc-segments--wrap">
							{#each ['info', 'success', 'warning', 'error', 'neutral'] as c (c)}
								<button
									type="button"
									class="nc-segment"
									class:is-active={attr(parsed.attrs.color, 'info') === c}
									onclick={() => setAttr('color', c)}
								>
									{c}
								</button>
							{/each}
						</div>
					{/snippet}
				</NodeConfigField>
			</div>
		{:else if parsed.tagName === 'progress'}
			<div class="nc-stack">
				<NodeConfigField label="Value">
					{#snippet control()}
						<input
							class="nc-input"
							value={attr(parsed.attrs.value)}
							oninput={(e) => setAttr('value', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Max">
					{#snippet control()}
						<input
							class="nc-input"
							type="number"
							value={Number(parsed.attrs.max ?? 100)}
							oninput={(e) => setAttr('max', Number(e.currentTarget.value))}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Label">
					{#snippet control()}
						<input
							class="nc-input"
							value={attr(parsed.attrs.label)}
							oninput={(e) => setAttr('label', e.currentTarget.value)}
						/>
					{/snippet}
				</NodeConfigField>
				<NodeConfigField label="Color">
					{#snippet control()}
						<div class="nc-segments">
							{#each ['info', 'success', 'warning', 'error'] as c (c)}
								<button
									type="button"
									class="nc-segment"
									class:is-active={attr(parsed.attrs.color, 'info') === c}
									onclick={() => setAttr('color', c)}
								>
									{c}
								</button>
							{/each}
						</div>
					{/snippet}
				</NodeConfigField>
			</div>
		{:else if parsed.tagName === 'columns'}
			<div class="nc-stack">
				<NodeConfigField label="Gap">
					{#snippet control()}
						<div class="nc-segments">
							{#each ['compact', 'default', 'comfortable'] as g (g)}
								<button
									type="button"
									class="nc-segment"
									class:is-active={attr(parsed.attrs.gap, 'default') === g}
									onclick={() => setAttr('gap', g)}
								>
									{humanize(g)}
								</button>
							{/each}
						</div>
					{/snippet}
				</NodeConfigField>
			</div>
		{:else if parsed.tagName === 'grid' || parsed.tagName === 'column' || parsed.tagName === 'tabs' || parsed.tagName === 'tab' || parsed.tagName === 'details' || parsed.tagName === 'if' || parsed.tagName === 'group' || parsed.tagName === 'each' || parsed.tagName === 'mermaid'}
			<div class="nc-stack">
				{#if parsed.tagName === 'grid'}
					<NodeConfigField label="Columns">
						{#snippet control()}
							<input
								class="nc-input"
								type="number"
								min="1"
								max="6"
								value={Number(parsed.attrs.cols ?? 3)}
								oninput={(e) => setAttr('cols', Number(e.currentTarget.value))}
							/>
						{/snippet}
					</NodeConfigField>
					<NodeConfigField label="Gap">
						{#snippet control()}
							<div class="nc-segments">
								{#each ['compact', 'default', 'comfortable'] as g (g)}
									<button
										type="button"
										class="nc-segment"
										class:is-active={attr(parsed.attrs.gap, 'default') === g}
										onclick={() => setAttr('gap', g)}
									>
										{humanize(g)}
									</button>
								{/each}
							</div>
						{/snippet}
					</NodeConfigField>
				{:else if parsed.tagName === 'column'}
					<NodeConfigField label="Width">
						{#snippet control()}
							<input
								class="nc-input"
								value={attr(parsed.attrs.width)}
								placeholder="300px, 40%, 1fr"
								oninput={(e) => setAttr('width', e.currentTarget.value || undefined)}
							/>
						{/snippet}
					</NodeConfigField>
				{:else if parsed.tagName === 'tab'}
					<NodeConfigField label="Tab label">
						{#snippet control()}
							<input
								class="nc-input"
								value={attr(parsed.attrs.label)}
								oninput={(e) => setAttr('label', e.currentTarget.value)}
							/>
						{/snippet}
					</NodeConfigField>
				{:else if parsed.tagName === 'details'}
					<NodeConfigField label="Summary">
						{#snippet control()}
							<input
								class="nc-input"
								value={attr(parsed.attrs.summary)}
								oninput={(e) => setAttr('summary', e.currentTarget.value)}
							/>
						{/snippet}
					</NodeConfigField>
					<label class="nc-check">
						<input
							type="checkbox"
							checked={Boolean(parsed.attrs.open)}
							onchange={(e) => setAttr('open', e.currentTarget.checked)}
						/>
						<span>Open by default</span>
					</label>
				{:else if parsed.tagName === 'if'}
					{@const currentCondition = attr(parsed.attrs.condition, parsed.condition ?? '')}
					{@const simple = parseSimpleCondition(currentCondition)}
					{#if !conditionCustom && (simple !== null || currentCondition.trim() === '')}
						<NodeConfigField label="Left side">
							{#snippet control()}
								<input
									class="nc-input font-mono"
									list="visual-condition-refs"
									value={simple?.operand ?? ''}
									placeholder="$orders.count"
									onchange={(e) =>
										setAttr(
											'condition',
											composeCondition(simple?.fn ?? 'gt', e.currentTarget.value, simple?.value ?? '0')
										)}
								/>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Operator">
							{#snippet control()}
								<div class="nc-segments">
									{#each CONDITION_OPERATORS as op (op.fn)}
										<button
											type="button"
											class="nc-segment"
											class:is-active={(simple?.fn ?? 'gt') === op.fn}
											title={op.fn}
											onclick={() =>
												setAttr(
													'condition',
													composeCondition(op.fn, simple?.operand ?? '', simple?.value ?? '0')
												)}
										>
											{op.label}
										</button>
									{/each}
								</div>
							{/snippet}
						</NodeConfigField>
						<NodeConfigField label="Right side">
							{#snippet control()}
								<input
									class="nc-input font-mono"
									value={simple?.value ?? ''}
									placeholder="0"
									onchange={(e) =>
										setAttr(
											'condition',
											composeCondition(simple?.fn ?? 'gt', simple?.operand ?? '', e.currentTarget.value)
										)}
								/>
							{/snippet}
						</NodeConfigField>
						<button type="button" class="nc-mode-link" onclick={() => (conditionCustom = true)}>
							Edit as custom expression
						</button>
						<datalist id="visual-condition-refs">
							{#each refOptions() as r (r)}<option value={r}></option>{/each}
						</datalist>
					{:else}
						<NodeConfigField label="Condition">
							{#snippet control()}
								<input
									class="nc-input font-mono"
									value={currentCondition}
									placeholder="gt($orders.count, 0)"
									oninput={(e) => setAttr('condition', e.currentTarget.value)}
								/>
							{/snippet}
						</NodeConfigField>
						{#if simple !== null || currentCondition.trim() === ''}
							<button type="button" class="nc-mode-link" onclick={() => (conditionCustom = false)}>
								Use simple builder
							</button>
						{:else}
							<p class="nc-lead">
								Comparisons: equals, gt, gte, lt, lte — e.g. gt($orders.count, 0)
							</p>
						{/if}
					{/if}
				{:else if parsed.tagName === 'group'}
					<NodeConfigField label="Data">
						{#snippet control()}
							<select
								class="nc-select"
								value={attr(parsed.attrs.data)}
								onchange={(e) => setAttr('data', e.currentTarget.value)}
							>
								<option value="">Pick a result…</option>
								{#each rowRefOptions as r (r)}
									<option value={r}>{r}</option>
								{/each}
							</select>
						{/snippet}
					</NodeConfigField>
					<NodeConfigField label="Group by">
						{#snippet control()}
							<input
								class="nc-input"
								list="visual-columns"
								value={attr(parsed.attrs.by)}
								oninput={(e) => setAttr('by', e.currentTarget.value)}
							/>
						{/snippet}
					</NodeConfigField>
					<div class="nc-varhint">
						<span class="nc-varhint-label">Available inside each group — click to copy</span>
						<div class="nc-varchips">
							<button type="button" class="nc-varchip" onclick={() => copyVariable('$key')}
								>$key</button
							>
							<button type="button" class="nc-varchip" onclick={() => copyVariable('$keyId')}
								>$keyId</button
							>
							<button type="button" class="nc-varchip" onclick={() => copyVariable('$items')}
								>$items</button
							>
						</div>
						{#if loopColumns.length}
							<span class="nc-varhint-sub">
								Loop rows with <code>{'{% each data=$items %}'}</code>, then use these fields:
							</span>
							<div class="nc-varchips">
								{#each loopColumns as col (col)}
									<button type="button" class="nc-varchip" onclick={() => copyVariable(`$${col}`)}
										>${col}</button
									>
								{/each}
							</div>
						{/if}
					</div>
					{#if orderList.length > 1}
						<NodeConfigField label="Group order">
							{#snippet control()}
								<div class="nc-orderlist">
									{#each orderList as key, i (key)}
										<div class="nc-orderrow">
											<span class="nc-orderkey">{key}</span>
											<button
												type="button"
												class="nc-orderbtn"
												disabled={i === 0}
												title="Move up"
												onclick={() => moveOrderKey(i, -1)}>↑</button
											>
											<button
												type="button"
												class="nc-orderbtn"
												disabled={i === orderList.length - 1}
												title="Move down"
												onclick={() => moveOrderKey(i, 1)}>↓</button
											>
										</div>
									{/each}
								</div>
							{/snippet}
						</NodeConfigField>
					{/if}
				{:else if parsed.tagName === 'each'}
					<NodeConfigField label="Data">
						{#snippet control()}
							<select
								class="nc-select"
								value={attr(parsed.attrs.data, '$items')}
								onchange={(e) => setAttr('data', e.currentTarget.value)}
							>
								<option value="$items">$items</option>
								{#each rowRefOptions as r (r)}
									<option value={r}>{r}</option>
								{/each}
							</select>
						{/snippet}
					</NodeConfigField>
					{#if loopColumns.length}
						<div class="nc-varhint">
							<span class="nc-varhint-label">Available in the body — click to copy</span>
							<div class="nc-varchips">
								{#each loopColumns as col (col)}
									<button type="button" class="nc-varchip" onclick={() => copyVariable(`$${col}`)}
										>${col}</button
									>
								{/each}
							</div>
						</div>
					{/if}
				{:else if parsed.tagName === 'mermaid'}
					<p class="nc-lead">Edit the diagram in the canvas, or pick a code reference.</p>
					<NodeConfigField label="Code ref">
						{#snippet control()}
							<select
								class="nc-select"
								value={attr(parsed.attrs.code)}
								onchange={(e) => setAttr('code', e.currentTarget.value || undefined)}
							>
								<option value="">Body source</option>
								{#each refOptions() as r (r)}
									<option value={r}>{r}</option>
								{/each}
							</select>
						{/snippet}
					</NodeConfigField>
				{:else}
					<p class="nc-lead">Layout blocks are edited directly in the document.</p>
				{/if}
			</div>

		{:else if parsed.tagName === 'card' || parsed.tagName === 'callout'}
			<div class="nc-stack">
				{#if parsed.tagName === 'card'}
					<NodeConfigField label="Title">
						{#snippet control()}
							<input
								class="nc-input"
								value={attr(parsed.attrs.title)}
								oninput={(e) => setAttr('title', e.currentTarget.value)}
							/>
						{/snippet}
					</NodeConfigField>
					<NodeConfigField label="Accent">
						{#snippet control()}
							<div class="nc-segments nc-segments--wrap">
								{#each ['neutral', 'info', 'success', 'warning', 'error'] as a (a)}
									<button
										type="button"
										class="nc-segment"
										class:is-active={attr(parsed.attrs.accent, 'neutral') === a}
										onclick={() => setAttr('accent', a)}
									>
										{a}
									</button>
								{/each}
							</div>
						{/snippet}
					</NodeConfigField>
				{:else}
					<NodeConfigField label="Type">
						{#snippet control()}
							<div class="nc-segments">
								{#each ['info', 'success', 'warning', 'error'] as t (t)}
									<button
										type="button"
										class="nc-segment"
										class:is-active={attr(parsed.attrs.type, 'info') === t}
										onclick={() => setAttr('type', t)}
									>
										{t}
									</button>
								{/each}
							</div>
						{/snippet}
					</NodeConfigField>
				{/if}
			</div>

		{:else}
			<div class="nc-stack">
				<p class="nc-section-label">Source</p>
				<textarea
					class="nc-textarea font-mono"
					value={block.source}
					oninput={(e) => onPatch({ source: e.currentTarget.value })}
				></textarea>
			</div>
		{/if}

		<datalist id="visual-columns">
			{#each availableColumns as col (col)}
				<option value={col}></option>
			{/each}
		</datalist>
	</div>
{/if}

<style>
	.nc-panel {
		padding: 0 0.35rem;
	}
	.nc-panel--sidebar {
		padding: 0.35rem 0.5rem;
	}
	.nc-stack {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.nc-stack--nested {
		padding-top: 0.35rem;
	}
	.nc-lead {
		margin: 0 0 0.5rem;
		font-size: var(--text-2xs);
		line-height: 1.45;
		color: var(--muted-foreground);
	}
	.nc-section-label {
		margin: 0;
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--foreground);
	}
	.nc-empty {
		padding: 0.75rem 0.5rem;
		text-align: center;
	}
	.nc-empty-title {
		margin: 0;
		font-size: var(--text-xs);
		font-weight: 600;
		color: var(--foreground);
	}
	.nc-empty-copy {
		margin: 0.35rem 0 0;
		font-size: var(--text-2xs);
		color: var(--muted-foreground);
	}
	.nc-input,
	.nc-select,
	.nc-textarea {
		width: 100%;
		border-radius: var(--radius-sm);
		border: 1px solid transparent;
		background: color-mix(in oklab, var(--muted) 28%, transparent);
		color: var(--foreground);
		font-size: var(--text-2xs);
		transition:
			border-color var(--motion-fast) var(--motion-ease-out),
			background var(--motion-fast) var(--motion-ease-out);
	}
	.nc-input,
	.nc-select {
		height: 1.65rem;
		padding: 0 0.45rem;
	}
	.nc-textarea {
		min-height: 5rem;
		padding: 0.45rem;
		resize: vertical;
	}
	.nc-input:hover,
	.nc-select:hover,
	.nc-textarea:hover {
		background: color-mix(in oklab, var(--muted) 42%, transparent);
	}
	.nc-input:focus-visible,
	.nc-select:focus-visible,
	.nc-textarea:focus-visible {
		outline: none;
		border-color: color-mix(in oklab, var(--ring) 45%, transparent);
		background: var(--background);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--ring) 18%, transparent);
	}
	.nc-segments {
		display: flex;
		flex-wrap: nowrap;
		gap: 0.2rem;
	}
	.nc-segments--wrap {
		flex-wrap: wrap;
	}
	.nc-segment {
		flex: 1 1 auto;
		min-width: 0;
		height: 1.5rem;
		padding: 0 0.4rem;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		font-size: var(--text-3xs);
		font-weight: 500;
		color: var(--muted-foreground);
		cursor: pointer;
		transition:
			background var(--motion-fast) var(--motion-ease-out),
			color var(--motion-fast) var(--motion-ease-out);
	}
	.nc-segment:hover {
		background: color-mix(in oklab, var(--muted) 55%, transparent);
		color: var(--foreground);
	}
	.nc-segment.is-active {
		background: color-mix(in oklab, var(--secondary) 22%, transparent);
		color: var(--foreground);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--secondary) 35%, transparent);
	}
	.nc-mode-link {
		align-self: flex-start;
		border: none;
		background: none;
		padding: 0;
		font-size: var(--text-2xs);
		color: var(--muted-foreground);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.nc-mode-link:hover {
		color: var(--foreground);
	}
	.nc-varhint {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.35rem 0;
	}
	.nc-varhint-label,
	.nc-varhint-sub {
		font-size: var(--text-2xs);
		color: var(--muted-foreground);
	}
	.nc-varhint-sub code {
		font-size: 0.9em;
	}
	.nc-varchips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.nc-varchip {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--background);
		padding: 0.1rem 0.4rem;
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		color: var(--foreground);
		cursor: pointer;
		transition:
			border-color var(--motion-fast) var(--motion-ease-out),
			background var(--motion-fast) var(--motion-ease-out);
	}
	.nc-varchip:hover {
		border-color: var(--primary);
		background: color-mix(in oklab, var(--primary) 8%, transparent);
	}
	.nc-orderlist {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		width: 100%;
	}
	.nc-orderrow {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}
	.nc-orderkey {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-2xs);
	}
	.nc-orderbtn {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--background);
		width: 1.4rem;
		height: 1.4rem;
		font-size: var(--text-2xs);
		color: var(--foreground);
		cursor: pointer;
	}
	.nc-orderbtn:hover:not(:disabled) {
		border-color: var(--primary);
	}
	.nc-orderbtn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.nc-advanced {
		margin-top: 0.15rem;
		border-top: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
		padding-top: 0.35rem;
	}
	.nc-advanced-toggle {
		cursor: pointer;
		font-size: var(--text-2xs);
		font-weight: 500;
		color: var(--muted-foreground);
		user-select: none;
		list-style: none;
	}
	.nc-advanced-toggle::-webkit-details-marker {
		display: none;
	}
	.nc-advanced[open] .nc-advanced-toggle {
		color: var(--foreground);
	}
	.nc-check {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.15rem 0;
		font-size: var(--text-2xs);
		color: var(--muted-foreground);
	}
	.nc-callout {
		margin-top: 0.35rem;
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--muted) 22%, transparent);
		padding: 0.45rem 0.55rem;
	}
	.nc-callout-title {
		margin: 0;
		font-size: var(--text-3xs);
		font-weight: 600;
		color: var(--muted-foreground);
	}
	.nc-callout-copy,
	.nc-callout-warn,
	.nc-callout-list {
		margin: 0.25rem 0 0;
		font-size: var(--text-3xs);
		color: var(--muted-foreground);
	}
	.nc-callout-warn {
		color: var(--warning);
	}
	.nc-callout-list {
		padding-left: 1rem;
	}
</style>
