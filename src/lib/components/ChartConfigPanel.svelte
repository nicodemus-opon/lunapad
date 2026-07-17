<script lang="ts">
	import {
		Activity,
		AreaChart,
		BadgePercent,
		BarChart2,
		BarChartHorizontal,
		BoxSelect,
		CalendarDays,
		Check,
		ChevronRight,
		Code2,
		Columns3,
		Filter,
		GitFork,
		Globe,
		Grid2x2,
		Hash,
		Info,
		Layers3,
		ListChecks,
		MapPin,
		Minus,
		MoreHorizontal,
		Orbit,
		Palette,
		PieChart,
		Rows3,
		ScatterChart,
		Search,
		Settings2,
		SlidersHorizontal,
		Table2,
		Text,
		TrendingDown,
		TrendingUp
	} from '@lucide/svelte';
	import type { LucideIcon } from '@lucide/svelte';
	import type { ChartConfig, ChartSortOrder, ChartType } from '$lib/types/gui-pipeline';
	import {
		coerceNumber,
		DEFAULT_CUSTOM_CHART_CODE,
		inferSmartChartConfig,
		inferSmartChartConfigForType,
		normalizeChartConfig
	} from '$lib/utils';
	import Editor from '$lib/components/Editor.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Command from '$lib/components/ui/command';
	import { Input } from '$lib/components/ui/input';
	import { NativeSelect } from '$lib/components/ui/native-select';
	import * as Popover from '$lib/components/ui/popover';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { CUSTOM_CHART_GLOBALS_DTS } from '$lib/services/plot-cell';

	interface Props {
		config: ChartConfig;
		columns: string[];
		rows: Record<string, unknown>[];
		onUpdate: (config: ChartConfig) => void;
	}

	type IconComponent = LucideIcon;

	const { config, columns, rows, onUpdate }: Props = $props();

	let openPicker = $state<string | null>(null);
	let pickerSearch = $state('');

	function update(patch: Partial<ChartConfig>) {
		onUpdate(normalizeChartConfig({ ...config, ...patch }));
	}

	function setChartTypeSmart(type: ChartType) {
		openPicker = null;
		onUpdate(inferSmartChartConfigForType(columns, rows, type, config));
	}

	const chartTypes: { type: ChartType; label: string; Icon: IconComponent }[] = [
		{ type: 'table', label: 'Table', Icon: Table2 },
		{ type: 'big-value', label: 'KPI', Icon: Hash },
		{ type: 'delta', label: 'Delta', Icon: TrendingDown },
		{ type: 'value', label: 'Value', Icon: Minus },
		{ type: 'line', label: 'Line', Icon: TrendingUp },
		{ type: 'area', label: 'Area', Icon: AreaChart },
		{ type: 'bar', label: 'Bar', Icon: BarChart2 },
		{ type: 'bar-horizontal', label: 'Horizontal bar', Icon: BarChartHorizontal },
		{ type: 'scatter', label: 'Scatter', Icon: ScatterChart },
		{ type: 'bubble', label: 'Bubble', Icon: Orbit },
		{ type: 'pie', label: 'Pie', Icon: PieChart },
		{ type: 'histogram', label: 'Histogram', Icon: Activity },
		{ type: 'heatmap', label: 'Heatmap', Icon: Grid2x2 },
		{ type: 'calendar-heatmap', label: 'Calendar heatmap', Icon: CalendarDays },
		{ type: 'funnel', label: 'Funnel', Icon: Filter },
		{ type: 'box-plot', label: 'Box plot', Icon: BoxSelect },
		{ type: 'sankey', label: 'Sankey', Icon: GitFork },
		{ type: 'map', label: 'Map', Icon: MapPin },
		{ type: 'choropleth', label: 'Choropleth', Icon: Globe },
		{ type: 'custom', label: 'Custom', Icon: Code2 }
	];

	const primaryChartTypes: ChartType[] = [
		'table',
		'bar',
		'bar-horizontal',
		'line',
		'area',
		'pie',
		'big-value',
		'value',
		'scatter'
	];
	const primaryChartSet = new Set<ChartType>(primaryChartTypes);
	const primaryCharts = chartTypes.filter((ct) => primaryChartSet.has(ct.type));
	const advancedCharts = chartTypes.filter((ct) => !primaryChartSet.has(ct.type));

	function chartLabel(type: ChartType | null | undefined): string {
		return chartTypes.find((ct) => ct.type === type)?.label ?? 'Chart';
	}

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

	const recommendedChartType = $derived.by(() => {
		if (rows.length === 0) return null;
		try {
			return inferSmartChartConfig(columns, rows).chartType;
		} catch {
			return null;
		}
	});

	const isAdvancedChartSelected = $derived(!primaryChartSet.has(config.chartType));

	function openRow(id: string, open: boolean) {
		openPicker = open ? id : null;
		if (open) pickerSearch = '';
	}

	function filteredCandidates(candidates: string[]): string[] {
		const query = pickerSearch.trim().toLowerCase();
		if (!query) return candidates;
		return candidates.filter((col) => col.toLowerCase().includes(query));
	}

	function displayValue(value: string | null | undefined, fallback = 'None'): string {
		return value?.trim() ? value : fallback;
	}

	function multiSummary(values: string[], fallback = 'None'): string {
		if (values.length === 0) return fallback;
		if (values.length === 1) return values[0];
		return `${values.length} selected`;
	}

	function selectColumn(value: string, patch: Partial<ChartConfig>) {
		openPicker = null;
		update(patch);
	}

	function chooseBoxPlotCol(idx: number, col: string) {
		openPicker = null;
		setBoxPlotCol(idx, col);
	}

	function setOptionalYColumn(value: string) {
		selectColumn(value, { yColumns: value ? [value] : [] });
	}
