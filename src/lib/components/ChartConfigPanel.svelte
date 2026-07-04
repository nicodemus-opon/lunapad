<script lang="ts">
	import {
		TrendingUp,
		BarChart2,
		AreaChart,
		ScatterChart,
		PieChart,
		BarChartHorizontal,
		Activity,
		Orbit,
		Grid2x2,
		CalendarDays,
		Filter,
		BoxSelect,
		GitFork,
		Table2,
		Hash,
		TrendingDown,
		Minus,
		Code2,
		MapPin,
		Globe
	} from '@lucide/svelte';
	import type { ChartConfig, ChartType, ChartSortOrder } from '$lib/types/gui-pipeline';
	import {
		coerceNumber,
		inferSmartChartConfig,
		inferSmartChartConfigForType,
		normalizeChartConfig,
		DEFAULT_CUSTOM_CHART_CODE
	} from '$lib/utils';
	import Editor from '$lib/components/Editor.svelte';
	import { CUSTOM_CHART_GLOBALS_DTS } from '$lib/services/plot-cell';

	interface Props {
		config: ChartConfig;
		columns: string[];
		rows: Record<string, unknown>[];
		onUpdate: (config: ChartConfig) => void;
	}

	const { config, columns, rows, onUpdate }: Props = $props();

	function update(patch: Partial<ChartConfig>) {
		onUpdate(normalizeChartConfig({ ...config, ...patch }));
	}

	function setChartTypeSmart(type: ChartType) {
		onUpdate(inferSmartChartConfigForType(columns, rows, type, config));
	}

	const chartTypes: { type: ChartType; label: string; Icon: typeof TrendingUp }[] = [
		{ type: 'table', label: 'Table', Icon: Table2 },
		{ type: 'big-value', label: 'KPI', Icon: Hash },
		{ type: 'delta', label: 'Delta', Icon: TrendingDown },
		{ type: 'value', label: 'Value', Icon: Minus },
		{ type: 'line', label: 'Line', Icon: TrendingUp },
		{ type: 'area', label: 'Area', Icon: AreaChart },
		{ type: 'bar', label: 'Bar', Icon: BarChart2 },
		{ type: 'bar-horizontal', label: 'Bar H', Icon: BarChartHorizontal },
		{ type: 'scatter', label: 'Scatter', Icon: ScatterChart },
		{ type: 'bubble', label: 'Bubble', Icon: Orbit },
		{ type: 'pie', label: 'Pie', Icon: PieChart },
		{ type: 'histogram', label: 'Hist', Icon: Activity },
		{ type: 'heatmap', label: 'Heatmap', Icon: Grid2x2 },
		{ type: 'calendar-heatmap', label: 'Calendar', Icon: CalendarDays },
		{ type: 'funnel', label: 'Funnel', Icon: Filter },
		{ type: 'box-plot', label: 'Box', Icon: BoxSelect },
		{ type: 'sankey', label: 'Sankey', Icon: GitFork },
		{ type: 'map', label: 'Map', Icon: MapPin },
		{ type: 'choropleth', label: 'Choropleth', Icon: Globe },
		{ type: 'custom', label: 'Custom', Icon: Code2 }
	];

	function cardinality(col: string): number {
		return new Set(rows.map((r) => r[col])).size;
	}
	function isDateColumn(col: string): boolean {
		const sample = rows
			.slice(0, 20)
			.map((r) => r[col])
			.filter((v) => v != null);
		if (sample.length === 0) return false;
		return (
			sample.filter((v) => !Number.isNaN(new Date(v as string | number).getTime())).length /
				sample.length >=
			0.8
		);
	}

	const colorCandidates = $derived(
		columns.filter((c) => c !== config.xColumn && cardinality(c) <= 20)
	);
	const numericCandidates = $derived(
		columns.filter((col) =>
			rows
				.map((r) => r[col])
				.filter((v) => v != null)
				.slice(0, 30)
				.some((v) => coerceNumber(v) !== null)
		)
	);
	const dateCandidates = $derived(columns.filter(isDateColumn));

	function toggleY(col: string) {
		const next = config.yColumns.includes(col)
			? config.yColumns.filter((c) => c !== col)
			: [...config.yColumns, col];
		if (next.length > 0) update({ yColumns: next });
	}
	function toggleSecondaryY(col: string) {
		const secondary = config.yColumnsSecondary ?? [];
		const next = secondary.includes(col) ? secondary.filter((c) => c !== col) : [...secondary, col];
		update({ yColumnsSecondary: next });
	}
	function setBoxPlotCol(idx: number, col: string) {
		const next = [...config.yColumns];
		next[idx] = col;
		while (next.length < 5) next.push('');
		update({ yColumns: next.filter(Boolean) });
	}

	const supportsSeriesMode = $derived(['bar', 'line', 'area'].includes(config.chartType));
	const supportsSizeColumn = $derived(['scatter', 'bubble', 'map'].includes(config.chartType));
	const supportsSecondaryAxis = $derived(['line', 'area'].includes(config.chartType));
	const supportsSortOrder = $derived(
		['bar', 'bar-horizontal', 'pie', 'funnel'].includes(config.chartType)
	);
	const supportsHistBins = $derived(config.chartType === 'histogram');
	const isHeatmap = $derived(config.chartType === 'heatmap');
	const isCalendarHeatmap = $derived(config.chartType === 'calendar-heatmap');
	const isFunnel = $derived(config.chartType === 'funnel');
	const isBoxPlot = $derived(config.chartType === 'box-plot');
	const isSankey = $derived(config.chartType === 'sankey');
	const isMap = $derived(config.chartType === 'map');
	const isChoropleth = $derived(config.chartType === 'choropleth');
	const isTable = $derived(config.chartType === 'table');
	const isCustom = $derived(config.chartType === 'custom');
	const isBigValue = $derived(config.chartType === 'big-value');
	const isDelta = $derived(config.chartType === 'delta');
	const isValue = $derived(config.chartType === 'value');
	const needsColorAsYAxis = $derived(isHeatmap || isSankey);

	const BOX_LABELS = ['Min', 'Q1 (25th)', 'Median', 'Q3 (75th)', 'Max'] as const;

	const sel =
		'w-full h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring';
	const label = 'text-2xs font-medium uppercase tracking-wide text-muted-foreground';

	// Infer the best chart type for the current data shape — used to surface a recommendation badge
	const recommendedChartType = $derived.by(() => {
		if (rows.length === 0) return null;
		try {
			return inferSmartChartConfig(columns, rows).chartType;
		} catch {
			return null;
		}
	});
