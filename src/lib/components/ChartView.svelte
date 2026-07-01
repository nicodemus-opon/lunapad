<script lang="ts">
	import PlotlyMount from './PlotlyMount.svelte';
	import type { ChartConfig, ChartType } from '$lib/types/gui-pipeline';
	import { coerceNumber } from '$lib/utils';
	import { resolveCSSColor, resolveChartColorway } from '$lib/utils/theme-colors';
	import { watchTheme } from '$lib/services/plotly-render.svelte';
	import { evaluateCustomChartCode, type PlotCellFigure } from '$lib/services/plot-cell';
	import type { Data, Layout } from 'plotly.js-dist-min';

	interface Props {
		rows: Record<string, unknown>[];
		columns: string[];
		config: ChartConfig;
		height?: number; // px; defaults to 384 (h-96)
		onPlotClick?: (event: {
			points?: Array<{ x?: unknown; y?: unknown; label?: unknown; customdata?: unknown }>;
		}) => void;
	}

	const { rows, columns, config, height = 384, onPlotClick }: Props = $props();

	type Figure = PlotCellFigure;

	function humanize(col: string): string {
		return col.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}

	// ── Data prep ─────────────────────────────────────────────────────────────
	const chartData = $derived.by(() => {
		if (!config.xColumn) return [];
		return rows
			.filter((r) => r[config.xColumn] !== null && r[config.xColumn] !== undefined)
			.map((r) => {
				const point: Record<string, unknown> = { x: r[config.xColumn] };
				for (const y of config.yColumns) {
					point[y] = coerceNumber(r[y]);
				}
				for (const y of config.yColumnsSecondary ?? []) {
					point[y] = coerceNumber(r[y]);
				}
				if (config.colorColumn) point._color = r[config.colorColumn];
				if (config.sizeColumn) point._size = coerceNumber(r[config.sizeColumn]);
				return point;
			});
	});

	const xValues = $derived(chartData.map((point) => point.x));

	function isNumberish(value: unknown): boolean {
		if (typeof value === 'number') return Number.isFinite(value);
		if (typeof value !== 'string') return false;
		const normalized = value.replaceAll(',', '').trim();
		if (!normalized) return false;
		return Number.isFinite(Number(normalized));
	}

	function toNumber(value: unknown): number | null {
		if (typeof value === 'number') return Number.isFinite(value) ? value : null;
		if (typeof value !== 'string') return null;
		const parsed = Number(value.replaceAll(',', '').trim());
		return Number.isFinite(parsed) ? parsed : null;
	}

	function isDateLike(value: unknown): boolean {
		if (value instanceof Date) return !Number.isNaN(value.getTime());
		if (typeof value !== 'string' && typeof value !== 'number') return false;
		const date = new Date(value);
		return !Number.isNaN(date.getTime());
	}

	const numericFormatter = new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1
	});

	function fmtNum(value: unknown): string {
		const n = toNumber(value);
		return n !== null ? numericFormatter.format(n) : String(value ?? '');
	}

	function truncateLabel(value: unknown, maxLen = 14): string {
		const s = String(value ?? '');
		return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
	}

	function truncateTick(value: unknown): string {
		return truncateLabel(value);
	}

	const xIsMostlyNumeric = $derived.by(() => {
		if (xValues.length === 0) return false;
		const sample = xValues.slice(0, 20);
		const numericCount = sample.filter((value) => isNumberish(value)).length;
		return numericCount / sample.length >= 0.8;
	});

	const xIsMostlyDateLike = $derived.by(() => {
		if (xValues.length === 0) return false;
		const sample = xValues.slice(0, 20);
		const dateCount = sample.filter((value) => isDateLike(value)).length;
		return dateCount / sample.length >= 0.8;
	});

	const maxXLabelLength = $derived.by(() => {
		let maxLength = 0;
		for (const value of xValues) {
			const label = String(value ?? '');
			if (label.length > maxLength) maxLength = label.length;
		}
		return maxLength;
	});

	const shouldRotateXLabels = $derived.by(() => {
		if (xIsMostlyNumeric) return false;
		return xValues.length > 8 || maxXLabelLength > 12;
	});

	// Coerces a raw x value to the right JS type for Plotly's axis-type
	// inference (Plotly infers date/numeric axes from the data's actual JS
	// value type — Date objects for date axes, numbers for linear axes).
	function xValue(raw: unknown): unknown {
		if (xIsMostlyDateLike) return new Date(raw as string | number | Date);
		if (xIsMostlyNumeric) return toNumber(raw);
		return String(raw ?? '');
	}

	// Categorical-axis options: explicit category order (`categoryorder` +
	// `categoryarray`) plus truncated display labels (`tickvals`/`ticktext` —
	// full text still available via each trace's hovertemplate), rotated when
	// there are many categories or the labels are long so they don't overlap.
	function categoricalAxisOpts(domain: string[], rotate: boolean): Record<string, unknown> {
		return {
			type: 'category',
			categoryorder: 'array',
			categoryarray: domain,
			tickmode: 'array',
			tickvals: domain,
			ticktext: domain.map(truncateTick),
			...(rotate ? { tickangle: -40 } : {})
		};
	}

	const hasSecondaryAxis = $derived(
		(config.yColumnsSecondary?.length ?? 0) > 0 &&
			(config.chartType === 'line' || config.chartType === 'area')
	);

	const seriesList = $derived(
		config.yColumns.map((col, i) => ({
			key: col,
			label: humanize(col),
			color: `var(--chart-${(i % 5) + 1})`
		}))
	);

	const secondarySeriesList = $derived(
		(config.yColumnsSecondary ?? []).map((col, i) => ({
			key: col,
			label: `${humanize(col)} (2nd)`,
			color: `var(--chart-${((i + 3) % 5) + 1})`
		}))
	);

	const enableColorSplitBars = $derived.by(
		() =>
			(config.chartType === 'bar' || config.chartType === 'bar-horizontal') &&
			Boolean(config.colorColumn) &&
			config.yColumns.length === 1
	);

	// ── Grouped color-split lines (line/area + colorColumn + single Y) ─────────
	const enableColorSplitLines = $derived.by(
		() =>
			(config.chartType === 'line' || config.chartType === 'area') &&
			Boolean(config.colorColumn) &&
			config.yColumns.length === 1
	);

	// ── Grouped color-split scatter (scatter/bubble + colorColumn) ─────────────
	const enableColorSplitScatter = $derived.by(
		() =>
			(config.chartType === 'scatter' || config.chartType === 'bubble') &&
			Boolean(config.colorColumn) &&
			config.yColumns.length >= 1
	);

	const colorSplitSpec = $derived.by(() => {
		if (!enableColorSplitBars || !config.colorColumn) {
			return { labels: [] as string[], hasOther: false, keyByLabel: {} as Record<string, string> };
		}
		const counts = new Map<string, number>();
		for (const row of rows) {
			const raw = row[config.colorColumn];
			if (raw === null || raw === undefined) continue;
			const label = String(raw);
			counts.set(label, (counts.get(label) ?? 0) + 1);
		}
		const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
		const maxSeries = 12;
		const labels = ranked.slice(0, maxSeries);
		const hasOther = ranked.length > maxSeries;
		const keyByLabel: Record<string, string> = {};
		for (const label of labels) keyByLabel[label] = label;
		if (hasOther) keyByLabel.__other__ = 'Other';
		return { labels, hasOther, keyByLabel };
	});

	const colorSplitSeriesList = $derived.by(() => {
		if (!enableColorSplitBars) return [] as Array<{ key: string; label: string }>;
		const list = colorSplitSpec.labels.map((label) => colorSplitSpec.keyByLabel[label]);
		if (colorSplitSpec.hasOther) list.push(colorSplitSpec.keyByLabel.__other__);
		return list.map((seriesKey) => ({ key: seriesKey, label: humanize(seriesKey) }));
	});

	const colorSplitBarData = $derived.by(() => {
		if (
			!enableColorSplitBars ||
			!config.colorColumn ||
			!config.xColumn ||
			config.yColumns.length === 0
		)
			return [];
		const metric = config.yColumns[0];
		const grouped = new Map<string, Record<string, unknown>>();
		const allow = new Set(colorSplitSpec.labels);

		for (const row of rows) {
			const xRaw: unknown = row[config.xColumn];
			const cRaw: unknown = row[config.colorColumn!];
			if (xRaw === null || xRaw === undefined || cRaw === null || cRaw === undefined) continue;
			const x: string = String(xRaw);
			const label: string = String(cRaw);
			const seriesKey = allow.has(label)
				? colorSplitSpec.keyByLabel[label]
				: colorSplitSpec.hasOther
					? colorSplitSpec.keyByLabel.__other__
					: null;
			if (!seriesKey) continue;
			const y = coerceNumber(row[metric]) ?? 0;
			if (!grouped.has(x)) grouped.set(x, { x });
			const acc = grouped.get(x)!;
			const prev = coerceNumber(acc[seriesKey]) ?? 0;
			acc[seriesKey] = prev + y;
		}

		return [...grouped.values()];
	});

	// Top-N group keys for line/scatter splitting (same pattern as bars)
	function topGroupKeys(colName: string | null | undefined, maxGroups = 12): string[] {
		if (!colName) return [];
		const counts = new Map<string, number>();
		for (const row of rows) {
			const raw = row[colName];
			if (raw == null) continue;
			counts.set(String(raw), (counts.get(String(raw)) ?? 0) + 1);
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, maxGroups)
			.map(([k]) => k);
	}

	const colorSplitLineGroups = $derived(
		enableColorSplitLines ? topGroupKeys(config.colorColumn) : ([] as string[])
	);
	const colorSplitScatterGroups = $derived(
		enableColorSplitScatter ? topGroupKeys(config.colorColumn) : ([] as string[])
	);

	const barSeriesLayout = $derived.by(() => {
		if (config.seriesMode === 'stacked') return 'stack';
		if (config.seriesMode === 'grouped') return 'group';
		return config.yColumns.length > 1 ? 'group' : 'overlap';
	});

	const areaSeriesLayout = $derived.by(() => {
		if (config.seriesMode === 'stacked') return 'stack';
		return 'overlap';
	});

	function applySortOrder<T extends { x: unknown }>(data: T[], yKey: string): T[] {
		if (!config.sortOrder || config.sortOrder === 'none') return data;
		return [...data].sort((a, b) => {
			const av = toNumber((a as Record<string, unknown>)[yKey]) ?? 0;
			const bv = toNumber((b as Record<string, unknown>)[yKey]) ?? 0;
			return config.sortOrder === 'asc' ? av - bv : bv - av;
		});
	}

	const sortedBarData = $derived.by(() => {
		const base =
			enableColorSplitBars && colorSplitSeriesList.length > 0 ? colorSplitBarData : chartData;
		if (!config.sortOrder || config.sortOrder === 'none') return base;
		const yKey = config.yColumns[0] ?? 'y';
		return applySortOrder(base as { x: unknown }[], yKey);
	});

	const barSeriesToRender = $derived(
		enableColorSplitBars && colorSplitSeriesList.length > 0 ? colorSplitSeriesList : seriesList
	);

	const hasSeries = $derived.by(() => {
		if (enableColorSplitBars && colorSplitSeriesList.length > 1) return true;
		if (enableColorSplitLines && colorSplitLineGroups.length > 1) return true;
		if (enableColorSplitScatter && colorSplitScatterGroups.length > 1) return true;
		return config.yColumns.length + (config.yColumnsSecondary?.length ?? 0) > 1;
	});

	// ── Pie data ───────────────────────────────────────────────────────────────
	const MAX_PIE_SLICES = 8;
	const pieData = $derived.by(() => {
		if (!config.xColumn || config.yColumns.length === 0) return [];
		const yCol = config.yColumns[0];
		const totals: Record<string, number> = {};
		for (const r of rows) {
			if (r[config.xColumn] === null || r[config.xColumn] === undefined) continue;
			const key = String(r[config.xColumn]);
			const val = coerceNumber(r[yCol]) ?? 0;
			totals[key] = (totals[key] ?? 0) + val;
		}
		const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
		const top = sorted.slice(0, MAX_PIE_SLICES);
		const rest = sorted.slice(MAX_PIE_SLICES);
		const result = top.map(([x, y]) => ({ x, y }));
		if (rest.length > 0) {
			const otherSum = rest.reduce((s, [, v]) => s + v, 0);
			result.push({ x: 'Other', y: otherSum });
		}
		if (config.sortOrder === 'asc') result.sort((a, b) => a.y - b.y);
		else if (config.sortOrder === 'desc') result.sort((a, b) => b.y - a.y);
		return result;
	});

	// ── Histogram bins ─────────────────────────────────────────────────────────
	interface BinDatum {
		x0: number;
		x1: number;
		y: number;
	}
	const histData = $derived.by((): BinDatum[] => {
		if (config.yColumns.length === 0) return [];
		const col = config.yColumns[0];
		const vals = rows.map((r) => coerceNumber(r[col])).filter((v): v is number => v !== null);
		if (vals.length === 0) return [];
		const min = Math.min(...vals);
		const max = Math.max(...vals);
		if (min === max) return [{ x0: min, x1: max, y: vals.length }];
		const bins = config.histogramBins ?? 20;
		const step = (max - min) / bins;
		const counts = Array.from({ length: bins }, () => 0);
		for (const v of vals) {
			const idx = Math.min(bins - 1, Math.floor((v - min) / step));
			counts[idx]++;
		}
		return counts.map((count, i) => ({
			x0: min + i * step,
			x1: min + (i + 1) * step,
			y: count
		}));
	});

	// ── Heatmap data ───────────────────────────────────────────────────────────
	const heatmapData = $derived.by(() => {
		if (!config.xColumn || !config.colorColumn || config.yColumns.length === 0) {
			return { cells: [], xLabels: [], yLabels: [], minVal: 0, maxVal: 1 };
		}
		const yCol = config.yColumns[0];
		const xSet = new Set<string>();
		const ySet = new Set<string>();
		const values = new Map<string, number>();
		for (const r of rows) {
			const xv = r[config.xColumn];
			const yv = r[config.colorColumn];
			if (xv == null || yv == null) continue;
			const xk = String(xv);
			const yk = String(yv);
			xSet.add(xk);
			ySet.add(yk);
			const val = coerceNumber(r[yCol]) ?? 0;
			values.set(`${xk}__${yk}`, val);
		}
		const xLabels = [...xSet];
		const yLabels = [...ySet];
		const allVals = [...values.values()];
		const minVal = allVals.length ? Math.min(...allVals) : 0;
		const maxVal = allVals.length ? Math.max(...allVals) : 1;
		const cells = xLabels.flatMap((xk) =>
			yLabels.map((yk) => ({ x: xk, y: yk, value: values.get(`${xk}__${yk}`) ?? null }))
		);
		return { cells, xLabels, yLabels, minVal, maxVal };
	});

	// ── Calendar heatmap data ──────────────────────────────────────────────────
	const calendarData = $derived.by(() => {
		if (!config.xColumn || config.yColumns.length === 0) {
			return { pairs: [] as [string, number][], years: [] as string[], minVal: 0, maxVal: 1 };
		}
		const yCol = config.yColumns[0];
		const map = new Map<string, number>();
		for (const r of rows) {
			const dv = r[config.xColumn];
			if (dv == null) continue;
			const d = new Date(dv as string | number);
			if (Number.isNaN(d.getTime())) continue;
			const key = d.toISOString().slice(0, 10);
			map.set(key, (map.get(key) ?? 0) + (coerceNumber(r[yCol]) ?? 0));
		}
		const pairs = [...map.entries()] as [string, number][];
		const allVals = pairs.map((p) => p[1]);
		const minVal = allVals.length ? Math.min(...allVals) : 0;
		const maxVal = allVals.length ? Math.max(...allVals) : 1;
		const years = [...new Set(pairs.map((p) => p[0].slice(0, 4)))].sort();
		return { pairs, years, minVal, maxVal };
	});

	// ── Funnel data ────────────────────────────────────────────────────────────
	const funnelData = $derived.by(() => {
		if (!config.xColumn || config.yColumns.length === 0) return [];
		const yCol = config.yColumns[0];
		const totals: Record<string, number> = {};
		for (const r of rows) {
			if (r[config.xColumn] == null) continue;
			const key = String(r[config.xColumn]);
			totals[key] = (totals[key] ?? 0) + (coerceNumber(r[yCol]) ?? 0);
		}
		const items = Object.entries(totals).map(([x, y]) => ({ x, y }));
		items.sort((a, b) => b.y - a.y);
		return items;
	});

	// ── Box-plot data ──────────────────────────────────────────────────────────
	const boxPlotData = $derived.by(() => {
		if (!config.xColumn || config.yColumns.length < 5) return [];
		const [minCol, q1Col, medCol, q3Col, maxCol] = config.yColumns;
		return rows
			.filter((r) => r[config.xColumn] != null)
			.map((r) => ({
				name: String(r[config.xColumn]),
				min: coerceNumber(r[minCol]) ?? 0,
				q1: coerceNumber(r[q1Col]) ?? 0,
				median: coerceNumber(r[medCol]) ?? 0,
				q3: coerceNumber(r[q3Col]) ?? 0,
				max: coerceNumber(r[maxCol]) ?? 0
			}));
	});

	// ── BigValue / Value / Delta data ─────────────────────────────────────────
	const numFmtFull = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
	const bigValueData = $derived.by(() => {
		if (!config.xColumn) return null;
		const row = rows[config.valueRow ?? 0] ?? rows[0];
		if (!row) return null;
		const val = coerceNumber(row[config.xColumn]) ?? row[config.xColumn];
		const compCol = config.yColumns[0];
		const comp = compCol ? (coerceNumber(row[compCol]) ?? null) : null;
		const sparkCol = config.colorColumn;
		const sparkPoints = sparkCol
			? rows
					.map((r) => ({
						date: r[sparkCol],
						val: coerceNumber(r[config.xColumn]) ?? 0
					}))
					.filter((p) => p.date != null)
			: [];
		return { val, comp, compCol, sparkPoints };
	});

	const deltaData = $derived.by(() => {
		if (!config.xColumn) return null;
		const row = rows[config.valueRow ?? 0] ?? rows[0];
		if (!row) return null;
		return coerceNumber(row[config.xColumn]) ?? null;
	});

	// ── Sankey data ────────────────────────────────────────────────────────────
	const sankeyData = $derived.by(() => {
		if (!config.xColumn || !config.colorColumn || config.yColumns.length === 0) return [];
		const yCol = config.yColumns[0];
		return rows
			.filter((r) => r[config.xColumn] != null && r[config.colorColumn!] != null)
			.map((r) => ({
				source: String(r[config.xColumn]),
				target: String(r[config.colorColumn!]),
				value: coerceNumber(r[yCol]) ?? 0
			}));
	});

	const sankeyNodes = $derived.by(() => {
		const names = new Set([...sankeyData.map((d) => d.source), ...sankeyData.map((d) => d.target)]);
		return [...names].map((name) => ({ name }));
	});

	// ── "needs config" guard ───────────────────────────────────────────────────
	const needsConfig = $derived.by(() => {
		const t = config.chartType;
		if (t === 'table' || t === 'big-value' || t === 'value' || t === 'delta' || t === 'custom')
			return false;
		if (t === 'histogram') return config.yColumns.length === 0;
		if (t === 'heatmap')
			return !config.xColumn || !config.colorColumn || config.yColumns.length === 0;
		if (t === 'box-plot') return config.yColumns.length < 5;
		if (t === 'sankey')
			return !config.xColumn || !config.colorColumn || config.yColumns.length === 0;
		return !config.xColumn || config.yColumns.length === 0;
	});

	const CHART_COLOR_RANGE = [
		'var(--chart-1)',
		'var(--chart-2)',
		'var(--chart-3)',
		'var(--chart-4)',
		'var(--chart-5)'
	];

	// Resolved (concrete rgb(...)) chart colors — needed wherever a color has
	// to be alpha-blended (area fills) or interpolated (continuous heatmap
	// scales), since CSS `var(--chart-N)` references can't be combined with an
	// alpha channel client-side the way a concrete color can. Discrete
	// fill/stroke channels elsewhere use the literal `var(--chart-N)` strings
	// above instead — the browser resolves those at paint time same as any
	// other CSS, no JS-side resolution needed.
	const resolvedChartColors = $derived.by(() => {
		void watchTheme(); // re-resolve when the theme toggles
		return resolveChartColorway();
	});

	function areaFillColor(resolvedColor: string, alpha = 0.2): string {
		const m = resolvedColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
		return m ? `rgba(${m[1]},${m[2]},${m[3]},${alpha})` : resolvedColor;
	}

	const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

	function calendarCells(pairs: [string, number][]) {
		return pairs.map(([dateStr, value]) => {
			const date = new Date(dateStr);
			const year = date.getUTCFullYear();
			const jan1 = new Date(Date.UTC(year, 0, 1));
			const dayOfYear = Math.floor((date.getTime() - jan1.getTime()) / 86400000);
			const weekOfYear = Math.floor((dayOfYear + jan1.getUTCDay()) / 7);
			return { year: String(year), weekOfYear, day: date.getUTCDay(), value, dateStr };
		});
	}

	// Builds an explicit category order from a column of raw values — Plotly's
	// default category ordering is alphabetical, which scrambles natural data
	// order (e.g. month names); pass this as `categoryarray` wherever the
	// axis is categorical, to preserve row order instead.
	function categoricalDomain(values: unknown[]): string[] {
		const seen = new Set<string>();
		for (const v of values) {
			if (v == null) continue;
			seen.add(String(v));
		}
		return [...seen];
	}

	// ── Histogram ────────────────────────────────────────────────────────────
	const histogramFigure = $derived.by((): Figure | null => {
		if (config.chartType !== 'histogram') return null;
		const bins = histData;
		if (bins.length === 0) return null;
		const xLabel = config.yColumns[0] ? humanize(config.yColumns[0]) : '';
		const xs = bins.map((b) => (b.x0 + b.x1) / 2);
		const widths = bins.map((b) => b.x1 - b.x0);
		const customdata = bins.map((b) => `${fmtNum(b.x0)}–${fmtNum(b.x1)}: ${fmtNum(b.y)}`);
		return {
			data: [
				{
					type: 'bar',
					x: xs,
					y: bins.map((b) => b.y),
					width: widths,
					marker: { color: 'var(--chart-1)' },
					customdata,
					hovertemplate: '%{customdata}<extra></extra>'
				} as unknown as Data
			],
			layout: {
				bargap: 0,
				xaxis: { title: { text: xLabel }, tickformat: '~s' } as Partial<Layout['xaxis']>,
				yaxis: { title: { text: 'Count' }, tickformat: '~s' } as Partial<Layout['yaxis']>
			}
		};
	});

	// ── Heatmap ──────────────────────────────────────────────────────────────
	const heatmapFigure = $derived.by((): Figure | null => {
		if (config.chartType !== 'heatmap') return null;
		const { cells, xLabels, yLabels, minVal, maxVal } = heatmapData;
		if (cells.length === 0) return null;
		void watchTheme(); // re-resolve colors when the theme toggles
		const colorLow = resolveCSSColor('--background');
		const colorHigh = resolveCSSColor('--chart-1');
		const rotateHeatmapX = xLabels.length > 8 || xLabels.some((l) => l.length > 12);
		const customdata = cells.map(
			(c) => `${c.x} / ${c.y}: ${c.value != null ? fmtNum(c.value) : 'N/A'}`
		);
		return {
			data: [
				{
					type: 'heatmap',
					x: cells.map((c) => c.x),
					y: cells.map((c) => c.y),
					z: cells.map((c) => c.value),
					zmin: minVal,
					zmax: maxVal,
					colorscale: [
						[0, colorLow],
						[1, colorHigh]
					],
					customdata,
					hovertemplate: '%{customdata}<extra></extra>'
				} as unknown as Data
			],
			layout: {
				margin: { l: 90, b: rotateHeatmapX ? 78 : 60 },
				xaxis: categoricalAxisOpts(xLabels, rotateHeatmapX) as Partial<Layout['xaxis']>,
				yaxis: categoricalAxisOpts(yLabels, false) as Partial<Layout['yaxis']>
			}
		};
	});

	// ── Scatter / Bubble ─────────────────────────────────────────────────────
	const scatterFigure = $derived.by((): Figure | null => {
		const t = config.chartType;
		if (t !== 'scatter' && t !== 'bubble') return null;
		const isBubble = t === 'bubble';
		const yCol = config.yColumns[0];
		if (!yCol) return null;
		const colorSplit = enableColorSplitScatter && colorSplitScatterGroups.length > 0;
		const groups = colorSplit ? colorSplitScatterGroups : [''];
		const colorCol = config.colorColumn;

		interface Pt {
			x: unknown;
			y: number | null;
			group: string;
			size: number | null;
		}

		const allData: Pt[] = colorSplit
			? rows
					.filter(
						(r) =>
							colorCol != null &&
							r[colorCol] != null &&
							colorSplitScatterGroups.includes(String(r[colorCol])) &&
							r[config.xColumn] != null &&
							r[yCol] != null
					)
					.map((r) => ({
						x: xValue(r[config.xColumn]),
						y: coerceNumber(r[yCol]),
						group: String(r[colorCol as string]),
						size: isBubble && config.sizeColumn ? coerceNumber(r[config.sizeColumn]) : null
					}))
			: chartData
					.filter((d) => d[yCol] != null)
					.map((d) => ({
						x: xValue(d.x),
						y: d[yCol] as number | null,
						group: '',
						size: (d._size as number | null) ?? null
					}));

		if (allData.length === 0) return null;

		const xCategorical = !xIsMostlyDateLike && !xIsMostlyNumeric;
		const xDomain = xCategorical ? categoricalDomain(allData.map((d) => d.x)) : undefined;

		const allSizes = isBubble ? allData.map((d) => d.size ?? 0) : [];
		const maxSize = allSizes.length ? Math.max(...allSizes, 1) : 1;
		// Approximates Plot's `r: {range:[4,30]}` marker-radius scale — Plotly
		// has no direct equivalent, so `sizeref` is derived from the documented
		// area-mode formula (sizeref = 2*max(size)/desiredMaxDiameterPx**2) to
		// land in roughly the same visual diameter range.
		const MAX_MARKER_PX = 60;
		const sizeref = isBubble ? (2 * maxSize) / MAX_MARKER_PX ** 2 : undefined;

		const traces: Data[] = groups.map((g, i) => {
			const groupData = colorSplit ? allData.filter((d) => d.group === g) : allData;
			const label = colorSplit ? humanize(g) : '';
			return {
				type: 'scatter',
				mode: 'markers',
				name: colorSplit ? label : undefined,
				x: groupData.map((d) => d.x),
				y: groupData.map((d) => d.y),
				marker: {
					color: colorSplit ? CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length] : 'var(--chart-1)',
					size: isBubble ? groupData.map((d) => d.size ?? 0) : undefined,
					sizemode: isBubble ? 'area' : undefined,
					sizeref
				},
				customdata: groupData.map(
					(d) => `${colorSplit ? label + ': ' : ''}${fmtNum(d.x)}, ${fmtNum(d.y)}`
				),
				hovertemplate: '%{customdata}<extra></extra>'
			} as unknown as Data;
		});

		return {
			data: traces,
			layout: {
				showlegend: colorSplit,
				margin: { b: xCategorical && shouldRotateXLabels ? 78 : 36 },
				xaxis: (xDomain ? categoricalAxisOpts(xDomain, shouldRotateXLabels) : {}) as Partial<
					Layout['xaxis']
				>,
				yaxis: { title: { text: humanize(yCol) }, tickformat: '~s' } as Partial<Layout['yaxis']>
			}
		};
	});

	// ── Bar / Bar-horizontal ─────────────────────────────────────────────────
	const barFigure = $derived.by((): Figure | null => {
		const t = config.chartType;
		if (t !== 'bar' && t !== 'bar-horizontal') return null;
		const isHoriz = t === 'bar-horizontal';
		const data = sortedBarData;
		const seriesDef = barSeriesToRender;
		if (data.length === 0 || seriesDef.length === 0) return null;
		const layout = barSeriesLayout;
		const valueLabel = seriesDef.length === 1 ? seriesDef[0].label : '';
		const catDomain = categoricalDomain(data.map((d) => (d as Record<string, unknown>).x));

		const traces: Data[] = seriesDef.map((s, i) => {
			const xs = data.map((d) => String((d as Record<string, unknown>).x ?? ''));
			const values = data.map((d) => toNumber((d as Record<string, unknown>)[s.key]));
			const customdata = xs.map((x, idx) => `${s.label} — ${x}: ${fmtNum(values[idx])}`);
			return {
				type: 'bar',
				name: s.label,
				orientation: isHoriz ? 'h' : 'v',
				...(isHoriz ? { y: xs, x: values } : { x: xs, y: values }),
				marker: {
					color:
						seriesDef.length === 1
							? 'var(--chart-1)'
							: CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length]
				},
				customdata,
				hovertemplate: '%{customdata}<extra></extra>'
			} as unknown as Data;
		});

		const valueAxis = { title: { text: valueLabel }, tickformat: '~s' };
		const catAxis = categoricalAxisOpts(catDomain, !isHoriz && shouldRotateXLabels);

		return {
			data: traces,
			layout: {
				barmode: layout === 'stack' ? 'stack' : seriesDef.length > 1 ? 'group' : undefined,
				showlegend: seriesDef.length > 1,
				margin: { l: isHoriz ? 90 : 48, b: isHoriz ? 32 : shouldRotateXLabels ? 78 : 56 },
				...(isHoriz
					? {
							xaxis: valueAxis as Partial<Layout['xaxis']>,
							yaxis: catAxis as Partial<Layout['yaxis']>
						}
					: {
							xaxis: catAxis as Partial<Layout['xaxis']>,
							yaxis: valueAxis as Partial<Layout['yaxis']>
						})
			}
		};
	});

	// ── Line / Area ──────────────────────────────────────────────────────────
	const lineFigure = $derived.by((): Figure | null => {
		const t = config.chartType;
		if (t !== 'line' && t !== 'area') return null;
		const isArea = t === 'area';

		// ── Grouped by colorColumn ─────────────────────────────────────────
		if (enableColorSplitLines && colorSplitLineGroups.length > 0) {
			const groups = colorSplitLineGroups;
			const colorCol = config.colorColumn as string;
			const yCol = config.yColumns[0];
			const stacked = isArea && areaSeriesLayout === 'stack';

			const traces: Data[] = groups.map((g, i) => {
				const groupRows = rows.filter(
					(r) =>
						r[colorCol] != null &&
						String(r[colorCol]) === g &&
						r[config.xColumn] != null &&
						r[yCol] != null
				);
				const xs = groupRows.map((r) => xValue(r[config.xColumn]));
				const ys = groupRows.map((r) => coerceNumber(r[yCol]));
				const resolvedColor = resolvedChartColors[i % resolvedChartColors.length];
				return {
					type: 'scatter',
					mode: 'lines',
					name: humanize(g),
					x: xs,
					y: ys,
					line: { color: CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length] },
					...(isArea
						? {
								fill: stacked ? 'tonexty' : 'tozeroy',
								fillcolor: areaFillColor(resolvedColor),
								stackgroup: stacked ? 'primary' : undefined
							}
						: {}),
					customdata: ys.map((y) => `${humanize(g)}: ${fmtNum(y)}`),
					hovertemplate: '%{customdata}<extra></extra>'
				} as unknown as Data;
			});

			const xCategorical = !xIsMostlyDateLike && !xIsMostlyNumeric;
			const xDomain = xCategorical
				? categoricalDomain(traces.flatMap((tr) => (tr as { x: unknown[] }).x))
				: undefined;

			return {
				data: traces,
				layout: {
					showlegend: true,
					hovermode: 'x unified',
					margin: { b: xCategorical && shouldRotateXLabels ? 78 : 36 },
					xaxis: (xDomain ? categoricalAxisOpts(xDomain, shouldRotateXLabels) : {}) as Partial<
						Layout['xaxis']
					>,
					yaxis: { tickformat: '~s' } as Partial<Layout['yaxis']>
				}
			};
		}

		// ── Standard multi-series (+ secondary axis rescaled onto shared scale) ─
		const primary = seriesList;
		const secondary = secondarySeriesList;
		if (primary.length === 0) return null;
		const primaryData = chartData.map((d) => ({ ...d, x: xValue(d.x) }));

		const rescaleMap: Record<string, (v: number) => number> = {};
		if (secondary.length > 0) {
			const primVals = primary.flatMap((s) =>
				primaryData
					.map((d) => toNumber((d as Record<string, unknown>)[s.key]))
					.filter((v): v is number => v != null)
			);
			const primaryMin = primVals.length ? Math.min(...primVals) : 0;
			const primaryMax = primVals.length ? Math.max(...primVals) : 1;
			for (const s of secondary) {
				const vals = primaryData
					.map((d) => toNumber((d as Record<string, unknown>)[s.key]))
					.filter((v): v is number => v != null);
				const secMin = vals.length ? Math.min(...vals) : 0;
				const secMax = vals.length ? Math.max(...vals) : 1;
				const range = secMax - secMin || 1;
				const span = primaryMax - primaryMin || 1;
				rescaleMap[s.key] = (v: number) => primaryMin + ((v - secMin) / range) * span;
			}
		}

		const isStackedArea = isArea && areaSeriesLayout === 'stack';
		const traces: Data[] = [];
		primary.forEach((s, i) => {
			const ys = primaryData.map((d) => toNumber((d as Record<string, unknown>)[s.key]));
			const resolvedColor = resolvedChartColors[i % resolvedChartColors.length];
			traces.push({
				type: 'scatter',
				mode: 'lines',
				name: s.label,
				x: primaryData.map((d) => d.x),
				y: ys,
				line: { color: s.color },
				...(isArea
					? {
							fill: isStackedArea ? 'tonexty' : 'tozeroy',
							fillcolor: areaFillColor(resolvedColor),
							stackgroup: isStackedArea ? 'primary' : undefined
						}
					: {}),
				customdata: ys.map((y) => `${s.label}: ${fmtNum(y)}`),
				hovertemplate: '%{customdata}<extra></extra>'
			} as unknown as Data);
		});
		for (const s of secondary) {
			const rescale = rescaleMap[s.key];
			const origVals = primaryData.map((d) => toNumber((d as Record<string, unknown>)[s.key]));
			const scaledVals = origVals.map((v) => (v != null ? rescale(v) : null));
			traces.push({
				type: 'scatter',
				mode: 'lines',
				name: s.label,
				x: primaryData.map((d) => d.x),
				y: scaledVals,
				line: { color: s.color, dash: 'dash' },
				customdata: origVals.map((v) => `${s.label}: ${v != null ? fmtNum(v) : '—'}`),
				hovertemplate: '%{customdata}<extra></extra>'
			} as unknown as Data);
		}

		const xCategorical = !xIsMostlyDateLike && !xIsMostlyNumeric;
		const xDomain = xCategorical ? categoricalDomain(primaryData.map((d) => d.x)) : undefined;

		return {
			data: traces,
			layout: {
				showlegend: hasSeries,
				hovermode: primary.length > 1 ? 'x unified' : 'closest',
				margin: { b: xCategorical && shouldRotateXLabels ? 78 : 36 },
				xaxis: (xDomain ? categoricalAxisOpts(xDomain, shouldRotateXLabels) : {}) as Partial<
					Layout['xaxis']
				>,
				yaxis: { tickformat: '~s' } as Partial<Layout['yaxis']>
			}
		};
	});

	// ── Box-plot (Plotly's quartile-override fields, since this data is
	// pre-aggregated min/q1/median/q3/max — not raw samples) ──────────────────
	const boxPlotFigure = $derived.by((): Figure | null => {
		if (config.chartType !== 'box-plot') return null;
		const data = boxPlotData;
		if (data.length === 0) return null;
		const xDomain = categoricalDomain(data.map((d) => d.name));
		const customdata = data.map(
			(d) =>
				`${d.name}<br>Max: ${fmtNum(d.max)}<br>Q3: ${fmtNum(d.q3)}<br>Median: ${fmtNum(d.median)}<br>Q1: ${fmtNum(d.q1)}<br>Min: ${fmtNum(d.min)}`
		);
		return {
			data: [
				{
					type: 'box',
					x: data.map((d) => d.name),
					q1: data.map((d) => d.q1),
					median: data.map((d) => d.median),
					q3: data.map((d) => d.q3),
					lowerfence: data.map((d) => d.min),
					upperfence: data.map((d) => d.max),
					boxpoints: false,
					marker: { color: 'var(--chart-1)' },
					customdata,
					hovertemplate: '%{customdata}<extra></extra>'
				} as unknown as Data
			],
			layout: {
				margin: { b: shouldRotateXLabels ? 78 : data.length > 6 ? 56 : 36 },
				xaxis: categoricalAxisOpts(xDomain, shouldRotateXLabels) as Partial<Layout['xaxis']>,
				yaxis: { tickformat: '~s' } as Partial<Layout['yaxis']>
			}
		};
	});

	// ── Calendar heatmap (no native Plotly faceting — one heatmap trace per
	// year on its own xaxis{N}/yaxis{N}, sliced into row domains via
	// layout.grid) ─────────────────────────────────────────────────────────────
	const calendarHeatmapFigure = $derived.by((): Figure | null => {
		if (config.chartType !== 'calendar-heatmap') return null;
		const { pairs, years, minVal, maxVal } = calendarData;
		if (years.length === 0) return null;
		const cells = calendarCells(pairs);
		void watchTheme(); // re-resolve colors when the theme toggles
		const colorLow = resolveCSSColor('--background');
		const colorHigh = resolveCSSColor('--chart-1');
		const border = resolveCSSColor('--border');
		const mutedForeground = resolveCSSColor('--muted-foreground');

		const traces: Data[] = years.map((year, i) => {
			const cellsForYear = cells.filter((c) => c.year === year);
			const axisSuffix = i === 0 ? '' : String(i + 1);
			return {
				type: 'heatmap',
				x: cellsForYear.map((c) => c.weekOfYear),
				y: cellsForYear.map((c) => c.day),
				z: cellsForYear.map((c) => c.value),
				xaxis: `x${axisSuffix}`,
				yaxis: `y${axisSuffix}`,
				zmin: minVal,
				zmax: maxVal,
				colorscale: [
					[0, colorLow],
					[1, colorHigh]
				],
				showscale: i === 0,
				customdata: cellsForYear.map((c) => `${c.dateStr}: ${fmtNum(c.value)}`),
				hovertemplate: '%{customdata}<extra></extra>'
			} as unknown as Data;
		});

		const rowHeight = 1 / years.length;
		const rowGap = years.length > 1 ? 0.08 : 0;
		const layout: Record<string, unknown> = {
			grid: { rows: years.length, columns: 1, pattern: 'independent' },
			margin: { l: 28 },
			showlegend: false
		};
		years.forEach((_year, i) => {
			const axisSuffix = i === 0 ? '' : String(i + 1);
			const top = 1 - i * rowHeight;
			const bottom = top - rowHeight + (i < years.length - 1 ? rowGap : 0);
			layout[`yaxis${axisSuffix}`] = {
				domain: [Math.max(0, bottom), Math.min(1, top)],
				tickmode: 'array',
				tickvals: [0, 1, 2, 3, 4, 5, 6],
				ticktext: DAY_LABELS,
				autorange: 'reversed',
				gridcolor: border,
				color: mutedForeground
			};
			layout[`xaxis${axisSuffix}`] = {
				domain: [0, 1],
				showticklabels: i === years.length - 1,
				gridcolor: border,
				color: mutedForeground
			};
		});

		return { data: traces, layout: layout as Partial<Layout> };
	});

	// ── Pie ──────────────────────────────────────────────────────────────────
	const pieFigure = $derived.by((): Figure | null => {
		if (config.chartType !== 'pie') return null;
		const data = pieData;
		if (data.length === 0) return null;
		return {
			data: [
				{
					type: 'pie',
					labels: data.map((d) => d.x),
					values: data.map((d) => d.y),
					hole: 0.55,
					marker: { colors: data.map((_, i) => CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length]) },
					textinfo: 'percent',
					textposition: 'inside',
					hovertemplate: '%{label}: %{value} (%{percent})<extra></extra>'
				} as unknown as Data
			],
			layout: { showlegend: true, legend: { orientation: 'h', y: -0.15 } } as Partial<Layout>
		};
	});

	// ── Funnel ───────────────────────────────────────────────────────────────
	const funnelFigure = $derived.by((): Figure | null => {
		if (config.chartType !== 'funnel') return null;
		const data = funnelData;
		if (data.length === 0) return null;
		return {
			data: [
				{
					type: 'funnel',
					y: data.map((d) => d.x),
					x: data.map((d) => d.y),
					marker: { color: data.map((_, i) => CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length]) },
					textinfo: 'label+value+percent initial',
					hovertemplate: '%{label}: %{value}<extra></extra>'
				} as unknown as Data
			],
			layout: {}
		};
	});

	// ── Sankey ───────────────────────────────────────────────────────────────
	const sankeyFigure = $derived.by((): Figure | null => {
		if (config.chartType !== 'sankey') return null;
		const nodes = sankeyNodes;
		const links = sankeyData;
		if (nodes.length === 0 || links.length === 0) return null;
		const indexByName = new Map(nodes.map((n, i) => [n.name, i]));
		return {
			data: [
				{
					type: 'sankey',
					node: {
						label: nodes.map((n) => n.name),
						color: nodes.map((_, i) => CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length]),
						pad: 10,
						thickness: 14
					},
					link: {
						source: links.map((l) => indexByName.get(l.source) ?? 0),
						target: links.map((l) => indexByName.get(l.target) ?? 0),
						value: links.map((l) => l.value),
						color: 'rgba(128,128,128,0.3)'
					}
				} as unknown as Data
			],
			layout: {}
		};
	});

	// ── Custom (user-written JS sandbox, same POJO contract as plot cells) ───
	const customResult = $derived.by((): { figure: Figure | null; error: string | null } => {
		if (config.chartType !== 'custom') return { figure: null, error: null };
		return evaluateCustomChartCode(config.code ?? '', rows, columns);
	});

	const figure = $derived.by((): Figure | null => {
		const t = config.chartType;
		if (t === 'histogram') return histogramFigure;
		if (t === 'heatmap') return heatmapFigure;
		if (t === 'scatter' || t === 'bubble') return scatterFigure;
		if (t === 'bar' || t === 'bar-horizontal') return barFigure;
		if (t === 'line' || t === 'area') return lineFigure;
		if (t === 'box-plot') return boxPlotFigure;
		if (t === 'calendar-heatmap') return calendarHeatmapFigure;
		if (t === 'pie') return pieFigure;
		if (t === 'funnel') return funnelFigure;
		if (t === 'sankey') return sankeyFigure;
		if (t === 'custom') return customResult.figure;
		return null;
	});

	let plotlyMountRef: { exportPng: (filename: string) => Promise<void> } | undefined = $state();

	const NON_CHART_TYPES: ChartType[] = ['table', 'big-value', 'value', 'delta'];

	export async function exportPng(filename: string): Promise<void> {
		if (NON_CHART_TYPES.includes(config.chartType)) {
			throw new Error('This chart type has no image export.');
		}
		await plotlyMountRef?.exportPng(filename);
	}
