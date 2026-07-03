<script lang="ts">
	import type { VisualBlock } from '$lib/services/markdoc-ast';
	import { parseBlockWidget } from '$lib/services/markdoc-ast';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
	import { MARKDOC_TAG_CATALOG } from '$lib/services/markdoc-catalog';
	import type { TableAggKind } from '$lib/services/report-table-summary';
	import {
		buildVisualRefOptions,
		columnsForRef,
		type FilterUsage
	} from '$lib/services/markdoc-visual-analysis';

	interface Props {
		block: VisualBlock | null;
		refEntries?: MarkdownRefEntry[];
		filterUsages?: Record<string, FilterUsage[]>;
		onPatch: (patch: { attrs?: Record<string, unknown>; body?: string; source?: string }) => void;
	}

	const { block, refEntries = [], filterUsages = {}, onPatch }: Props = $props();

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
		'custom',
		'sparkline'
	] as const;
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

	function setJsonArrayAttr(key: string, value: string) {
		try {
			const trimmed = value.trim();
			setAttr(key, trimmed ? JSON.parse(trimmed) : undefined);
		} catch {
			// Leave partially typed JSON alone until it becomes valid.
		}
	}

	const tableMode = $derived.by(() => {
		if (!parsed || parsed.tagName !== 'datatable') return 'raw';
		if (parsed.attrs.pivotBy) return 'pivot';
		if (parsed.attrs.valueCol && parsed.attrs.index) return 'summary';
		return 'raw';
	});
</script>