</script>

<div class="space-y-3 text-sm">
	<!-- Title / Description -->
	<div class="space-y-1">
		<p class={label}>Title</p>
		<input
			type="text"
			class="{sel} mb-1"
			placeholder="Chart title"
			value={config.title ?? ''}
			oninput={(e) => update({ title: (e.target as HTMLInputElement).value || undefined })}
		/>
		<input
			type="text"
			class={sel}
			placeholder="Description"
			value={config.description ?? ''}
			oninput={(e) => update({ description: (e.target as HTMLInputElement).value || undefined })}
		/>
	</div>

	<div class="h-px bg-border"></div>

	<!-- Chart type picker -->
	<div class="space-y-1">
		<div class="flex items-center gap-1.5">
			<p class={label}>Chart Type</p>
			{#if recommendedChartType && recommendedChartType !== config.chartType}
				<span class="text-3xs text-muted-foreground/60"
					>· recommended: {chartTypes.find((c) => c.type === recommendedChartType)?.label ??
						recommendedChartType}</span
				>
			{/if}
		</div>
		<div class="grid grid-cols-4 gap-1">
			{#each chartTypes as ct (ct.type)}
				<button
					class="relative flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-2xs transition-colors
						{config.chartType === ct.type
						? 'border border-primary bg-primary/15 text-primary'
						: 'border border-transparent text-muted-foreground hover:bg-muted'}"
					onclick={() => setChartTypeSmart(ct.type)}
					title={ct.type === recommendedChartType
						? `${ct.label} (recommended for this data)`
						: ct.label}
				>
					{#if ct.type === recommendedChartType && config.chartType !== ct.type}
						<span class="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary/60"></span>
					{/if}
					<ct.Icon class="h-3.5 w-3.5" />
					{ct.label}
				</button>
			{/each}
		</div>
	</div>

	<div class="h-px bg-border"></div>

	<!-- Type-specific column config -->
	{#if isCustom}
		<div class="space-y-1">
			<p class={label}>Plot spec (JS)</p>
			<div class="h-64 overflow-hidden rounded-md border border-input">
				<Editor
					code={config.code ?? DEFAULT_CUSTOM_CHART_CODE}
					language="javascript"
					plotGlobalsDts={CUSTOM_CHART_GLOBALS_DTS}
					onchange={(code) => update({ code })}
				/>
			</div>
			<p class="text-2xs text-muted-foreground">
				Receives <code>rows</code>, <code>columns</code>. Return a Plotly figure object:
				<code>{'{ data: [...], layout: {...} }'}</code>.
			</p>
		</div>
	{:else if isTable}
		<p class="text-center text-xs text-muted-foreground">All columns shown as a table.</p>
		<div class="flex items-center gap-2">
			<div class="flex-1 space-y-1">
				<p class={label}>Rows per page</p>
				<select
					class={sel}
					value={String(config.tableRows ?? 10)}
					onchange={(e) => update({ tableRows: Number((e.target as HTMLSelectElement).value) })}
				>
					{#each [10, 25, 50, 100] as n (n)}<option value={String(n)}>{n}</option>{/each}
				</select>
			</div>
			<label class="flex cursor-pointer items-center gap-1.5 pt-4">
				<input
					type="checkbox"
					class="h-3.5 w-3.5 accent-primary"
					checked={config.tableSearch ?? false}
					onchange={(e) => update({ tableSearch: (e.target as HTMLInputElement).checked })}
				/>
				<span class="text-xs">Search</span>
			</label>
		</div>
	{:else if isBigValue}
		<div class="space-y-1">
			<p class={label}>Value Column</p>
			<select
				class={sel}
				value={config.xColumn}
				onchange={(e) => update({ xColumn: (e.target as HTMLSelectElement).value })}
			>
				{#each columns as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Comparison (optional)</p>
			<select
				class={sel}
				value={config.yColumns[0] ?? ''}
				onchange={(e) => {
					const v = (e.target as HTMLSelectElement).value;
					update({ yColumns: v ? [v] : [] });
				}}
			>
				<option value="">None</option>
				{#each numericCandidates.filter((c) => c !== config.xColumn) as col (col)}<option
						value={col}>{col}</option
					>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Sparkline Date (optional)</p>
			<select
				class={sel}
				value={config.colorColumn ?? ''}
				onchange={(e) => {
					const v = (e.target as HTMLSelectElement).value;
					update({ colorColumn: v || null });
				}}
			>
				<option value="">None</option>
				{#each (dateCandidates.length ? dateCandidates : columns).filter((c) => c !== config.xColumn) as col (col)}<option
						value={col}>{col}</option
					>{/each}
			</select>
		</div>
	{:else if isDelta}
		<div class="space-y-1">
			<p class={label}>Delta Column</p>
			<select
				class={sel}
				value={config.xColumn}
				onchange={(e) => update({ xColumn: (e.target as HTMLSelectElement).value })}
			>
				{#each numericCandidates as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
		<label class="flex cursor-pointer items-center gap-2">
			<input
				type="checkbox"
				class="h-3.5 w-3.5 accent-primary"
				checked={config.deltaDownIsGood ?? false}
				onchange={(e) => update({ deltaDownIsGood: (e.target as HTMLInputElement).checked })}
			/>
			<span class="text-xs">Down is good</span>
		</label>
	{:else if isValue}
		<div class="space-y-1">
			<p class={label}>Value Column</p>
			<select
				class={sel}
				value={config.xColumn}
				onchange={(e) => update({ xColumn: (e.target as HTMLSelectElement).value })}
			>
				{#each columns as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Row index</p>
			<input
				type="number"
				min="0"
				class={sel}
				value={config.valueRow ?? 0}
				oninput={(e) =>
					update({ valueRow: Math.max(0, Number((e.target as HTMLInputElement).value)) })}
			/>
		</div>
	{:else if isBoxPlot}
		<div class="space-y-1">
			<p class={label}>Name (X)</p>
			<select
				class={sel}
				value={config.xColumn}
				onchange={(e) => update({ xColumn: (e.target as HTMLSelectElement).value })}
			>
				{#each columns as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
		{#each BOX_LABELS as blabel, idx (blabel)}
			<div class="space-y-1">
				<p class={label}>{blabel}</p>
				<select
					class={sel}
					value={config.yColumns[idx] ?? ''}
					onchange={(e) => setBoxPlotCol(idx, (e.target as HTMLSelectElement).value)}
				>
					<option value="">— select —</option>
					{#each numericCandidates as col (col)}<option value={col}>{col}</option>{/each}
				</select>
			</div>
		{/each}
	{:else if isCalendarHeatmap}
		<div class="space-y-1">
			<p class={label}>Date Column</p>
			<select
				class={sel}
				value={config.xColumn}
				onchange={(e) => update({ xColumn: (e.target as HTMLSelectElement).value })}
			>
				{#each dateCandidates.length ? dateCandidates : columns as col (col)}<option value={col}
						>{col}</option
					>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Value Column</p>
			<select
				class={sel}
				value={config.yColumns[0] ?? ''}
				onchange={(e) => update({ yColumns: [(e.target as HTMLSelectElement).value] })}
			>
				{#each numericCandidates as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
	{:else if isHeatmap}
		<div class="space-y-1">
			<p class={label}>X Axis (categorical)</p>
			<select
				class={sel}
				value={config.xColumn}
				onchange={(e) => update({ xColumn: (e.target as HTMLSelectElement).value })}
			>
				{#each columns as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Y Axis (categorical)</p>
			<select
				class={sel}
				value={config.colorColumn ?? ''}
				onchange={(e) => update({ colorColumn: (e.target as HTMLSelectElement).value || null })}
			>
				<option value="">— select —</option>
				{#each columns.filter((c) => c !== config.xColumn) as col (col)}<option value={col}
						>{col}</option
					>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Value</p>
			<select
				class={sel}
				value={config.yColumns[0] ?? ''}
				onchange={(e) => update({ yColumns: [(e.target as HTMLSelectElement).value] })}
			>
				{#each numericCandidates as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
	{:else if isSankey}
		<div class="space-y-1">
			<p class={label}>Source</p>
			<select
				class={sel}
				value={config.xColumn}
				onchange={(e) => update({ xColumn: (e.target as HTMLSelectElement).value })}
			>
				{#each columns as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Target</p>
			<select
				class={sel}
				value={config.colorColumn ?? ''}
				onchange={(e) => update({ colorColumn: (e.target as HTMLSelectElement).value || null })}
			>
				<option value="">— select —</option>
				{#each columns.filter((c) => c !== config.xColumn) as col (col)}<option value={col}
						>{col}</option
					>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Value</p>
			<select
				class={sel}
				value={config.yColumns[0] ?? ''}
				onchange={(e) => update({ yColumns: [(e.target as HTMLSelectElement).value] })}
			>
				{#each numericCandidates as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
	{:else if isMap}
		<div class="space-y-1">
			<p class={label}>Latitude</p>
			<select
				class={sel}
				value={config.latColumn ?? ''}
				onchange={(e) => update({ latColumn: (e.target as HTMLSelectElement).value || null })}
			>
				<option value="">— select —</option>
				{#each numericCandidates as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Longitude</p>
			<select
				class={sel}
				value={config.lonColumn ?? ''}
				onchange={(e) => update({ lonColumn: (e.target as HTMLSelectElement).value || null })}
			>
				<option value="">— select —</option>
				{#each numericCandidates as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Value (optional, colors markers)</p>
			<select
				class={sel}
				value={config.yColumns[0] ?? ''}
				onchange={(e) => {
					const v = (e.target as HTMLSelectElement).value;
					update({ yColumns: v ? [v] : [] });
				}}
			>
				<option value="">None</option>
				{#each numericCandidates.filter((c) => c !== config.latColumn && c !== config.lonColumn) as col (col)}<option
						value={col}>{col}</option
					>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Label (optional)</p>
			<select
				class={sel}
				value={config.colorColumn ?? ''}
				onchange={(e) => update({ colorColumn: (e.target as HTMLSelectElement).value || null })}
			>
				<option value="">None</option>
				{#each columns.filter((c) => c !== config.latColumn && c !== config.lonColumn) as col (col)}<option
						value={col}>{col}</option
					>{/each}
			</select>
		</div>
	{:else if isChoropleth}
		<div class="space-y-1">
			<p class={label}>Location</p>
			<select
				class={sel}
				value={config.xColumn}
				onchange={(e) => update({ xColumn: (e.target as HTMLSelectElement).value })}
			>
				{#each columns as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Value</p>
			<select
				class={sel}
				value={config.yColumns[0] ?? ''}
				onchange={(e) => update({ yColumns: [(e.target as HTMLSelectElement).value] })}
			>
				{#each numericCandidates.filter((c) => c !== config.xColumn) as col (col)}<option
						value={col}>{col}</option
					>{/each}
			</select>
		</div>
		<div class="space-y-1">
			<p class={label}>Scope</p>
			<select
				class={sel}
				value={config.geoScope ?? 'world'}
				onchange={(e) =>
					update({ geoScope: (e.target as HTMLSelectElement).value as 'world' | 'usa-states' })}
			>
				<option value="world">World (ISO-3 codes)</option>
				<option value="usa-states">US states (2-letter codes)</option>
			</select>
		</div>
	{:else}
		<!-- Standard X / Y -->
		<div class="space-y-1">
			<p class={label}>{isFunnel ? 'Stage / Name' : 'X Axis'}</p>
			<select
				class={sel}
				value={config.xColumn}
				onchange={(e) => update({ xColumn: (e.target as HTMLSelectElement).value })}
			>
				{#each columns as col (col)}<option value={col}>{col}</option>{/each}
			</select>
		</div>

		{#if !isFunnel}
			<div class="space-y-1">
				<p class={label}>Y Axis</p>
				<div
					class="max-h-36 space-y-1 overflow-y-auto rounded-md border border-input bg-background px-2 py-1.5"
				>
					{#each numericCandidates.filter((c) => c !== config.xColumn) as col (col)}
						<label class="flex cursor-pointer items-center gap-2">
							<input
								type="checkbox"
								class="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
								checked={config.yColumns.includes(col)}
								onchange={() => toggleY(col)}
							/>
							<span class="truncate text-xs">{col}</span>
						</label>
					{/each}
					{#if numericCandidates.filter((c) => c !== config.xColumn).length === 0}
						<p class="text-xs text-muted-foreground">No numeric columns.</p>
					{/if}
				</div>
			</div>
		{:else}
			<div class="space-y-1">
				<p class={label}>Value Column</p>
				<select
					class={sel}
					value={config.yColumns[0] ?? ''}
					onchange={(e) => update({ yColumns: [(e.target as HTMLSelectElement).value] })}
				>
					{#each numericCandidates.filter((c) => c !== config.xColumn) as col (col)}<option
							value={col}>{col}</option
						>{/each}
				</select>
			</div>
		{/if}

		{#if supportsSecondaryAxis}
			<div class="space-y-1">
				<p class={label}>Secondary Y</p>
				<div
					class="max-h-24 space-y-1 overflow-y-auto rounded-md border border-input bg-background px-2 py-1.5"
				>
					{#each numericCandidates.filter((c) => c !== config.xColumn && !config.yColumns.includes(c)) as col (col)}
						<label class="flex cursor-pointer items-center gap-2">
							<input
								type="checkbox"
								class="h-3.5 w-3.5 cursor-pointer accent-chart-4"
								checked={(config.yColumnsSecondary ?? []).includes(col)}
								onchange={() => toggleSecondaryY(col)}
							/>
							<span class="truncate text-xs">{col}</span>
						</label>
					{/each}
				</div>
			</div>
		{/if}

		{#if !needsColorAsYAxis && colorCandidates.length > 0}
			<div class="space-y-1">
				<p class={label}>Color / Group</p>
				<select
					class={sel}
					value={config.colorColumn ?? ''}
					onchange={(e) => {
						const v = (e.target as HTMLSelectElement).value;
						update({ colorColumn: v || null });
					}}
				>
					<option value="">None</option>
					{#each colorCandidates as col (col)}<option value={col}>{col}</option>{/each}
				</select>
			</div>
		{/if}
	{/if}

	{#if supportsSeriesMode}
		<div class="space-y-1">
			<p class={label}>Series Mode</p>
			<select
				class={sel}
				value={config.seriesMode ?? 'auto'}
				onchange={(e) =>
					update({
						seriesMode: (e.target as HTMLSelectElement).value as 'auto' | 'grouped' | 'stacked'
					})}
			>
				<option value="auto">Auto</option>
				<option value="grouped">Grouped</option>
				<option value="stacked">Stacked</option>
			</select>
		</div>
	{/if}

	{#if supportsSizeColumn && numericCandidates.length > 0}
		<div class="space-y-1">
			<p class={label}>Size</p>
			<select
				class={sel}
				value={config.sizeColumn ?? ''}
				onchange={(e) => {
					const v = (e.target as HTMLSelectElement).value;
					update({ sizeColumn: v || null });
				}}
			>
				<option value="">None</option>
				{#each numericCandidates.filter((c) => c !== config.xColumn) as col (col)}<option
						value={col}>{col}</option
					>{/each}
			</select>
		</div>
	{/if}

	{#if supportsSortOrder}
		<div class="space-y-1">
			<p class={label}>Sort</p>
			<select
				class={sel}
				value={config.sortOrder ?? 'none'}
				onchange={(e) =>
					update({ sortOrder: (e.target as HTMLSelectElement).value as ChartSortOrder })}
			>
				<option value="none">Data order</option>
				<option value="desc">Descending</option>
				<option value="asc">Ascending</option>
			</select>
		</div>
	{/if}

	{#if supportsHistBins}
		<div class="space-y-1">
			<p class={label}>Bins</p>
			<select
				class={sel}
				value={String(config.histogramBins ?? 20)}
				onchange={(e) => update({ histogramBins: Number((e.target as HTMLSelectElement).value) })}
			>
				{#each [5, 10, 20, 50, 100] as n (n)}<option value={String(n)}>{n} bins</option>{/each}
			</select>
		</div>
	{/if}
</div>