</script>

<div
	class="flex w-full flex-col rounded-md border bg-background px-8 py-8"
	style="height:{height}px"
>
	{#if config.title}
		<div class="mb-1 shrink-0 px-1">
			<p class="text-sm leading-tight font-medium text-foreground">{config.title}</p>
			{#if config.description}<p class="text-xs text-muted-foreground">{config.description}</p>{/if}
		</div>
	{/if}
	<div class="min-h-0 flex-1">
		{#if config.chartType === 'table'}
			{@const displayCols = columns.length > 0 ? columns : rows[0] ? Object.keys(rows[0]) : []}
			<div class="h-full w-full overflow-auto rounded-md border border-border/60 text-xs">
				<table class="w-full border-collapse">
					<thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
						<tr>
							{#each displayCols as col (col)}
								<th
									class="border-b border-border/60 px-2 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground first:pl-3 last:pr-3"
								>
									{col}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each rows.slice(0, 200) as row, i (i)}
							<tr class="border-b border-border/30 transition-colors hover:bg-muted/30">
								{#each displayCols as col (col)}
									<td
										class="max-w-48 truncate px-2 py-1 whitespace-nowrap text-foreground/90 first:pl-3 last:pr-3"
										title={String(row[col] ?? '')}
									>
										{row[col] ?? ''}
									</td>
								{/each}
							</tr>
						{/each}
						{#if rows.length > 200}
							<tr>
								<td
									colspan={displayCols.length}
									class="px-3 py-1.5 text-center text-muted-foreground italic"
								>
									Showing 200 of {rows.length} rows
								</td>
							</tr>
						{/if}
					</tbody>
				</table>
			</div>
		{:else if config.chartType === 'big-value'}
			{#if !config.xColumn}
				<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
					Configure a Value column (X).
				</div>
			{:else if bigValueData}
				{@const d = bigValueData}
				<div class="flex h-full flex-col items-start justify-center gap-1 px-4">
					{#if config.title}
						<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							{config.title}
						</p>
					{/if}
					<p class="text-5xl leading-none font-bold text-foreground tabular-nums">
						{typeof d.val === 'number' ? numericFormatter.format(d.val) : String(d.val ?? '—')}
					</p>
					{#if d.comp !== null && d.compCol}
						{@const positive = d.comp >= 0}
						<p
							class="text-sm font-medium {positive
								? 'text-green-500'
								: 'text-red-500'} flex items-center gap-0.5"
						>
							<span>{positive ? '▲' : '▼'}</span>
							<span>{numericFormatter.format(Math.abs(d.comp))}</span>
							<span class="ml-1 font-normal text-muted-foreground">{d.compCol}</span>
						</p>
					{/if}
					{#if d.sparkPoints.length > 1}
						{@const sparkVals = d.sparkPoints.map((p) => p.val)}
						{@const sparkMin = Math.min(...sparkVals)}
						{@const sparkMax = Math.max(...sparkVals)}
						{@const sparkRange = sparkMax - sparkMin || 1}
						{@const W = 120}
						{@const H = 32}
						<svg width={W} height={H} class="mt-1 opacity-60">
							<polyline
								fill="none"
								stroke="currentColor"
								stroke-width="1.5"
								points={d.sparkPoints
									.map(
										(p, i) =>
											`${(i / (d.sparkPoints.length - 1)) * W},${H - ((p.val - sparkMin) / sparkRange) * H}`
									)
									.join(' ')}
							/>
						</svg>
					{/if}
				</div>
			{:else}
				<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
					No data.
				</div>
			{/if}
		{:else if config.chartType === 'value'}
			{#if !config.xColumn}
				<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
					Configure a Value column (X).
				</div>
			{:else}
				{@const row = rows[config.valueRow ?? 0] ?? rows[0]}
				{@const val = row ? (coerceNumber(row[config.xColumn]) ?? row[config.xColumn]) : null}
				<div class="flex h-full items-center justify-center">
					<div class="flex flex-col items-center gap-1">
						{#if config.title}
							<p class="text-xs tracking-wide text-muted-foreground uppercase">{config.title}</p>
						{/if}
						<p class="text-3xl font-semibold text-foreground tabular-nums">
							{typeof val === 'number' ? numericFormatter.format(val) : String(val ?? '—')}
						</p>
					</div>
				</div>
			{/if}
		{:else if config.chartType === 'delta'}
			{#if !config.xColumn}
				<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
					Configure a Delta column (X).
				</div>
			{:else if deltaData !== null}
				{@const positive = config.deltaDownIsGood ? deltaData <= 0 : deltaData >= 0}
				{@const neutral = deltaData === 0}
				<div class="flex h-full items-center justify-center">
					<div class="flex flex-col items-center gap-1">
						{#if config.title}
							<p class="text-xs tracking-wide text-muted-foreground uppercase">{config.title}</p>
						{/if}
						<p
							class="flex items-center gap-2 text-4xl font-bold tabular-nums {neutral
								? 'text-muted-foreground'
								: positive
									? 'text-green-500'
									: 'text-red-500'}"
						>
							<span class="text-2xl">{neutral ? '—' : positive ? '▲' : '▼'}</span>
							<span>{numericFormatter.format(Math.abs(deltaData))}</span>
						</p>
					</div>
				</div>
			{:else}
				<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
					No data.
				</div>
			{/if}
		{:else if needsConfig}
			<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
				{#if config.chartType === 'box-plot'}
					Box plot requires 5 Y columns: Min, Q1, Median, Q3, Max.
				{:else}
					Configure columns to render this chart.
				{/if}
			</div>
		{:else if figure}
			<PlotlyMount bind:this={plotlyMountRef} {figure} {onPlotClick} />
		{:else if config.chartType === 'custom' && customResult.error}
			<div
				class="flex h-full items-center justify-center p-4 text-center text-sm whitespace-pre-wrap text-destructive"
			>
				{customResult.error}
			</div>
		{/if}
	</div>
</div>