</script>

{#snippet chartTypeButton(ct: { type: ChartType; label: string; Icon: IconComponent })}
	<Tooltip.Root>
		<Tooltip.Trigger>
			<Button
				variant="ghost"
				size="icon-sm"
				class="chart-type-button {config.chartType === ct.type ? 'is-active' : ''}"
				onclick={() => setChartTypeSmart(ct.type)}
				aria-label={ct.type === recommendedChartType ? `${ct.label}, recommended` : ct.label}
				aria-pressed={config.chartType === ct.type}
			>
				{#if ct.type === recommendedChartType && config.chartType !== ct.type}
					<span class="recommendation-dot" aria-hidden="true"></span>
				{/if}
				<ct.Icon class="size-4" />
			</Button>
		</Tooltip.Trigger>
		<Tooltip.Content side="top">
			<p class="text-xs">
				{ct.label}{ct.type === recommendedChartType ? ' · recommended' : ''}
			</p>
		</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

{#snippet rowValue(value: string, muted = false)}
	<span class="inspector-row-value {muted ? 'is-muted' : ''}" title={value}>{value}</span>
	<ChevronRight class="inspector-row-chevron" aria-hidden="true" />
{/snippet}

{#snippet columnPicker(
	id: string,
	Icon: IconComponent,
	title: string,
	value: string | null | undefined,
	candidates: string[],
	onPick: (value: string) => void,
	allowNone = false,
	empty = 'No columns.'
)}
	<Popover.Root open={openPicker === id} onOpenChange={(open) => openRow(id, open)}>
		<Popover.Trigger class="inspector-row" aria-label={`${title}: ${displayValue(value)}`}>
			<span class="inspector-row-left">
				<Icon class="inspector-row-icon" aria-hidden={true} />
				<span class="inspector-row-label">{title}</span>
			</span>
			{@render rowValue(displayValue(value), !value)}
		</Popover.Trigger>
		<Popover.Content class="w-72 p-0" align="start">
			<Command.Root class="border-0 shadow-none">
				<div class="picker-search">
					<Search class="size-3.5 text-muted-foreground/70" aria-hidden="true" />
					<Input
						class="picker-search-input"
						placeholder="Search columns"
						bind:value={pickerSearch}
					/>
				</div>
				<Command.List class="picker-list">
					{#if allowNone}
						<Command.Item class="picker-item" onclick={() => onPick('')}>
							<span class="picker-item-check">{!value ? '✓' : ''}</span>
							<span class="picker-item-label">None</span>
						</Command.Item>
					{/if}
					{#each filteredCandidates(candidates) as col (col)}
						<Command.Item class="picker-item" onclick={() => onPick(col)}>
							<span class="picker-item-check">{value === col ? '✓' : ''}</span>
							<span class="picker-item-label" title={col}>{col}</span>
						</Command.Item>
					{:else}
						<Command.Empty class="px-3 py-6 text-center text-xs text-muted-foreground">
							{empty}
						</Command.Empty>
					{/each}
				</Command.List>
			</Command.Root>
		</Popover.Content>
	</Popover.Root>
{/snippet}

{#snippet multiColumnPicker(
	id: string,
	Icon: IconComponent,
	title: string,
	selected: string[],
	candidates: string[],
	onToggle: (value: string) => void,
	empty = 'No numeric columns.'
)}
	<Popover.Root open={openPicker === id} onOpenChange={(open) => openRow(id, open)}>
		<Popover.Trigger class="inspector-row" aria-label={`${title}: ${multiSummary(selected)}`}>
			<span class="inspector-row-left">
				<Icon class="inspector-row-icon" aria-hidden={true} />
				<span class="inspector-row-label">{title}</span>
			</span>
			{@render rowValue(multiSummary(selected), selected.length === 0)}
		</Popover.Trigger>
		<Popover.Content class="w-72 p-0" align="start">
			<Command.Root class="border-0 shadow-none">
				<div class="picker-search">
					<Search class="size-3.5 text-muted-foreground/70" aria-hidden="true" />
					<Input
						class="picker-search-input"
						placeholder="Search columns"
						bind:value={pickerSearch}
					/>
				</div>
				<Command.List class="picker-list">
					{#each filteredCandidates(candidates) as col (col)}
						<Command.Item class="picker-item is-check" onclick={() => onToggle(col)}>
							<Checkbox checked={selected.includes(col)} aria-label={col} />
							<span class="picker-item-label" title={col}>{col}</span>
						</Command.Item>
					{:else}
						<Command.Empty class="px-3 py-6 text-center text-xs text-muted-foreground">
							{empty}
						</Command.Empty>
					{/each}
				</Command.List>
			</Command.Root>
		</Popover.Content>
	</Popover.Root>
{/snippet}

{#snippet checkRow(
	Icon: IconComponent,
	title: string,
	checked: boolean,
	onChange: (checked: boolean) => void
)}
	<label class="inspector-row is-check-row">
		<span class="inspector-row-left">
			<Icon class="inspector-row-icon" aria-hidden={true} />
			<span class="inspector-row-label">{title}</span>
		</span>
		<Checkbox {checked} onCheckedChange={(next) => onChange(Boolean(next))} />
	</label>
{/snippet}

<div class="chart-config-panel">
	<div class="inspector-header">
		<div class="min-w-0">
			<p class="inspector-title">View options</p>
			<p class="inspector-subtitle">{chartLabel(config.chartType)}</p>
		</div>
		{#if recommendedChartType && recommendedChartType !== config.chartType}
			<button
				type="button"
				class="recommendation-pill"
				onclick={() => setChartTypeSmart(recommendedChartType)}
				title={`Switch to ${chartLabel(recommendedChartType)}`}
			>
				{chartLabel(recommendedChartType)}
			</button>
		{/if}
	</div>

	<div class="inspector-section">
		<p class="inspector-section-title">Chart type</p>
		<div class="inspector-section-body">
			<Tooltip.Provider>
				<div class="chart-type-grid">
					{#each primaryCharts as ct (ct.type)}
						{@render chartTypeButton(ct)}
					{/each}
					<Popover.Root
						open={openPicker === 'chart-type-more'}
						onOpenChange={(open) => openRow('chart-type-more', open)}
					>
						<Popover.Trigger
							class="chart-type-button {isAdvancedChartSelected ? 'is-active' : ''}"
							aria-label="More chart types"
							aria-pressed={isAdvancedChartSelected}
							title={isAdvancedChartSelected ? chartLabel(config.chartType) : 'More chart types'}
						>
							<MoreHorizontal class="size-4" />
						</Popover.Trigger>
						<Popover.Content class="w-64 p-1.5" align="start">
							<div class="advanced-chart-list">
								{#each advancedCharts as ct (ct.type)}
									<button
										type="button"
										class="advanced-chart-item {config.chartType === ct.type ? 'is-active' : ''}"
										onclick={() => setChartTypeSmart(ct.type)}
									>
										<ct.Icon class="size-4" aria-hidden={true} />
										<span>{ct.label}</span>
										{#if ct.type === recommendedChartType}
											<span class="ml-auto text-3xs text-primary">recommended</span>
										{:else if config.chartType === ct.type}
											<Check class="ml-auto size-3.5" aria-hidden="true" />
										{/if}
									</button>
								{/each}
							</div>
						</Popover.Content>
					</Popover.Root>
				</div>
			</Tooltip.Provider>
		</div>
	</div>

	<div class="inspector-section">
		<p class="inspector-section-title">Title</p>
		<div class="inspector-section-body">
			<div class="text-fields">
				<Input
					type="text"
					class="chart-config-control"
					placeholder="Chart title"
					value={config.title ?? ''}
					oninput={(e) => update({ title: (e.target as HTMLInputElement).value || undefined })}
				/>
				<Input
					type="text"
					class="chart-config-control"
					placeholder="Description"
					value={config.description ?? ''}
					oninput={(e) =>
						update({ description: (e.target as HTMLInputElement).value || undefined })}
				/>
			</div>
		</div>
	</div>

	{#if isCustom}
		<div class="inspector-section">
			<p class="inspector-section-title">Advanced</p>
			<div class="inspector-section-body">
				<div class="custom-editor">
					<Editor
						code={config.code ?? DEFAULT_CUSTOM_CHART_CODE}
						language="javascript"
						plotGlobalsDts={CUSTOM_CHART_GLOBALS_DTS}
						onchange={(code) => update({ code })}
					/>
				</div>
				<p class="inspector-help">
					Receives <code>rows</code> and <code>columns</code>. Return a Plotly figure object.
				</p>
			</div>
		</div>
	{:else}
		<div class="inspector-section">
			<p class="inspector-section-title">Data</p>
			<div class="inspector-section-body">
				{#if isTable}
					<div class="inspector-note">
						<Info class="size-3.5" aria-hidden="true" />
						<span>All result columns are shown.</span>
					</div>
				{:else if isBigValue}
					{@render columnPicker(
						'big-value-value',
						Hash,
						'Value column',
						config.xColumn,
						columns,
						(value) => selectColumn(value, { xColumn: value })
					)}
					{@render columnPicker(
						'big-value-comparison',
						TrendingDown,
						'Comparison',
						config.yColumns[0],
						numericCandidates.filter((c) => c !== config.xColumn),
						setOptionalYColumn,
						true
					)}
					{@render columnPicker(
						'big-value-sparkline',
						CalendarDays,
						'Sparkline date',
						config.colorColumn,
						(dateCandidates.length ? dateCandidates : columns).filter((c) => c !== config.xColumn),
						(value) => selectColumn(value, { colorColumn: value || null }),
						true
					)}
				{:else if isDelta}
					{@render columnPicker(
						'delta-column',
						TrendingDown,
						'Delta column',
						config.xColumn,
						numericCandidates,
						(value) => selectColumn(value, { xColumn: value })
					)}
				{:else if isValue}
					{@render columnPicker(
						'value-column',
						Hash,
						'Value column',
						config.xColumn,
						columns,
						(value) => selectColumn(value, { xColumn: value })
					)}
				{:else if isBoxPlot}
					{@render columnPicker('box-name', Text, 'Name', config.xColumn, columns, (value) =>
						selectColumn(value, { xColumn: value })
					)}
					{#each BOX_LABELS as blabel, idx (blabel)}
						{@render columnPicker(
							`box-${idx}`,
							Rows3,
							blabel,
							config.yColumns[idx],
							numericCandidates,
							(value) => chooseBoxPlotCol(idx, value),
							true
						)}
					{/each}
				{:else if isCalendarHeatmap}
					{@render columnPicker(
						'calendar-date',
						CalendarDays,
						'Date',
						config.xColumn,
						dateCandidates.length ? dateCandidates : columns,
						(value) => selectColumn(value, { xColumn: value })
					)}
					{@render columnPicker(
						'calendar-value',
						Hash,
						'Value',
						config.yColumns[0],
						numericCandidates,
						(value) => selectColumn(value, { yColumns: [value] })
					)}
				{:else if isHeatmap}
					{@render columnPicker('heatmap-x', Columns3, 'X axis', config.xColumn, columns, (value) =>
						selectColumn(value, { xColumn: value })
					)}
					{@render columnPicker(
						'heatmap-y',
						Rows3,
						'Y axis',
						config.colorColumn,
						columns.filter((c) => c !== config.xColumn),
						(value) => selectColumn(value, { colorColumn: value || null }),
						true
					)}
					{@render columnPicker(
						'heatmap-value',
						Hash,
						'Value',
						config.yColumns[0],
						numericCandidates,
						(value) => selectColumn(value, { yColumns: [value] })
					)}
				{:else if isSankey}
					{@render columnPicker(
						'sankey-source',
						GitFork,
						'Source',
						config.xColumn,
						columns,
						(value) => selectColumn(value, { xColumn: value })
					)}
					{@render columnPicker(
						'sankey-target',
						GitFork,
						'Target',
						config.colorColumn,
						columns.filter((c) => c !== config.xColumn),
						(value) => selectColumn(value, { colorColumn: value || null }),
						true
					)}
					{@render columnPicker(
						'sankey-value',
						Hash,
						'Value',
						config.yColumns[0],
						numericCandidates,
						(value) => selectColumn(value, { yColumns: [value] })
					)}
				{:else if isMap}
					{@render columnPicker(
						'map-lat',
						MapPin,
						'Latitude',
						config.latColumn,
						numericCandidates,
						(value) => selectColumn(value, { latColumn: value || null }),
						true
					)}
					{@render columnPicker(
						'map-lon',
						MapPin,
						'Longitude',
						config.lonColumn,
						numericCandidates,
						(value) => selectColumn(value, { lonColumn: value || null }),
						true
					)}
					{@render columnPicker(
						'map-value',
						Hash,
						'Value',
						config.yColumns[0],
						numericCandidates.filter((c) => c !== config.latColumn && c !== config.lonColumn),
						setOptionalYColumn,
						true
					)}
					{@render columnPicker(
						'map-label',
						Text,
						'Label',
						config.colorColumn,
						columns.filter((c) => c !== config.latColumn && c !== config.lonColumn),
						(value) => selectColumn(value, { colorColumn: value || null }),
						true
					)}
				{:else if isChoropleth}
					{@render columnPicker(
						'choropleth-location',
						Globe,
						'Location',
						config.xColumn,
						columns,
						(value) => selectColumn(value, { xColumn: value })
					)}
					{@render columnPicker(
						'choropleth-value',
						Hash,
						'Value',
						config.yColumns[0],
						numericCandidates.filter((c) => c !== config.xColumn),
						(value) => selectColumn(value, { yColumns: [value] })
					)}
				{:else}
					{@render columnPicker(
						'standard-x',
						Columns3,
						isFunnel ? 'Stage / name' : 'X Axis',
						config.xColumn,
						columns,
						(value) => selectColumn(value, { xColumn: value })
					)}
					{#if isFunnel}
						{@render columnPicker(
							'funnel-value',
							Hash,
							'Value column',
							config.yColumns[0],
							numericCandidates.filter((c) => c !== config.xColumn),
							(value) => selectColumn(value, { yColumns: [value] })
						)}
					{:else}
						{@render multiColumnPicker(
							'standard-y',
							Rows3,
							'Y Axis',
							config.yColumns,
							numericCandidates.filter((c) => c !== config.xColumn),
							toggleY
						)}
					{/if}
					{#if supportsSecondaryAxis}
						{@render multiColumnPicker(
							'secondary-y',
							Layers3,
							'Secondary Y',
							config.yColumnsSecondary ?? [],
							numericCandidates.filter((c) => c !== config.xColumn && !config.yColumns.includes(c)),
							toggleSecondaryY,
							'No available numeric columns.'
						)}
					{/if}
					{#if !needsColorAsYAxis && colorCandidates.length > 0}
						{@render columnPicker(
							'color-group',
							Palette,
							'Color / Group',
							config.colorColumn,
							colorCandidates,
							(value) => selectColumn(value, { colorColumn: value || null }),
							true
						)}
					{/if}
				{/if}
			</div>
		</div>

		<div class="inspector-section">
			<p class="inspector-section-title">Style</p>
			<div class="inspector-section-body">
				{#if isTable}
					<div class="inspector-row is-control-row">
						<span class="inspector-row-left">
							<Rows3 class="inspector-row-icon" aria-hidden="true" />
							<span class="inspector-row-label">Rows per page</span>
						</span>
						<NativeSelect
							class="inspector-select"
							value={String(config.tableRows ?? 10)}
							onchange={(e) => update({ tableRows: Number((e.target as HTMLSelectElement).value) })}
						>
							{#each [10, 25, 50, 100] as n (n)}<option value={String(n)}>{n}</option>{/each}
						</NativeSelect>
					</div>
					{@render checkRow(Search, 'Search', config.tableSearch ?? false, (checked) =>
						update({ tableSearch: checked })
					)}
				{/if}

				{#if isDelta}
					{@render checkRow(
						TrendingDown,
						'Down is good',
						config.deltaDownIsGood ?? false,
						(checked) => update({ deltaDownIsGood: checked })
					)}
				{/if}

				{#if isValue}
					<div class="inspector-row is-control-row">
						<span class="inspector-row-left">
							<Hash class="inspector-row-icon" aria-hidden="true" />
							<span class="inspector-row-label">Row index</span>
						</span>
						<Input
							type="number"
							min="0"
							class="inspector-number"
							value={config.valueRow ?? 0}
							oninput={(e) =>
								update({ valueRow: Math.max(0, Number((e.target as HTMLInputElement).value)) })}
						/>
					</div>
				{/if}

				{#if isChoropleth}
					<div class="inspector-row is-control-row">
						<span class="inspector-row-left">
							<Globe class="inspector-row-icon" aria-hidden="true" />
							<span class="inspector-row-label">Scope</span>
						</span>
						<NativeSelect
							class="inspector-select"
							value={config.geoScope ?? 'world'}
							onchange={(e) =>
								update({
									geoScope: (e.target as HTMLSelectElement).value as 'world' | 'usa-states'
								})}
						>
							<option value="world">World</option>
							<option value="usa-states">US states</option>
						</NativeSelect>
					</div>
				{/if}

				{#if supportsSeriesMode}
					<div class="inspector-row is-control-row">
						<span class="inspector-row-left">
							<Layers3 class="inspector-row-icon" aria-hidden="true" />
							<span class="inspector-row-label">Series mode</span>
						</span>
						<NativeSelect
							class="inspector-select"
							value={config.seriesMode ?? 'auto'}
							onchange={(e) =>
								update({
									seriesMode: (e.target as HTMLSelectElement).value as
										| 'auto'
										| 'grouped'
										| 'stacked'
								})}
						>
							<option value="auto">Auto</option>
							<option value="grouped">Grouped</option>
							<option value="stacked">Stacked</option>
						</NativeSelect>
					</div>
				{/if}

				{#if supportsSizeColumn && numericCandidates.length > 0}
					{@render columnPicker(
						'size',
						BadgePercent,
						'Size',
						config.sizeColumn,
						numericCandidates.filter((c) => c !== config.xColumn),
						(value) => selectColumn(value, { sizeColumn: value || null }),
						true
					)}
				{/if}

				{#if supportsSortOrder}
					<div class="inspector-row is-control-row">
						<span class="inspector-row-left">
							<ListChecks class="inspector-row-icon" aria-hidden="true" />
							<span class="inspector-row-label">Sort</span>
						</span>
						<NativeSelect
							class="inspector-select"
							value={config.sortOrder ?? 'none'}
							onchange={(e) =>
								update({ sortOrder: (e.target as HTMLSelectElement).value as ChartSortOrder })}
						>
							<option value="none">Data order</option>
							<option value="desc">Descending</option>
							<option value="asc">Ascending</option>
						</NativeSelect>
					</div>
				{/if}

				{#if supportsHistBins}
					<div class="inspector-row is-control-row">
						<span class="inspector-row-left">
							<SlidersHorizontal class="inspector-row-icon" aria-hidden="true" />
							<span class="inspector-row-label">Bins</span>
						</span>
						<NativeSelect
							class="inspector-select"
							value={String(config.histogramBins ?? 20)}
							onchange={(e) =>
								update({ histogramBins: Number((e.target as HTMLSelectElement).value) })}
						>
							{#each [5, 10, 20, 50, 100] as n (n)}<option value={String(n)}>{n}</option>{/each}
						</NativeSelect>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.chart-config-panel {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.75rem;
		color: var(--foreground);
	}

	.inspector-header {
		display: flex;
		min-width: 0;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.inspector-title,
	.inspector-subtitle,
	.inspector-section-title,
	.inspector-help {
		margin: 0;
	}

	.inspector-title {
		font-size: var(--text-sm);
		font-weight: 620;
		line-height: 1.15;
	}

	.inspector-subtitle {
		margin-top: 0.125rem;
		overflow: hidden;
		color: var(--muted-foreground);
		font-size: var(--text-2xs);
		line-height: 1.2;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.recommendation-pill {
		max-width: 7.5rem;
		flex: none;
		overflow: hidden;
		border: 1px solid color-mix(in oklab, var(--primary) 38%, var(--border));
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--primary) 9%, transparent);
		padding: 0.1875rem 0.375rem;
		color: var(--primary);
		font-size: var(--text-3xs);
		line-height: 1;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.inspector-section {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.35rem;
	}

	.inspector-section-title {
		color: color-mix(in oklab, var(--muted-foreground) 88%, var(--foreground));
		font-size: var(--text-2xs);
		font-weight: 620;
		line-height: 1.2;
	}

	.inspector-section-body {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 0.125rem;
	}

	.chart-type-grid {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 0.25rem;
	}

	:global(.chart-type-button) {
		position: relative;
		display: inline-flex;
		height: 2rem;
		width: 100%;
		align-items: center;
		justify-content: center;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: transparent;
		color: color-mix(in oklab, var(--muted-foreground) 85%, transparent);
		transition:
			background var(--motion-fast) var(--motion-ease-out),
			border-color var(--motion-fast) var(--motion-ease-out),
			color var(--motion-fast) var(--motion-ease-out),
			box-shadow var(--motion-fast) var(--motion-ease-out);
	}

	:global(.chart-type-button:hover) {
		border-color: color-mix(in oklab, var(--border) 76%, transparent);
		background: color-mix(in oklab, var(--muted) 32%, transparent);
		color: var(--foreground);
	}

	:global(.chart-type-button:focus-visible) {
		border-color: var(--ring);
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 22%, transparent);
	}

	:global(.chart-type-button.is-active) {
		border-color: color-mix(in oklab, var(--primary) 45%, var(--border));
		background: color-mix(in oklab, var(--primary) 11%, transparent);
		color: var(--foreground);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--primary) 18%, transparent);
	}

	.recommendation-dot {
		position: absolute;
		top: 0.3125rem;
		right: 0.3125rem;
		width: 0.35rem;
		height: 0.35rem;
		border-radius: 999px;
		background: var(--primary);
	}

	.advanced-chart-list {
		display: flex;
		max-height: 16rem;
		flex-direction: column;
		gap: 0.0625rem;
		overflow-y: auto;
	}

	.advanced-chart-item {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 0.5rem;
		border-radius: var(--radius-sm);
		padding: 0.4rem 0.5rem;
		color: var(--muted-foreground);
		font-size: var(--text-xs);
		text-align: left;
		transition:
			background var(--motion-fast) var(--motion-ease-out),
			color var(--motion-fast) var(--motion-ease-out);
	}

	.advanced-chart-item:hover,
	.advanced-chart-item.is-active {
		background: color-mix(in oklab, var(--muted) 42%, transparent);
		color: var(--foreground);
	}

	.text-fields {
		display: grid;
		gap: 0.375rem;
	}

	:global(.chart-config-control) {
		height: 1.875rem;
		border-color: color-mix(in oklab, var(--border) 72%, transparent);
		background: color-mix(in oklab, var(--muted) 14%, transparent);
		font-size: var(--text-xs);
		box-shadow: none;
	}

	.inspector-row {
		display: grid;
		min-height: 2rem;
		width: 100%;
		min-width: 0;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.4rem;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		padding: 0.25rem 0.375rem;
		color: var(--foreground);
		text-align: left;
		transition:
			background var(--motion-fast) var(--motion-ease-out),
			color var(--motion-fast) var(--motion-ease-out);
	}

	.inspector-row:hover {
		background: color-mix(in oklab, var(--muted) 34%, transparent);
	}

	.inspector-row:focus-visible {
		background: color-mix(in oklab, var(--muted) 38%, transparent);
		outline: 2px solid color-mix(in oklab, var(--ring) 40%, transparent);
		outline-offset: 1px;
	}

	.inspector-row.is-control-row {
		grid-template-columns: minmax(0, 1fr) minmax(5.75rem, 8.25rem);
	}

	.inspector-row.is-check-row {
		cursor: pointer;
	}

	.inspector-row-left {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.5rem;
	}

	:global(.inspector-row-icon) {
		width: 0.875rem;
		height: 0.875rem;
		flex: none;
		color: color-mix(in oklab, var(--muted-foreground) 80%, transparent);
	}

	.inspector-row-label {
		min-width: 0;
		overflow: hidden;
		font-size: var(--text-xs);
		font-weight: 500;
		line-height: 1.2;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.inspector-row-value {
		max-width: 7.5rem;
		overflow: hidden;
		color: var(--muted-foreground);
		font-size: var(--text-xs);
		line-height: 1.2;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.inspector-row-value.is-muted {
		color: color-mix(in oklab, var(--muted-foreground) 68%, transparent);
	}

	:global(.inspector-row-chevron) {
		width: 0.875rem;
		height: 0.875rem;
		color: color-mix(in oklab, var(--muted-foreground) 68%, transparent);
	}

	:global(.inspector-select) {
		height: 1.65rem;
		min-width: 0;
		border-color: transparent;
		background: color-mix(in oklab, var(--muted) 28%, transparent);
		padding-left: 0.45rem;
		font-size: var(--text-xs);
		box-shadow: none;
	}

	:global(.inspector-number) {
		height: 1.65rem;
		width: 5.5rem;
		justify-self: end;
		border-color: transparent;
		background: color-mix(in oklab, var(--muted) 28%, transparent);
		font-size: var(--text-xs);
		box-shadow: none;
	}

	.inspector-note {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		border-radius: var(--radius-sm);
		padding: 0.35rem 0.375rem;
		color: var(--muted-foreground);
		font-size: var(--text-xs);
	}

	.custom-editor {
		height: 16rem;
		overflow: hidden;
		border: 1px solid color-mix(in oklab, var(--border) 72%, transparent);
		border-radius: var(--radius-sm);
	}

	.inspector-help {
		color: var(--muted-foreground);
		font-size: var(--text-2xs);
		line-height: 1.35;
	}

	.picker-search {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		border-bottom: 1px solid color-mix(in oklab, var(--border) 70%, transparent);
		padding: 0.45rem 0.55rem;
	}

	:global(.picker-search-input) {
		height: 1.6rem;
		border: 0;
		background: transparent;
		padding: 0;
		font-size: var(--text-xs);
		box-shadow: none;
	}

	:global(.picker-search-input:focus-visible) {
		box-shadow: none;
	}

	:global(.picker-list) {
		max-height: 14rem;
		overflow-y: auto;
		padding: 0.25rem;
	}

	:global(.picker-item) {
		display: grid;
		min-width: 0;
		grid-template-columns: 1rem minmax(0, 1fr);
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
		font-size: var(--text-xs);
	}

	:global(.picker-item.is-check) {
		grid-template-columns: 1rem minmax(0, 1fr);
	}

	.picker-item-check {
		display: inline-flex;
		width: 1rem;
		align-items: center;
		justify-content: center;
		color: var(--primary);
	}

	.picker-item-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