{#if !block}
	<div class="inspector-empty text-xs text-muted-foreground">
		Select a block to edit properties.
	</div>
{:else if block.kind === 'fence'}
	<div class="inspector-fence space-y-2">
		<p class="text-xs font-semibold text-muted-foreground">Code block</p>
		<textarea
			class="md-control min-h-28 w-full font-mono"
			value={block.source}
			oninput={(e) => onPatch({ source: e.currentTarget.value })}
		></textarea>
	</div>
{:else if !parsed}
	<div class="inspector-empty text-xs text-muted-foreground">
		Edit text inline in the document. Select a widget to configure it here.
	</div>
{:else}
	<div class="inspector-widget space-y-3">
		<datalist id="visual-columns">
			{#each availableColumns as col (col)}
				<option value={col}></option>
			{/each}
		</datalist>
		<div>
			<p class="text-xs font-semibold">{parsed.tagName}</p>
			{#if catalog?.detail}
				<p class="text-2xs text-muted-foreground">{catalog.detail}</p>
			{/if}
		</div>

		{#if parsed.tagName === 'metric'}
			<label class="field">
				<span>Value</span>
				<input
					value={String(parsed.attrs.value ?? '')}
					oninput={(e) => setAttr('value', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Label</span>
				<input
					value={String(parsed.attrs.label ?? '')}
					oninput={(e) => setAttr('label', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Compare (vs)</span>
				<input
					value={String(parsed.attrs.vs ?? '')}
					oninput={(e) => setAttr('vs', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Format</span>
				<select
					value={String(parsed.attrs.format ?? 'number')}
					onchange={(e) => setAttr('format', e.currentTarget.value)}
				>
					{#each ['number', 'currency', 'compact', 'percent'] as f (f)}
						<option value={f}>{f}</option>
					{/each}
				</select>
			</label>
		{:else if parsed.tagName === 'chart'}
			<label class="field">
				<span>Inherit chart config</span>
				<select
					value={String(parsed.attrs.ref ?? '')}
					onchange={(e) => {
						const ref = e.currentTarget.value || undefined;
						onPatch({ attrs: { ref, data: ref ? undefined : parsed.attrs.data } });
					}}
				>
					<option value="">configure here</option>
					{#each cellRefOptions as r (r)}
						<option value={r}>{r}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Data ref</span>
				<select
					value={String(parsed.attrs.data ?? '')}
					onchange={(e) => setAttr('data', e.currentTarget.value)}
				>
					<option value="">—</option>
					{#each rowRefOptions as r (r)}
						<option value={r}>{r}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Type</span>
				<select
					value={String(parsed.attrs.type ?? 'bar')}
					onchange={(e) => setAttr('type', e.currentTarget.value)}
				>
					{#each chartTypes as type (type)}
						<option value={type}>{type}</option>
					{/each}
				</select>
			</label>
			{#if String(parsed.attrs.type ?? 'bar') === 'histogram'}
				<label class="field">
					<span>Histogram bins</span>
					<input
						type="number"
						min="1"
						value={parsed.attrs.histogramBins != null ? Number(parsed.attrs.histogramBins) : ''}
						placeholder="auto"
						oninput={(e) => {
							const raw = e.currentTarget.value.trim();
							setAttr('histogramBins', raw ? Number(raw) : undefined);
						}}
					/>
				</label>
			{/if}
			<label class="field">
				<span>X column</span>
				<input
					list="visual-columns"
					value={String(parsed.attrs.x ?? '')}
					oninput={(e) => setAttr('x', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Y column</span>
				<input
					list="visual-columns"
					value={String(parsed.attrs.y ?? '')}
					oninput={(e) => setAttr('y', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Y columns (JSON array)</span>
				<input
					value={parsed.attrs.yColumns ? JSON.stringify(parsed.attrs.yColumns) : ''}
					oninput={(e) => setJsonArrayAttr('yColumns', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Secondary Y columns (JSON array)</span>
				<input
					value={parsed.attrs.yColumnsSecondary
						? JSON.stringify(parsed.attrs.yColumnsSecondary)
						: ''}
					oninput={(e) => setJsonArrayAttr('yColumnsSecondary', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Color column</span>
				<input
					list="visual-columns"
					value={String(parsed.attrs.colorColumn ?? '')}
					oninput={(e) => setAttr('colorColumn', e.currentTarget.value || undefined)}
				/>
			</label>
			<label class="field">
				<span>Size column</span>
				<input
					list="visual-columns"
					value={String(parsed.attrs.sizeColumn ?? '')}
					oninput={(e) => setAttr('sizeColumn', e.currentTarget.value || undefined)}
				/>
			</label>
			<label class="field">
				<span>Series mode</span>
				<select
					value={String(parsed.attrs.seriesMode ?? 'auto')}
					onchange={(e) => setAttr('seriesMode', e.currentTarget.value)}
				>
					{#each ['auto', 'grouped', 'stacked'] as mode (mode)}
						<option value={mode}>{mode}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Sort order</span>
				<select
					value={String(parsed.attrs.sortOrder ?? 'none')}
					onchange={(e) => setAttr('sortOrder', e.currentTarget.value)}
				>
					{#each ['none', 'asc', 'desc'] as order (order)}
						<option value={order}>{order}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Click-to-filter param</span>
				<input
					value={String(parsed.attrs.filterParam ?? '')}
					oninput={(e) => setAttr('filterParam', e.currentTarget.value || undefined)}
				/>
			</label>
			<label class="field">
				<span>Filter column</span>
				<input
					list="visual-columns"
					value={String(parsed.attrs.filterColumn ?? '')}
					oninput={(e) => setAttr('filterColumn', e.currentTarget.value || undefined)}
				/>
			</label>
			<label class="field">
				<span>Drill cell</span>
				<select
					value={String(parsed.attrs.drillCell ?? '')}
					onchange={(e) => setAttr('drillCell', e.currentTarget.value || undefined)}
				>
					<option value="">—</option>
					{#each cellRefOptions as r (r)}
						<option value={r.replace('$', '')}>{r.replace('$', '')}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Title</span>
				<input
					value={String(parsed.attrs.title ?? '')}
					oninput={(e) => setAttr('title', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Height</span>
				<input
					type="number"
					value={Number(parsed.attrs.height ?? 280)}
					oninput={(e) => setAttr('height', Number(e.currentTarget.value))}
				/>
			</label>
		{:else if parsed.tagName === 'datatable'}
			<p class="text-2xs font-medium text-muted-foreground">Mode: {tableMode}</p>
			<label class="field">
				<span>Data</span>
				<select
					value={String(parsed.attrs.data ?? '')}
					onchange={(e) => setAttr('data', e.currentTarget.value)}
				>
					<option value="">—</option>
					{#each rowRefOptions as r (r)}
						<option value={r}>{r}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Columns (JSON array)</span>
				<input
					value={parsed.attrs.cols ? JSON.stringify(parsed.attrs.cols) : ''}
					oninput={(e) => setJsonArrayAttr('cols', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Limit</span>
				<input
					type="number"
					value={Number(parsed.attrs.limit ?? 10)}
					oninput={(e) => setAttr('limit', Number(e.currentTarget.value))}
				/>
			</label>
			<label class="field">
				<span>Page size</span>
				<input
					type="number"
					value={Number(parsed.attrs.pageSize ?? 10)}
					oninput={(e) => setAttr('pageSize', Number(e.currentTarget.value))}
				/>
			</label>
			<label class="field">
				<span>Header insights</span>
				<select
					value={String(parsed.attrs.headerInsights ?? 'compact')}
					onchange={(e) => setAttr('headerInsights', e.currentTarget.value)}
				>
					<option value="compact">compact</option>
					<option value="full">full</option>
				</select>
			</label>
			<label class="field">
				<span>Linked filter param</span>
				<input
					value={String(parsed.attrs.linkedFilter ?? '')}
					oninput={(e) => setAttr('linkedFilter', e.currentTarget.value)}
				/>
			</label>
			<hr class="border-border" />
			<p class="text-2xs font-medium text-muted-foreground">Summary / pivot</p>
			<label class="field">
				<span>Index / group-by (JSON array)</span>
				<input
					value={parsed.attrs.index ? JSON.stringify(parsed.attrs.index) : ''}
					oninput={(e) => setJsonArrayAttr('index', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Pivot by column</span>
				<input
					list="visual-columns"
					value={String(parsed.attrs.pivotBy ?? '')}
					oninput={(e) => setAttr('pivotBy', e.currentTarget.value || undefined)}
				/>
			</label>
			<label class="field">
				<span>Value column</span>
				<input
					list="visual-columns"
					value={String(parsed.attrs.valueCol ?? '')}
					oninput={(e) => setAttr('valueCol', e.currentTarget.value || undefined)}
				/>
			</label>
			<label class="field">
				<span>Aggregation</span>
				<select
					value={String(parsed.attrs.agg ?? 'sum')}
					onchange={(e) => setAttr('agg', e.currentTarget.value)}
				>
					{#each aggOptions as a (a)}
						<option value={a}>{a}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Round decimals</span>
				<input
					type="number"
					value={parsed.attrs.round != null ? Number(parsed.attrs.round) : ''}
					oninput={(e) =>
						setAttr(
							'round',
							e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value)
						)}
				/>
			</label>
			<label class="field">
				<span>Value format</span>
				<select
					value={String(parsed.attrs.valueFormatKind ?? '')}
					onchange={(e) => setAttr('valueFormatKind', e.currentTarget.value || undefined)}
				>
					<option value="">auto</option>
					{#each formatKinds as f (f)}
						<option value={f}>{f}</option>
					{/each}
				</select>
			</label>
			{#if parsed.attrs.valueFormatKind === 'currency'}
				<label class="field">
					<span>Currency symbol</span>
					<input
						value={String(parsed.attrs.valueCurrencySymbol ?? '$')}
						oninput={(e) => setAttr('valueCurrencySymbol', e.currentTarget.value)}
					/>
				</label>
			{/if}
		{:else if parsed.tagName === 'filter'}
			{@const param = String(parsed.attrs.param ?? '')}
			<label class="field">
				<span>Param</span>
				<input
					value={String(parsed.attrs.param ?? '')}
					oninput={(e) => setAttr('param', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Label</span>
				<input
					value={String(parsed.attrs.label ?? '')}
					oninput={(e) => setAttr('label', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Kind</span>
				<select
					value={String(parsed.attrs.kind ?? 'dropdown')}
					onchange={(e) => setAttr('kind', e.currentTarget.value)}
				>
					{#each ['dropdown', 'text-input', 'date-range', 'button-group', 'multi-select', 'relative-date', 'numeric-range', 'searchable-dropdown'] as k (k)}
						<option value={k}>{k}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Options (JSON array or $cell.rows)</span>
				<input
					value={Array.isArray(parsed.attrs.options)
						? JSON.stringify(parsed.attrs.options)
						: String(parsed.attrs.options ?? '')}
					oninput={(e) => {
						const raw = e.currentTarget.value.trim();
						if (raw.startsWith('$')) setAttr('options', raw);
						else setJsonArrayAttr('options', raw);
					}}
				/>
			</label>
			<label class="field">
				<span>Options column</span>
				<input
					list="visual-columns"
					value={String(parsed.attrs.optionsColumn ?? '')}
					oninput={(e) => setAttr('optionsColumn', e.currentTarget.value || undefined)}
				/>
			</label>
			<label class="field">
				<span>Default</span>
				<input
					value={String(parsed.attrs.default ?? parsed.attrs.defaultValue ?? '')}
					oninput={(e) => setAttr('default', e.currentTarget.value || undefined)}
				/>
			</label>
			{#if parsed.attrs.kind === 'relative-date' || parsed.attrs.kind === 'date-range'}
				<label class="field">
					<span>Start param</span>
					<input
						value={String(parsed.attrs.startParam ?? '')}
						oninput={(e) => setAttr('startParam', e.currentTarget.value || undefined)}
					/>
				</label>
				<label class="field">
					<span>End param</span>
					<input
						value={String(parsed.attrs.endParam ?? '')}
						oninput={(e) => setAttr('endParam', e.currentTarget.value || undefined)}
					/>
				</label>
			{/if}
			{#if parsed.attrs.kind === 'numeric-range'}
				<label class="field">
					<span>Min param</span>
					<input
						value={String(parsed.attrs.minParam ?? '')}
						oninput={(e) => setAttr('minParam', e.currentTarget.value || undefined)}
					/>
				</label>
				<label class="field">
					<span>Max param</span>
					<input
						value={String(parsed.attrs.maxParam ?? '')}
						oninput={(e) => setAttr('maxParam', e.currentTarget.value || undefined)}
					/>
				</label>
			{/if}
			<div class="md-panel text-2xs">
				<p class="font-medium text-muted-foreground">Query wiring</p>
				{#if param && filterUsages[param]?.length}
					<ul class="mt-1 space-y-0.5">
						{#each filterUsages[param] as usage (usage.cellId)}
							<li><code>{usage.outputName}</code> uses <code>{'${' + param + '}'}</code></li>
						{/each}
					</ul>
				{:else if param}
					<p class="mt-1 text-warning">
						No query cell references <code>{'${' + param + '}'}</code>.
					</p>
				{:else}
					<p class="mt-1">Set a param to see linked query cells.</p>
				{/if}
			</div>
		{:else if parsed.tagName === 'badge'}
			<label class="field">
				<span>Value</span>
				<input
					value={String(parsed.attrs.value ?? '')}
					oninput={(e) => setAttr('value', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Color</span>
				<select
					value={String(parsed.attrs.color ?? 'info')}
					onchange={(e) => setAttr('color', e.currentTarget.value)}
				>
					{#each ['info', 'success', 'warning', 'error', 'neutral'] as c (c)}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</label>
		{:else if parsed.tagName === 'progress'}
			<label class="field">
				<span>Value</span>
				<input
					value={String(parsed.attrs.value ?? '')}
					oninput={(e) => setAttr('value', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Max</span>
				<input
					type="number"
					value={Number(parsed.attrs.max ?? 100)}
					oninput={(e) => setAttr('max', Number(e.currentTarget.value))}
				/>
			</label>
			<label class="field">
				<span>Label</span>
				<input
					value={String(parsed.attrs.label ?? '')}
					oninput={(e) => setAttr('label', e.currentTarget.value)}
				/>
			</label>
			<label class="field">
				<span>Color</span>
				<select
					value={String(parsed.attrs.color ?? 'info')}
					onchange={(e) => setAttr('color', e.currentTarget.value)}
				>
					{#each ['info', 'success', 'warning', 'error'] as c (c)}
						<option value={c}>{c}</option>
					{/each}
				</select>
			</label>
		{:else if parsed.tagName === 'grid' || parsed.tagName === 'columns' || parsed.tagName === 'column' || parsed.tagName === 'tabs' || parsed.tagName === 'tab' || parsed.tagName === 'details' || parsed.tagName === 'if' || parsed.tagName === 'group' || parsed.tagName === 'each' || parsed.tagName === 'mermaid'}
			{#if parsed.tagName === 'grid'}
				<label class="field">
					<span>Columns</span>
					<input
						type="number"
						value={Number(parsed.attrs.cols ?? 3)}
						oninput={(e) => setAttr('cols', Number(e.currentTarget.value))}
					/>
				</label>
			{:else if parsed.tagName === 'column'}
				<label class="field">
					<span>Width</span>
					<input
						value={String(parsed.attrs.width ?? '')}
						placeholder="300px, 40%, 1fr"
						oninput={(e) => setAttr('width', e.currentTarget.value || undefined)}
					/>
				</label>
			{:else if parsed.tagName === 'tab'}
				<label class="field">
					<span>Label</span>
					<input
						value={String(parsed.attrs.label ?? '')}
						oninput={(e) => setAttr('label', e.currentTarget.value)}
					/>
				</label>
			{:else if parsed.tagName === 'details'}
				<label class="field">
					<span>Summary</span>
					<input
						value={String(parsed.attrs.summary ?? '')}
						oninput={(e) => setAttr('summary', e.currentTarget.value)}
					/>
				</label>
				<label class="inline-field">
					<input
						type="checkbox"
						checked={Boolean(parsed.attrs.open)}
						onchange={(e) => setAttr('open', e.currentTarget.checked)}
					/>
					<span>Open by default</span>
				</label>
			{:else if parsed.tagName === 'if'}
				<label class="field">
					<span>Condition expression</span>
					<input
						value={String(parsed.condition ?? parsed.attrs.condition ?? '')}
						placeholder="gt($orders.count, 0)"
						oninput={(e) => setAttr('condition', e.currentTarget.value)}
					/>
				</label>
				<p class="text-2xs text-muted-foreground">
					Use comparison helpers like <code>gt($orders.count, 0)</code>. Keep else branches in the
					body source.
				</p>
			{:else if parsed.tagName === 'group'}
				<label class="field">
					<span>Data</span>
					<select
						value={String(parsed.attrs.data ?? '')}
						onchange={(e) => setAttr('data', e.currentTarget.value)}
					>
						<option value="">—</option>
						{#each rowRefOptions as r (r)}
							<option value={r}>{r}</option>
						{/each}
					</select>
				</label>
				<label class="field">
					<span>Group by</span>
					<input
						list="visual-columns"
						value={String(parsed.attrs.by ?? '')}
						oninput={(e) => setAttr('by', e.currentTarget.value)}
					/>
				</label>
				<label class="field">
					<span>Order (JSON array)</span>
					<input
						value={parsed.attrs.order ? JSON.stringify(parsed.attrs.order) : ''}
						oninput={(e) => setJsonArrayAttr('order', e.currentTarget.value)}
					/>
				</label>
			{:else if parsed.tagName === 'each'}
				<label class="field">
					<span>Data</span>
					<select
						value={String(parsed.attrs.data ?? '$items')}
						onchange={(e) => setAttr('data', e.currentTarget.value)}
					>
						<option value="$items">$items</option>
						{#each rowRefOptions as r (r)}
							<option value={r}>{r}</option>
						{/each}
					</select>
				</label>
			{:else if parsed.tagName === 'mermaid'}
				<label class="field">
					<span>Code ref</span>
					<select
						value={String(parsed.attrs.code ?? '')}
						onchange={(e) => setAttr('code', e.currentTarget.value || undefined)}
					>
						<option value="">body source</option>
						{#each refOptions() as r (r)}
							<option value={r}>{r}</option>
						{/each}
					</select>
				</label>
				<p class="text-2xs text-muted-foreground">
					Edit diagram source in the canvas (toggle Visual / Source on the block).
				</p>
			{/if}
		{:else if parsed.tagName === 'card' || parsed.tagName === 'callout'}
			{#if parsed.tagName === 'card'}
				<label class="field">
					<span>Title</span>
					<input
						value={String(parsed.attrs.title ?? '')}
						oninput={(e) => setAttr('title', e.currentTarget.value)}
					/>
				</label>
			{:else}
				<label class="field">
					<span>Type</span>
					<select
						value={String(parsed.attrs.type ?? 'info')}
						onchange={(e) => setAttr('type', e.currentTarget.value)}
					>
						{#each ['info', 'success', 'warning', 'error'] as t (t)}
							<option value={t}>{t}</option>
						{/each}
					</select>
				</label>
			{/if}
		{:else}
			<label class="field">
				<span>Source</span>
				<textarea
					class="min-h-28 font-mono"
					value={block.source}
					oninput={(e) => onPatch({ source: e.currentTarget.value })}
				></textarea>
			</label>
		{/if}
	</div>
{/if}

<style>
	.inspector-empty,
	.inspector-fence,
	.inspector-widget {
		padding: 0.5rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: var(--text-2xs);
	}
	.field span {
		color: var(--muted-foreground);
	}
	.field input,
	.field select,
	.field textarea {
		width: 100%;
		height: 1.65rem;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: var(--background);
		color: var(--foreground);
		padding: 0 0.45rem;
		font-size: var(--text-2xs);
	}
	.field textarea {
		height: auto;
		min-height: 4.5rem;
		padding: 0.35rem 0.45rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		resize: vertical;
	}
	.field input:focus-visible,
	.field select:focus-visible,
	.field textarea:focus-visible {
		outline: none;
		border-color: var(--primary);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary) 22%, transparent);
	}
	.inline-field {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--text-2xs);
		color: var(--muted-foreground);
	}
</style>
