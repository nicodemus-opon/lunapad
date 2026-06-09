<script lang="ts">
	import EChart from './EChart.svelte';
	import type { ChartConfig } from '$lib/types/gui-pipeline';
	import { coerceNumber } from '$lib/utils';

	interface Props {
		rows: Record<string, unknown>[];
		columns: string[];
		config: ChartConfig;
		height?: number; // px; defaults to 384 (h-96)
	}

	const { rows, columns, config, height = 384 }: Props = $props();

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

	const enableColorSplitBars = $derived.by(() =>
		(config.chartType === 'bar' || config.chartType === 'bar-horizontal') &&
		Boolean(config.colorColumn) &&
		config.yColumns.length === 1
	);

	// ── Grouped color-split lines (line/area + colorColumn + single Y) ─────────
	const enableColorSplitLines = $derived.by(() =>
		(config.chartType === 'line' || config.chartType === 'area') &&
		Boolean(config.colorColumn) &&
		config.yColumns.length === 1
	);

	// ── Grouped color-split scatter (scatter/bubble + colorColumn) ─────────────
	const enableColorSplitScatter = $derived.by(() =>
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
		if (!enableColorSplitBars || !config.colorColumn || !config.xColumn || config.yColumns.length === 0) return [];
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
				: (colorSplitSpec.hasOther ? colorSplitSpec.keyByLabel.__other__ : null);
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
		return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxGroups).map(([k]) => k);
	}

	const colorSplitLineGroups = $derived(enableColorSplitLines ? topGroupKeys(config.colorColumn) : [] as string[]);
	const colorSplitScatterGroups = $derived(enableColorSplitScatter ? topGroupKeys(config.colorColumn) : [] as string[]);

	// Unique x-categories in appearance order (for category-axis grouped lines)
	const colorSplitLineXCategories = $derived.by(() => {
		if (!enableColorSplitLines || xIsMostlyDateLike || xIsMostlyNumeric) return [] as string[];
		const seen = new Set<string>();
		const cats: string[] = [];
		for (const row of rows) {
			const xv = row[config.xColumn];
			if (xv == null) continue;
			const s = String(xv);
			if (!seen.has(s)) { seen.add(s); cats.push(s); }
		}
		return cats;
	});

	function getColorGroupLineData(groupKey: string): unknown[] {
		if (!config.xColumn || config.yColumns.length === 0 || !config.colorColumn) return [];
		const yCol = config.yColumns[0];
		const groupRows = rows.filter(
			(r) => r[config.colorColumn!] != null && String(r[config.colorColumn!]) === groupKey && r[config.xColumn] != null
		);
		if (xIsMostlyDateLike) {
			return groupRows.map((r) => [new Date(r[config.xColumn] as string | number | Date).getTime(), coerceNumber(r[yCol])]);
		}
		if (xIsMostlyNumeric) {
			return groupRows.map((r) => [toNumber(r[config.xColumn]) ?? r[config.xColumn], coerceNumber(r[yCol])]);
		}
		// Category axis: align values to the shared x-category list
		const groupMap = new Map<string, number>();
		for (const r of groupRows) {
			const xStr = String(r[config.xColumn]);
			groupMap.set(xStr, (groupMap.get(xStr) ?? 0) + (coerceNumber(r[yCol]) ?? 0));
		}
		return colorSplitLineXCategories.map((cat) => groupMap.get(cat) ?? null);
	}

	function getScatterGroupData(groupKey: string): unknown[] {
		if (!config.xColumn || config.yColumns.length === 0 || !config.colorColumn) return [];
		const yCol = config.yColumns[0];
		const isBubble = config.chartType === 'bubble';
		return rows
			.filter((r) => r[config.colorColumn!] != null && String(r[config.colorColumn!]) === groupKey && r[config.xColumn] != null)
			.map((r) => {
				const pt: unknown[] = [r[config.xColumn], coerceNumber(r[yCol])];
				if (isBubble && config.sizeColumn) pt.push(coerceNumber(r[config.sizeColumn]) ?? 1);
				return pt;
			});
	}

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
		const base = enableColorSplitBars && colorSplitSeriesList.length > 0 ? colorSplitBarData : chartData;
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
	interface BinDatum { x0: number; x1: number; y: number }
	const histData = $derived.by((): BinDatum[] => {
		if (config.yColumns.length === 0) return [];
		const col = config.yColumns[0];
		const vals = rows
			.map((r) => coerceNumber(r[col]))
			.filter((v): v is number => v !== null);
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
			? rows.map((r) => ({
					date: r[sparkCol],
					val: coerceNumber(r[config.xColumn]) ?? 0
			  })).filter((p) => p.date != null)
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
		if (t === 'table' || t === 'big-value' || t === 'value' || t === 'delta') return false;
		if (t === 'histogram') return config.yColumns.length === 0;
		if (t === 'heatmap') return !config.xColumn || !config.colorColumn || config.yColumns.length === 0;
		if (t === 'box-plot') return config.yColumns.length < 5;
		if (t === 'sankey') return !config.xColumn || !config.colorColumn || config.yColumns.length === 0;
		return !config.xColumn || config.yColumns.length === 0;
	});

	// ── ECharts helpers ────────────────────────────────────────────────────────
	function buildXAxis(forceCategory = false): object {
		if (!forceCategory && xIsMostlyDateLike) {
			return { type: 'time', axisLabel: { hideOverlap: true } };
		}
		if (!forceCategory && xIsMostlyNumeric) {
			return { type: 'value', axisLabel: { formatter: fmtNum } };
		}
		return {
			type: 'category',
			data: chartData.map((d) => String(d.x ?? '')),
			axisLabel: {
				rotate: shouldRotateXLabels ? -30 : 0,
				interval: 'auto',
				formatter: (v: string) => (v.length > 14 ? v.slice(0, 13) + '…' : v)
			}
		};
	}

	function getSeriesData(key: string): unknown[] {
		if (xIsMostlyDateLike) {
			return chartData.map((d) => [new Date(d.x as string | number | Date).getTime(), d[key]]);
		}
		if (xIsMostlyNumeric) {
			return chartData.map((d) => [d.x, d[key]]);
		}
		return chartData.map((d) => d[key] ?? null);
	}

	// ── ECharts option builder ─────────────────────────────────────────────────
	const echartsOption = $derived.by((): object => {
		const t = config.chartType;

		// ── Line / Area ──────────────────────────────────────────────────────
		if (t === 'line' || t === 'area') {
			const isArea = t === 'area';

			// ── Grouped by colorColumn ─────────────────────────────────────
			if (enableColorSplitLines && colorSplitLineGroups.length > 0) {
				const xAxis = (xIsMostlyDateLike || xIsMostlyNumeric)
					? buildXAxis()
					: {
						type: 'category',
						data: colorSplitLineXCategories,
						axisLabel: {
							rotate: (colorSplitLineXCategories.length > 8 || Math.max(0, ...colorSplitLineXCategories.map((c) => c.length)) > 12) ? -30 : 0,
							interval: 'auto',
							formatter: (v: string) => (v.length > 14 ? v.slice(0, 13) + '…' : v)
						}
					};
				const series = colorSplitLineGroups.map((groupKey) => ({
					type: 'line',
					name: humanize(groupKey),
					data: getColorGroupLineData(groupKey),
					smooth: true,
					symbol: 'circle',
					symbolSize: 3,
					emphasis: { focus: 'series' },
					...(isArea ? { areaStyle: { opacity: 0.2 } } : {}),
					...(isArea && areaSeriesLayout === 'stack' ? { stack: 'total' } : {})
				}));
				return {
					tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
					legend: hasSeries ? { bottom: 2 } : { show: false },
					xAxis,
					yAxis: [{ type: 'value', axisLabel: { formatter: fmtNum } }],
					series,
					...(rows.length > 80 ? { dataZoom: [{ type: 'inside' }] } : {})
				};
			}

			// ── Multiple Y columns (standard) ──────────────────────────────
			const yAxes: object[] = [{ type: 'value', axisLabel: { formatter: fmtNum } }];
			if (hasSecondaryAxis) {
				yAxes.push({
					type: 'value',
					axisLabel: { formatter: fmtNum },
					splitLine: { show: false }
				});
			}
			const primarySeries = seriesList.map((s) => ({
				type: 'line',
				name: s.label,
				data: getSeriesData(s.key),
				smooth: true,
				symbol: 'circle',
				symbolSize: 3,
				emphasis: { focus: 'series' },
				...(isArea ? { areaStyle: { opacity: 0.2 } } : {}),
				...(isArea && areaSeriesLayout === 'stack' ? { stack: 'total' } : {})
			}));
			const secondSeries = secondarySeriesList.map((s) => ({
				type: 'line',
				name: s.label,
				data: getSeriesData(s.key),
				yAxisIndex: 1,
				smooth: true,
				symbol: 'circle',
				symbolSize: 3,
				emphasis: { focus: 'series' }
			}));
			return {
				tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
				legend: hasSeries ? { bottom: 2 } : { show: false },
				xAxis: buildXAxis(),
				yAxis: yAxes,
				series: [...primarySeries, ...secondSeries],
				...(chartData.length > 80 ? { dataZoom: [{ type: 'inside' }] } : {})
			};
		}

		// ── Bar / Bar-horizontal ─────────────────────────────────────────────
		if (t === 'bar' || t === 'bar-horizontal') {
			const isHoriz = t === 'bar-horizontal';
			const catData = sortedBarData.map((d) => String(d.x ?? ''));
			const catAxis = {
				type: 'category',
				data: catData,
				axisLabel: {
					rotate: !isHoriz && shouldRotateXLabels ? -30 : 0,
					interval: 'auto',
					formatter: (v: string) => (v.length > 14 ? v.slice(0, 13) + '…' : v)
				}
			};
			const valAxis = { type: 'value', axisLabel: { formatter: fmtNum } };
			const series = barSeriesToRender.map((s) => ({
				type: 'bar',
				name: s.label,
				data: sortedBarData.map((d) => ((d as Record<string, unknown>)[s.key] as number) ?? null),
				barMaxWidth: isHoriz ? 24 : 40,
				stack: barSeriesLayout === 'stack' ? 'total' : undefined,
				itemStyle: { borderRadius: isHoriz ? [0, 3, 3, 0] : [3, 3, 0, 0] },
				emphasis: { focus: 'series' }
			}));
			return {
				tooltip: { trigger: 'axis' },
				legend: hasSeries ? { bottom: 2 } : { show: false },
				xAxis: isHoriz ? valAxis : catAxis,
				yAxis: isHoriz ? { ...catAxis, inverse: false } : valAxis,
				series,
				...(sortedBarData.length > 30
					? { dataZoom: [{ type: 'inside', orient: isHoriz ? 'vertical' : 'horizontal' }] }
					: {})
			};
		}

		// ── Scatter / Bubble ─────────────────────────────────────────────────
		if (t === 'scatter' || t === 'bubble') {
			const isBubble = t === 'bubble';
			const yCol = config.yColumns[0];
			const tooltipFmt = (p: unknown) => {
				const params = p as { seriesName?: string; data: unknown[] };
				const label = params.seriesName ? `${params.seriesName}: ` : '';
				return `${label}${fmtNum(params.data[0])}, ${fmtNum(params.data[1])}`;
			};
			const symbolSizeFn = isBubble && config.sizeColumn
				? (d: unknown[]) => { const s = Number(d[2]) || 1; return Math.max(4, Math.min(60, Math.sqrt(Math.abs(s)) * 4)); }
				: undefined;

			// ── Grouped by colorColumn ─────────────────────────────────────
			if (enableColorSplitScatter && colorSplitScatterGroups.length > 0) {
				const series = colorSplitScatterGroups.map((groupKey) => ({
					type: 'scatter',
					name: humanize(groupKey),
					data: getScatterGroupData(groupKey),
					emphasis: { focus: 'series' },
					...(symbolSizeFn ? { symbolSize: symbolSizeFn } : { symbolSize: 6 })
				}));
				return {
					tooltip: { trigger: 'item', formatter: tooltipFmt },
					legend: hasSeries ? { bottom: 2 } : { show: false },
					xAxis: {
						type: xIsMostlyDateLike ? ('time' as const) : xIsMostlyNumeric ? ('value' as const) : ('category' as const),
						axisLabel: { formatter: fmtNum }
					},
					yAxis: { type: 'value', name: humanize(yCol), axisLabel: { formatter: fmtNum } },
					series
				};
			}

			// ── Single series (no colorColumn) ─────────────────────────────
			const data = chartData.map((d) => {
				const pt: unknown[] = [d.x, d[yCol]];
				if (isBubble && config.sizeColumn) pt.push(d._size ?? 1);
				return pt;
			});
			return {
				tooltip: { trigger: 'item', formatter: tooltipFmt },
				xAxis: {
					type: xIsMostlyDateLike ? ('time' as const) : xIsMostlyNumeric ? ('value' as const) : ('category' as const),
					axisLabel: { formatter: fmtNum }
				},
				yAxis: { type: 'value', name: humanize(yCol), axisLabel: { formatter: fmtNum } },
				series: [
					{
						type: 'scatter',
						large: true,
						data,
						...(symbolSizeFn ? { symbolSize: symbolSizeFn } : { symbolSize: 6 })
					}
				]
			};
		}

		// ── Pie ──────────────────────────────────────────────────────────────
		if (t === 'pie') {
			return {
				tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
				legend: { type: 'scroll', bottom: 0 },
				series: [
					{
						type: 'pie',
						radius: '65%',
						center: ['50%', '46%'],
						data: pieData.map((d) => ({ name: d.x, value: d.y })),
						label: { formatter: '{b}: {d}%', fontSize: 11 },
						emphasis: {
							itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,0.2)' },
							label: { show: true, fontWeight: 'bold' }
						}
					}
				]
			};
		}

		// ── Histogram ────────────────────────────────────────────────────────
		if (t === 'histogram') {
			return {
				tooltip: { trigger: 'axis' },
				xAxis: {
					type: 'category',
					data: histData.map((d) => fmtNum(d.x0)),
					axisLabel: { rotate: -30, interval: 'auto' },
					name: config.yColumns[0] ? humanize(config.yColumns[0]) : '',
					nameLocation: 'middle',
					nameGap: 28
				},
				yAxis: { type: 'value', name: 'Count', axisLabel: { formatter: fmtNum } },
				series: [
					{
						type: 'bar',
						data: histData.map((d) => d.y),
						barCategoryGap: '2%',
						itemStyle: { borderRadius: [2, 2, 0, 0] }
					}
				]
			};
		}

		// ── Heatmap ──────────────────────────────────────────────────────────
		if (t === 'heatmap') {
			const { cells, xLabels, yLabels, minVal, maxVal } = heatmapData;
			return {
				tooltip: {
					formatter: (p: unknown) => {
						const params = p as { data: [string, string, number | null] };
						const val = params.data[2];
						return `${params.data[0]} / ${params.data[1]}: ${val != null ? fmtNum(val) : 'N/A'}`;
					}
				},
				grid: { top: 8, bottom: 68, left: 80, right: 24, containLabel: false },
				xAxis: {
					type: 'category',
					data: xLabels,
					splitArea: { show: true },
					axisLabel: { rotate: -30, fontSize: 10, interval: 'auto' }
				},
				yAxis: {
					type: 'category',
					data: yLabels,
					splitArea: { show: true },
					axisLabel: { fontSize: 10 }
				},
				visualMap: {
					min: minVal,
					max: maxVal,
					calculable: true,
					orient: 'horizontal',
					left: 'center',
					bottom: 4,
					itemHeight: 80,
					textStyle: { fontSize: 10 }
				},
				series: [
					{
						type: 'heatmap',
						data: cells.map((c) => [c.x, c.y, c.value]),
						label: { show: cells.length < 200, fontSize: 9 },
						emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.25)' } }
					}
				]
			};
		}

		// ── Calendar heatmap ─────────────────────────────────────────────────
		if (t === 'calendar-heatmap') {
			const { pairs, years, minVal, maxVal } = calendarData;
			if (years.length === 0) return {};
			return {
				tooltip: {
					formatter: (p: unknown) => {
						const params = p as { data: [string, number] };
						return `${params.data[0]}: ${fmtNum(params.data[1])}`;
					}
				},
				visualMap: {
					min: minVal,
					max: maxVal,
					show: true,
					orient: 'horizontal',
					left: 'center',
					bottom: 4,
					itemHeight: 80
				},
				calendar: years.map((year, i) => ({
					range: year,
					top: 24 + i * 120,
					left: 56,
					right: 12,
					cellSize: ['auto', 13],
					yearLabel: { show: true, fontSize: 11 },
					monthLabel: { fontSize: 10 },
					dayLabel: { fontSize: 9, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] }
				})),
				series: years.map((year, i) => ({
					type: 'heatmap',
					coordinateSystem: 'calendar',
					calendarIndex: i,
					data: pairs.filter((p) => p[0].startsWith(year))
				}))
			};
		}

		// ── Funnel ───────────────────────────────────────────────────────────
		if (t === 'funnel') {
			return {
				tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
				legend: { type: 'scroll', bottom: 0, orient: 'horizontal' },
				series: [
					{
						type: 'funnel',
						left: '8%',
						width: '84%',
						top: 8,
						bottom: 36,
						data: funnelData.map((d) => ({ name: d.x, value: d.y })),
						gap: 3,
						label: { position: 'inside', fontSize: 11, formatter: '{b}: {c}' },
						labelLine: { show: false },
						emphasis: { focus: 'self', label: { fontSize: 13, fontWeight: 'bold' } }
					}
				]
			};
		}

		// ── Box-plot ─────────────────────────────────────────────────────────
		if (t === 'box-plot') {
			return {
				tooltip: {
					trigger: 'item',
					formatter: (p: unknown) => {
						const params = p as { name: string; data: number[] };
						return [
							params.name,
							`Max: ${fmtNum(params.data[4])}`,
							`Q3: ${fmtNum(params.data[3])}`,
							`Median: ${fmtNum(params.data[2])}`,
							`Q1: ${fmtNum(params.data[1])}`,
							`Min: ${fmtNum(params.data[0])}`
						].join('<br/>');
					}
				},
				xAxis: {
					type: 'category',
					data: boxPlotData.map((d) => d.name),
					axisLabel: { rotate: boxPlotData.length > 6 ? -30 : 0, interval: 'auto' }
				},
				yAxis: { type: 'value', axisLabel: { formatter: fmtNum } },
				series: [
					{
						type: 'boxplot',
						data: boxPlotData.map((d) => [d.min, d.q1, d.median, d.q3, d.max]),
						itemStyle: { borderWidth: 1.5 }
					}
				]
			};
		}

		// ── Sankey ───────────────────────────────────────────────────────────
		if (t === 'sankey') {
			return {
				tooltip: { trigger: 'item', triggerOn: 'mousemove' },
				series: [
					{
						type: 'sankey',
						emphasis: { focus: 'adjacency' },
						nodeAlign: 'left',
						data: sankeyNodes,
						links: sankeyData.map((d) => ({ source: d.source, target: d.target, value: d.value })),
						label: { fontSize: 11 },
						lineStyle: { color: 'gradient', curveness: 0.5 }
					}
				]
			};
		}

		return {};
	});
