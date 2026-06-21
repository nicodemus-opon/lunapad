<script lang="ts">
	import PlotChart from './PlotChart.svelte';
	import * as Plot from '@observablehq/plot';
	import { pie, arc, type PieArcDatum } from 'd3-shape';
	import { sankey, sankeyLinkHorizontal, sankeyLeft } from 'd3-sankey';
	import { mode } from 'mode-watcher';
	import type { ChartConfig, ChartType } from '$lib/types/gui-pipeline';
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
		if (t === 'table' || t === 'big-value' || t === 'value' || t === 'delta' || t === 'custom') return false;
		if (t === 'histogram') return config.yColumns.length === 0;
		if (t === 'heatmap') return !config.xColumn || !config.colorColumn || config.yColumns.length === 0;
		if (t === 'box-plot') return config.yColumns.length < 5;
		if (t === 'sankey') return !config.xColumn || !config.colorColumn || config.yColumns.length === 0;
		return !config.xColumn || config.yColumns.length === 0;
	});

	const CHART_COLOR_RANGE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
	const PLOT_STYLE = {
		fontFamily: 'Inter, system-ui, sans-serif',
		fontSize: '11px',
		background: 'transparent',
		color: 'var(--muted-foreground)'
	};

	// Discrete fill/stroke channels can use raw var(--chart-1) strings — the browser
	// resolves them at paint time, same as any other CSS. But a *continuous* color
	// scale (heatmap/calendar-heatmap) needs Plot/d3 to interpolate between the range
	// endpoints in JS at scale-construction time, which requires an actual parseable
	// color, not a CSS custom property reference. Resolve to a concrete value instead.
	function oklchToRgb(l: number, c: number, h: number): string {
		const hRad = (h * Math.PI) / 180;
		const a = c * Math.cos(hRad);
		const b = c * Math.sin(hRad);
		const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
		const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
		const s_ = l - 0.0894841775 * a - 1.291485548 * b;
		const ll = l_ ** 3, mm = m_ ** 3, ss = s_ ** 3;
		const lr = 4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss;
		const lg = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss;
		const lb = -0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss;
		const gamma = (x: number) => {
			const v = Math.max(0, Math.min(1, x));
			return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
		};
		return `rgb(${Math.round(gamma(lr) * 255)},${Math.round(gamma(lg) * 255)},${Math.round(gamma(lb) * 255)})`;
	}

	function resolveCSSColor(varName: string): string {
		const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
		const m = raw.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
		if (m) return oklchToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
		return raw;
	}

	// Coerces a raw x value to the right JS type for Plot's scale inference
	// (Plot infers scale type from the channel's actual JS value type, unlike
	// ECharts which took an explicit axis `type` string).
	function xValue(raw: unknown): unknown {
		if (xIsMostlyDateLike) return new Date(raw as string | number | Date);
		if (xIsMostlyNumeric) return toNumber(raw);
		return String(raw ?? '');
	}

	// Plot's default ordinal-scale domain is sorted ascending, which scrambles
	// natural data order (e.g. month names) — pass this as an explicit `domain`
	// wherever the x/y channel is categorical, to preserve row order like the
	// old ECharts category axis did.
	function categoricalDomain(values: unknown[]): string[] {
		const seen = new Set<string>();
		for (const v of values) {
			if (v == null) continue;
			seen.add(String(v));
		}
		return [...seen];
	}

	// Reshapes a wide {x, [seriesKey]: value}[] dataset into long {x, series, value}[]
	// rows, which Plot's fill/stroke + facet/stack channels expect for multi-series marks.
	function meltSeries(
		data: Record<string, unknown>[],
		series: { key: string; label: string }[]
	): { x: string; series: string; value: number | null }[] {
		const out: { x: string; series: string; value: number | null }[] = [];
		for (const d of data) {
			for (const s of series) {
				out.push({ x: String(d.x ?? ''), series: s.label, value: toNumber(d[s.key]) });
			}
		}
		return out;
	}

	const SVG_NS = 'http://www.w3.org/2000/svg';
	const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

	// Plot has no native pie/funnel/sankey mark, so these three build raw SVG
	// directly — PlotChart's render contract only needs "any DOM Element", not
	// specifically a Plot.plot() result.
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

	function renderPie(data: { x: string; y: number }[], width: number, height: number): Element {
		const total = data.reduce((s, d) => s + d.y, 0);
		const legendH = 32;
		const svgH = Math.max(40, height - legendH);
		const radius = Math.min(width, svgH) / 2 - 16;
		const pieGen = pie<{ x: string; y: number }>().value((d) => d.y).sort(null);
		const arcGen = arc<PieArcDatum<{ x: string; y: number }>>().innerRadius(radius * 0.55).outerRadius(radius);

		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(svgH));
		svg.setAttribute('viewBox', `0 0 ${width} ${svgH}`);
		const g = document.createElementNS(SVG_NS, 'g');
		g.setAttribute('transform', `translate(${width / 2},${svgH / 2})`);

		pieGen(data).forEach((a, i) => {
			const path = document.createElementNS(SVG_NS, 'path');
			path.setAttribute('d', arcGen(a) ?? '');
			path.setAttribute('fill', CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length]);
			const pct = total > 0 ? ((a.data.y / total) * 100).toFixed(1) : '0';
			const title = document.createElementNS(SVG_NS, 'title');
			title.textContent = `${a.data.x}: ${fmtNum(a.data.y)} (${pct}%)`;
			path.appendChild(title);
			g.appendChild(path);

			if (a.endAngle - a.startAngle > 0.35) {
				const [lx, ly] = arcGen.centroid(a);
				const text = document.createElementNS(SVG_NS, 'text');
				text.setAttribute('x', String(lx));
				text.setAttribute('y', String(ly));
				text.setAttribute('text-anchor', 'middle');
				text.setAttribute('font-size', '10');
				text.setAttribute('fill', 'var(--popover-foreground)');
				text.textContent = `${pct}%`;
				g.appendChild(text);
			}
		});
		svg.appendChild(g);

		const wrap = document.createElement('div');
		wrap.style.display = 'flex';
		wrap.style.flexDirection = 'column';
		wrap.style.height = '100%';
		wrap.appendChild(svg);

		const legend = document.createElement('div');
		legend.style.cssText = `display:flex;flex-wrap:wrap;gap:8px;justify-content:center;font-size:11px;color:var(--muted-foreground);height:${legendH}px;align-items:center;overflow:hidden`;
		data.forEach((d, i) => {
			const item = document.createElement('span');
			item.style.cssText = 'display:inline-flex;align-items:center;gap:4px';
			const swatch = document.createElement('span');
			swatch.style.cssText = `width:8px;height:8px;border-radius:2px;background:${CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length]}`;
			item.appendChild(swatch);
			item.appendChild(document.createTextNode(d.x));
			legend.appendChild(item);
		});
		wrap.appendChild(legend);
		return wrap;
	}

	function renderFunnel(data: { x: string; y: number }[], width: number, height: number): Element {
		const max = Math.max(...data.map((d) => d.y), 1);
		const first = data[0]?.y || 1;
		const n = data.length;
		const gap = 3;
		const stageH = n > 0 ? (height - gap * (n - 1)) / n : height;
		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		const widthFrac = (v: number) => (v / max) * width * 0.84;

		data.forEach((d, i) => {
			const topW = widthFrac(d.y);
			const bottomW = i < n - 1 ? widthFrac(data[i + 1].y) : topW;
			const y0 = i * (stageH + gap);
			const y1 = y0 + stageH;
			const x0a = (width - topW) / 2;
			const x0b = (width + topW) / 2;
			const x1a = (width - bottomW) / 2;
			const x1b = (width + bottomW) / 2;

			const path = document.createElementNS(SVG_NS, 'path');
			path.setAttribute('d', `M${x0a},${y0} L${x0b},${y0} L${x1b},${y1} L${x1a},${y1} Z`);
			path.setAttribute('fill', CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length]);
			const title = document.createElementNS(SVG_NS, 'title');
			title.textContent = `${d.x}: ${fmtNum(d.y)} (${((d.y / first) * 100).toFixed(1)}%)`;
			path.appendChild(title);
			svg.appendChild(path);

			const text = document.createElementNS(SVG_NS, 'text');
			text.setAttribute('x', String(width / 2));
			text.setAttribute('y', String((y0 + y1) / 2));
			text.setAttribute('text-anchor', 'middle');
			text.setAttribute('dominant-baseline', 'middle');
			text.setAttribute('font-size', '11');
			text.setAttribute('fill', 'var(--popover-foreground)');
			text.textContent = `${d.x}: ${fmtNum(d.y)}`;
			svg.appendChild(text);
		});
		return svg;
	}

	interface SankeyNodeIn { name: string }
	interface SankeyLinkIn { source: string; target: string; value: number }

	function renderSankey(nodesIn: SankeyNodeIn[], linksIn: SankeyLinkIn[], width: number, height: number): Element {
		const gen = sankey<SankeyNodeIn, Record<string, unknown>>()
			.nodeId((d) => d.name)
			.nodeAlign(sankeyLeft)
			.nodeWidth(14)
			.nodePadding(10)
			.extent([
				[1, 1],
				[Math.max(2, width - 1), Math.max(2, height - 1)]
			]);
		// d3-sankey mutates its inputs in place — copy so Svelte's reactive arrays aren't touched
		const { nodes, links } = gen({
			nodes: nodesIn.map((d) => ({ ...d })),
			links: linksIn.map((d) => ({ ...d }))
		});

		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		const linkPath = sankeyLinkHorizontal();

		links.forEach((l, i) => {
			const path = document.createElementNS(SVG_NS, 'path');
			path.setAttribute('d', linkPath(l as Parameters<typeof linkPath>[0]) ?? '');
			path.setAttribute('fill', 'none');
			path.setAttribute('stroke', CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length]);
			path.setAttribute('stroke-opacity', '0.4');
			path.setAttribute('stroke-width', String(Math.max(1, l.width ?? 1)));
			const title = document.createElementNS(SVG_NS, 'title');
			const sourceName = typeof l.source === 'object' ? (l.source as SankeyNodeIn).name : String(l.source);
			const targetName = typeof l.target === 'object' ? (l.target as SankeyNodeIn).name : String(l.target);
			title.textContent = `${sourceName} → ${targetName}: ${fmtNum(l.value)}`;
			path.appendChild(title);
			svg.appendChild(path);
		});

		nodes.forEach((node, i) => {
			const x0 = node.x0 ?? 0;
			const x1 = node.x1 ?? 0;
			const y0 = node.y0 ?? 0;
			const y1 = node.y1 ?? 0;
			const rect = document.createElementNS(SVG_NS, 'rect');
			rect.setAttribute('x', String(x0));
			rect.setAttribute('y', String(y0));
			rect.setAttribute('width', String(x1 - x0));
			rect.setAttribute('height', String(y1 - y0));
			rect.setAttribute('fill', CHART_COLOR_RANGE[i % CHART_COLOR_RANGE.length]);
			svg.appendChild(rect);

			const text = document.createElementNS(SVG_NS, 'text');
			const onLeft = x0 < width / 2;
			text.setAttribute('x', String(onLeft ? x1 + 6 : x0 - 6));
			text.setAttribute('y', String((y0 + y1) / 2));
			text.setAttribute('text-anchor', onLeft ? 'start' : 'end');
			text.setAttribute('dominant-baseline', 'middle');
			text.setAttribute('font-size', '11');
			text.setAttribute('fill', 'var(--popover-foreground)');
			text.textContent = node.name;
			svg.appendChild(text);
		});
		return svg;
	}

	const customRender = $derived.by(() => {
		if (config.chartType !== 'custom') return null;
		return (width: number, height: number): Element => {
			try {
				// eslint-disable-next-line no-new-func
				const fn = new Function(
					'rows', 'columns', 'Plot', 'width', 'height',
					`'use strict'; ${config.code ?? ''}`
				);
				const result = fn(rows, columns, Plot, width, height);
				return result instanceof Element ? result : Plot.plot(result);
			} catch (e) {
				const div = document.createElement('div');
				div.className = 'text-sm text-destructive p-4';
				div.textContent = `Plot spec error: ${e instanceof Error ? e.message : String(e)}`;
				return div;
			}
		};
	});

	const plotRender = $derived.by((): ((width: number, height: number) => Element) | null => {
		const t = config.chartType;

		if (t === 'custom') return customRender;

		// ── Histogram ────────────────────────────────────────────────────────
		if (t === 'histogram') {
			const bins = histData;
			const xLabel = config.yColumns[0] ? humanize(config.yColumns[0]) : '';
			return (width, height) =>
				Plot.plot({
					width,
					height,
					style: PLOT_STYLE,
					x: { label: xLabel, tickFormat: fmtNum },
					y: { label: 'Count', tickFormat: fmtNum, grid: true },
					marks: [
						Plot.rectY(bins, { x1: 'x0', x2: 'x1', y: 'y', fill: 'var(--chart-1)' }),
						Plot.ruleY([0])
					]
				});
		}

		// ── Heatmap ──────────────────────────────────────────────────────────
		if (t === 'heatmap') {
			const { cells, xLabels, yLabels, minVal, maxVal } = heatmapData;
			void mode.current; // re-resolve colors when the theme toggles
			const colorRange = [resolveCSSColor('--background'), resolveCSSColor('--chart-1')];
			return (width, height) =>
				Plot.plot({
					width,
					height,
					style: PLOT_STYLE,
					marginLeft: 90,
					marginBottom: 60,
					x: { domain: xLabels },
					y: { domain: yLabels },
					color: { type: 'linear', domain: [minVal, maxVal], range: colorRange },
					marks: [
						Plot.cell(cells, {
							x: 'x',
							y: 'y',
							fill: 'value',
							title: (d: { x: string; y: string; value: number | null }) =>
								`${d.x} / ${d.y}: ${d.value != null ? fmtNum(d.value) : 'N/A'}`
						})
					]
				});
		}

		// ── Scatter / Bubble ─────────────────────────────────────────────────
		if (t === 'scatter' || t === 'bubble') {
			const isBubble = t === 'bubble';
			const yCol = config.yColumns[0];
			const colorSplit = enableColorSplitScatter && colorSplitScatterGroups.length > 0;
			const groups = colorSplitScatterGroups;
			const colorCol = config.colorColumn;

			const data = colorSplit
				? rows
						.filter(
							(r) =>
								colorCol != null && r[colorCol] != null && groups.includes(String(r[colorCol])) &&
								r[config.xColumn] != null && r[yCol] != null
						)
						.map((r) => ({
							x: xValue(r[config.xColumn]),
							y: coerceNumber(r[yCol]),
							group: String(r[colorCol as string]),
							size: isBubble && config.sizeColumn ? coerceNumber(r[config.sizeColumn]) : null
						}))
				: chartData
						.filter((d) => d[yCol] != null)
						.map((d) => ({ x: xValue(d.x), y: d[yCol] as number | null, group: '', size: (d._size as number | null) ?? null }));

			const xCategorical = !xIsMostlyDateLike && !xIsMostlyNumeric;
			const xDomain = xCategorical ? categoricalDomain(data.map((d) => d.x)) : undefined;

			return (width, height) =>
				Plot.plot({
					width,
					height,
					style: PLOT_STYLE,
					color: colorSplit ? { type: 'ordinal', range: CHART_COLOR_RANGE } : undefined,
					r: isBubble ? { range: [4, 30] } : undefined,
					x: xDomain ? { domain: xDomain } : {},
					y: { label: humanize(yCol), tickFormat: fmtNum, grid: true },
					marks: [
						Plot.dot(data, {
							x: 'x',
							y: 'y',
							r: isBubble ? 'size' : undefined,
							fill: colorSplit ? 'group' : 'var(--chart-1)',
							title: (d: { group: string; x: unknown; y: number | null }) =>
								`${colorSplit ? humanize(d.group) + ': ' : ''}${fmtNum(d.x)}, ${fmtNum(d.y)}`
						})
					]
				});
		}

		// ── Bar / Bar-horizontal ─────────────────────────────────────────────
		if (t === 'bar' || t === 'bar-horizontal') {
			const isHoriz = t === 'bar-horizontal';
			const data = sortedBarData;
			const seriesDef = barSeriesToRender;
			const layout = barSeriesLayout;
			const valueLabel = seriesDef.length === 1 ? seriesDef[0].label : '';
			const catDomain = categoricalDomain(data.map((d) => (d as Record<string, unknown>).x));

			let marks: Plot.Markish[];
			const catScale: Record<string, unknown> = {};
			if (seriesDef.length <= 1) {
				const key = seriesDef[0]?.key ?? 'x';
				const flat = data.map((d) => ({
					x: String((d as Record<string, unknown>).x ?? ''),
					value: toNumber((d as Record<string, unknown>)[key])
				}));
				marks = [
					isHoriz
						? Plot.barX(flat, { y: 'x', x: 'value', fill: 'var(--chart-1)' })
						: Plot.barY(flat, { x: 'x', y: 'value', fill: 'var(--chart-1)' })
				];
				catScale[isHoriz ? 'y' : 'x'] = { domain: catDomain };
			} else {
				const long = meltSeries(data as Record<string, unknown>[], seriesDef);
				if (layout === 'stack') {
					marks = [
						isHoriz
							? Plot.barX(long, Plot.stackX({ y: 'x', x: 'value', fill: 'series' }))
							: Plot.barY(long, Plot.stackY({ x: 'x', y: 'value', fill: 'series' }))
					];
					catScale[isHoriz ? 'y' : 'x'] = { domain: catDomain };
				} else {
					marks = [
						isHoriz
							? Plot.barX(long, { fy: 'x', y: 'series', x: 'value', fill: 'series' })
							: Plot.barY(long, { fx: 'x', x: 'series', y: 'value', fill: 'series' })
					];
					catScale[isHoriz ? 'fy' : 'fx'] = { domain: catDomain };
				}
			}

			const valueScale = { label: valueLabel, tickFormat: fmtNum, grid: true };
			return (width, height) =>
				Plot.plot({
					width,
					height,
					style: PLOT_STYLE,
					color: { range: CHART_COLOR_RANGE },
					marginBottom: isHoriz ? 32 : 56,
					marginLeft: isHoriz ? 90 : 48,
					...(isHoriz ? { x: valueScale } : { y: valueScale }),
					...catScale,
					marks
				});
		}

		// ── Line / Area ──────────────────────────────────────────────────────
		if (t === 'line' || t === 'area') {
			const isArea = t === 'area';

			// ── Grouped by colorColumn ─────────────────────────────────────
			if (enableColorSplitLines && colorSplitLineGroups.length > 0) {
				const groups = colorSplitLineGroups;
				const colorCol = config.colorColumn as string;
				const yCol = config.yColumns[0];
				const data = rows
					.filter(
						(r) =>
							r[colorCol] != null && groups.includes(String(r[colorCol])) &&
							r[config.xColumn] != null && r[yCol] != null
					)
					.map((r) => ({ x: xValue(r[config.xColumn]), y: coerceNumber(r[yCol]), group: String(r[colorCol]) }));
				const stacked = isArea && areaSeriesLayout === 'stack';
				const lineMark = stacked
					? Plot.lineY(data, Plot.stackY({ x: 'x', y: 'y', stroke: 'group' }))
					: Plot.lineY(data, { x: 'x', y: 'y', stroke: 'group' });
				const marks: Plot.Markish[] = isArea
					? [
							stacked
								? Plot.areaY(data, Plot.stackY({ x: 'x', y: 'y', fill: 'group', fillOpacity: 0.2 }))
								: Plot.areaY(data, { x: 'x', y: 'y', fill: 'group', fillOpacity: 0.2 }),
							lineMark
						]
					: [lineMark];
				const xCategorical = !xIsMostlyDateLike && !xIsMostlyNumeric;
				const xDomain = xCategorical ? categoricalDomain(data.map((d) => d.x)) : undefined;
				return (width, height) =>
					Plot.plot({
						width,
						height,
						style: PLOT_STYLE,
						color: { type: 'ordinal', range: CHART_COLOR_RANGE },
						x: xDomain ? { domain: xDomain } : {},
						y: { tickFormat: fmtNum, grid: true },
						marks
					});
			}

			// ── Standard multi-series (+ secondary axis rescaled onto shared scale) ─
			const primary = seriesList;
			const secondary = secondarySeriesList;
			const primaryData = chartData.map((d) => ({ ...d, x: xValue(d.x) }));

			const rescaleMap: Record<string, (v: number) => number> = {};
			if (secondary.length > 0) {
				const primVals = primary.flatMap((s) =>
					primaryData.map((d) => toNumber((d as Record<string, unknown>)[s.key])).filter((v): v is number => v != null)
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

			const marks: Plot.Markish[] = [];
			for (const s of primary) {
				if (isArea) marks.push(Plot.areaY(primaryData, { x: 'x', y: s.key, fill: s.color, fillOpacity: 0.2 }));
				marks.push(
					Plot.lineY(primaryData, {
						x: 'x',
						y: s.key,
						stroke: s.color,
						title: (d: Record<string, unknown>) => `${s.label}: ${fmtNum(d[s.key])}`
					})
				);
			}
			for (const s of secondary) {
				const rescale = rescaleMap[s.key];
				const secondaryData = primaryData.map((d) => {
					const raw = toNumber((d as Record<string, unknown>)[s.key]);
					return { x: d.x, _orig: raw, _scaled: raw != null ? rescale(raw) : null };
				});
				marks.push(
					Plot.lineY(secondaryData, {
						x: 'x',
						y: '_scaled',
						stroke: s.color,
						strokeDasharray: '4,3',
						title: (d: { _orig: number | null }) => `${s.label}: ${d._orig != null ? fmtNum(d._orig) : '—'}`
					})
				);
			}

			const xCategorical = !xIsMostlyDateLike && !xIsMostlyNumeric;
			const xDomain = xCategorical ? categoricalDomain(primaryData.map((d) => d.x)) : undefined;
			return (width, height) =>
				Plot.plot({
					width,
					height,
					style: PLOT_STYLE,
					x: xDomain ? { domain: xDomain } : {},
					y: { tickFormat: fmtNum, grid: true },
					marks
				});
		}

		// ── Box-plot (3-mark composite: Plot.boxY can't accept pre-aggregated quantiles) ─
		if (t === 'box-plot') {
			const data = boxPlotData;
			const xDomain = categoricalDomain(data.map((d) => d.name));
			return (width, height) =>
				Plot.plot({
					width,
					height,
					style: PLOT_STYLE,
					x: { domain: xDomain },
					y: { tickFormat: fmtNum, grid: true },
					marginBottom: data.length > 6 ? 56 : 36,
					marks: [
						Plot.ruleX(data, { x: 'name', y1: 'min', y2: 'max', stroke: 'var(--muted-foreground)' }),
						Plot.barY(data, {
							x: 'name',
							y1: 'q1',
							y2: 'q3',
							fill: 'var(--chart-1)',
							fillOpacity: 0.6,
							title: (d: { name: string; min: number; q1: number; median: number; q3: number; max: number }) =>
								`${d.name}\nMax: ${fmtNum(d.max)}\nQ3: ${fmtNum(d.q3)}\nMedian: ${fmtNum(d.median)}\nQ1: ${fmtNum(d.q1)}\nMin: ${fmtNum(d.min)}`
						}),
						Plot.tickY(data, { x: 'name', y: 'median', stroke: 'var(--chart-1)', strokeWidth: 2 })
					]
				});
		}

		// ── Calendar heatmap ─────────────────────────────────────────────────
		if (t === 'calendar-heatmap') {
			const { pairs, years, minVal, maxVal } = calendarData;
			if (years.length === 0) return null;
			const cells = calendarCells(pairs);
			void mode.current; // re-resolve colors when the theme toggles
			const colorRange = [resolveCSSColor('--background'), resolveCSSColor('--chart-1')];
			return (width, height) =>
				Plot.plot({
					width,
					height,
					style: PLOT_STYLE,
					marginLeft: 28,
					fy: { domain: years },
					x: { axis: null },
					y: { domain: [0, 1, 2, 3, 4, 5, 6], tickFormat: (d: number) => DAY_LABELS[d] },
					color: { type: 'linear', domain: [minVal, maxVal], range: colorRange },
					marks: [
						Plot.cell(cells, {
							x: 'weekOfYear',
							y: 'day',
							fy: 'year',
							fill: 'value',
							title: (d: { dateStr: string; value: number }) => `${d.dateStr}: ${fmtNum(d.value)}`
						})
					]
				});
		}

		// ── Pie ──────────────────────────────────────────────────────────────
		if (t === 'pie') {
			const data = pieData;
			return (width, height) => renderPie(data, width, height);
		}

		// ── Funnel ───────────────────────────────────────────────────────────
		if (t === 'funnel') {
			const data = funnelData;
			return (width, height) => renderFunnel(data, width, height);
		}

		// ── Sankey ───────────────────────────────────────────────────────────
		if (t === 'sankey') {
			const nodes = sankeyNodes;
			const links = sankeyData;
			return (width, height) => renderSankey(nodes, links, width, height);
		}

		return null;
	});
</script>

<div class="w-full px-8 py-8 border bg-background rounded-md flex flex-col " style="height:{height}px">
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
	{:else if plotRender}
		<PlotChart render={plotRender} />
	{/if}
	</div>
</div>