</script>

<div class="w-full pb-2 flex flex-col" style="height:{height}px">
	{#if config.title}
		<div class="mb-1 px-1 shrink-0">
			<p class="text-sm font-medium text-foreground leading-tight">{config.title}</p>
			{#if config.description}<p class="text-xs text-muted-foreground">{config.description}</p>{/if}
		</div>
	{/if}
	<div class="flex-1 min-h-0">
	{#if config.chartType === 'table'}
		{@const displayCols = columns.length > 0 ? columns : (rows[0] ? Object.keys(rows[0]) : [])}
		<div class="w-full h-full overflow-auto rounded-md border border-border/60 text-xs">
			<table class="w-full border-collapse">
				<thead class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
					<tr>
						{#each displayCols as col (col)}
							<th class="px-2 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap border-b border-border/60 first:pl-3 last:pr-3">
								{col}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows.slice(0, 200) as row, i (i)}
						<tr class="border-b border-border/30 hover:bg-muted/30 transition-colors">
							{#each displayCols as col (col)}
								<td class="px-2 py-1 text-foreground/90 whitespace-nowrap max-w-48 truncate first:pl-3 last:pr-3" title={String(row[col] ?? '')}>
									{row[col] ?? ''}
								</td>
							{/each}
						</tr>
					{/each}
					{#if rows.length > 200}
						<tr>
							<td colspan={displayCols.length} class="px-3 py-1.5 text-center text-muted-foreground italic">
								Showing 200 of {rows.length} rows
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	{:else if config.chartType === 'big-value'}
		{#if !config.xColumn}
			<div class="flex items-center justify-center h-full text-sm text-muted-foreground">Configure a Value column (X).</div>
		{:else if bigValueData}
			{@const d = bigValueData}
			<div class="flex flex-col items-start justify-center h-full px-4 gap-1">
				{#if config.title}
					<p class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{config.title}</p>
				{/if}
				<p class="text-5xl font-bold text-foreground tabular-nums leading-none">
					{typeof d.val === 'number' ? numericFormatter.format(d.val) : String(d.val ?? '—')}
				</p>
				{#if d.comp !== null && d.compCol}
					{@const positive = d.comp >= 0}
					<p class="text-sm font-medium {positive ? 'text-green-500' : 'text-red-500'} flex items-center gap-0.5">
						<span>{positive ? '▲' : '▼'}</span>
						<span>{numericFormatter.format(Math.abs(d.comp))}</span>
						<span class="text-muted-foreground font-normal ml-1">{d.compCol}</span>
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
							points={d.sparkPoints.map((p, i) => `${(i / (d.sparkPoints.length - 1)) * W},${H - ((p.val - sparkMin) / sparkRange) * H}`).join(' ')}
						/>
					</svg>
				{/if}
			</div>
		{:else}
			<div class="flex items-center justify-center h-full text-sm text-muted-foreground">No data.</div>
		{/if}
	{:else if config.chartType === 'value'}
		{#if !config.xColumn}
			<div class="flex items-center justify-center h-full text-sm text-muted-foreground">Configure a Value column (X).</div>
		{:else}
			{@const row = rows[config.valueRow ?? 0] ?? rows[0]}
			{@const val = row ? (coerceNumber(row[config.xColumn]) ?? row[config.xColumn]) : null}
			<div class="flex items-center justify-center h-full">
				<div class="flex flex-col items-center gap-1">
					{#if config.title}
						<p class="text-xs text-muted-foreground uppercase tracking-wide">{config.title}</p>
					{/if}
					<p class="text-3xl font-semibold text-foreground tabular-nums">
						{typeof val === 'number' ? numericFormatter.format(val) : String(val ?? '—')}
					</p>
				</div>
			</div>
		{/if}
	{:else if config.chartType === 'delta'}
		{#if !config.xColumn}
			<div class="flex items-center justify-center h-full text-sm text-muted-foreground">Configure a Delta column (X).</div>
		{:else if deltaData !== null}
			{@const positive = config.deltaDownIsGood ? deltaData <= 0 : deltaData >= 0}
			{@const neutral = deltaData === 0}
			<div class="flex items-center justify-center h-full">
				<div class="flex flex-col items-center gap-1">
					{#if config.title}
						<p class="text-xs text-muted-foreground uppercase tracking-wide">{config.title}</p>
					{/if}
					<p class="text-4xl font-bold tabular-nums flex items-center gap-2 {neutral ? 'text-muted-foreground' : positive ? 'text-green-500' : 'text-red-500'}">
						<span class="text-2xl">{neutral ? '—' : positive ? '▲' : '▼'}</span>
						<span>{numericFormatter.format(Math.abs(deltaData))}</span>
					</p>
				</div>
			</div>
		{:else}
			<div class="flex items-center justify-center h-full text-sm text-muted-foreground">No data.</div>
		{/if}
	{:else if needsConfig}
		<div class="flex items-center justify-center h-full text-sm text-muted-foreground">
			{#if config.chartType === 'box-plot'}
				Box plot requires 5 Y columns: Min, Q1, Median, Q3, Max.
			{:else}
				Configure columns to render this chart.
			{/if}
		</div>
	{:else}
		<EChart option={echartsOption} />
	{/if}
	</div>
</div>
