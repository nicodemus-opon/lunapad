<script lang="ts">
	import * as echarts from 'echarts';
	import { mode } from 'mode-watcher';

	interface Props {
		option: object;
	}

	let { option }: Props = $props();

	let el: HTMLDivElement | undefined = $state();
	let chart: echarts.ECharts | undefined;

	function resolveCSSVar(name: string): string {
		return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	}

	function oklchToRgb(l: number, c: number, h: number): string {
		const hRad = (h * Math.PI) / 180;
		const a = c * Math.cos(hRad);
		const b = c * Math.sin(hRad);
		const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
		const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
		const s_ = l - 0.0894841775 * a - 1.2914855480 * b;
		const ll = l_ ** 3, mm = m_ ** 3, ss = s_ ** 3;
		const lr = +4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss;
		const lg = -1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss;
		const lb = -0.0041960863 * ll - 0.7034186147 * mm + 1.7076147010 * ss;
		const gamma = (x: number) => {
			const v = Math.max(0, Math.min(1, x));
			return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
		};
		return `rgb(${Math.round(gamma(lr) * 255)},${Math.round(gamma(lg) * 255)},${Math.round(gamma(lb) * 255)})`;
	}

	function resolveCSSColor(varName: string): string {
		const raw = resolveCSSVar(varName);
		const m = raw.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
		if (m) return oklchToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
		return raw;
	}

	function buildThemeBase(): echarts.EChartsOption {
		const chartColors = [
			resolveCSSColor('--chart-1'),
			resolveCSSColor('--chart-2'),
			resolveCSSColor('--chart-3'),
			resolveCSSColor('--chart-4'),
			resolveCSSColor('--chart-5')
		];
		const borderColor = resolveCSSColor('--border');
		const mutedFg = resolveCSSColor('--muted-foreground');
		const popoverBg = resolveCSSColor('--popover');
		const popoverFg = resolveCSSColor('--popover-foreground');
		const chart1 = chartColors[0];

		return {
			color: chartColors,
			backgroundColor: 'transparent',
			textStyle: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11 },
			grid: { containLabel: true, top: 12, right: 16, bottom: 8, left: 8 },
			legend: {
				type: 'scroll',
				bottom: 2,
				textStyle: { color: mutedFg, fontSize: 11 },
				pageTextStyle: { color: mutedFg },
				inactiveColor: borderColor
			},
			tooltip: {
				confine: true,
				backgroundColor: popoverBg,
				borderColor: borderColor,
				textStyle: { color: popoverFg, fontSize: 12 },
				extraCssText: 'backdrop-filter:blur(6px);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);'
			},
			xAxis: {
				axisLine: { lineStyle: { color: borderColor } },
				axisTick: { lineStyle: { color: borderColor } },
				splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
				axisLabel: { color: mutedFg, fontSize: 11 }
			},
			yAxis: {
				axisLine: { show: false },
				axisTick: { show: false },
				splitLine: { lineStyle: { color: borderColor, opacity: 0.4 } },
				axisLabel: { color: mutedFg, fontSize: 11 }
			},
			visualMap: {
				inRange: { color: [resolveCSSColor('--background'), chart1] },
				textStyle: { color: mutedFg, fontSize: 10 },
				handleStyle: { color: chart1 }
			}
		};
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function deepMerge(base: Record<string, any>, overrides: Record<string, any>): Record<string, any> {
		const result = { ...base };
		for (const key of Object.keys(overrides)) {
			const bVal = base[key];
			const oVal = overrides[key];
			if (
				oVal !== null &&
				typeof oVal === 'object' &&
				!Array.isArray(oVal) &&
				bVal !== null &&
				typeof bVal === 'object' &&
				!Array.isArray(bVal)
			) {
				result[key] = deepMerge(bVal, oVal);
			} else {
				result[key] = oVal;
			}
		}
		return result;
	}

	$effect(() => {
		if (!el) return;
		const isDark = mode.current === 'dark';
		chart = echarts.init(el, isDark ? 'dark' : undefined, { renderer: 'canvas' });
		chart.setOption({ backgroundColor: 'transparent' });

		const ro = new ResizeObserver(() => chart?.resize());
		ro.observe(el);

		return () => {
			chart?.dispose();
			chart = undefined;
			ro.disconnect();
		};
	});

	$effect(() => {
		if (!chart) return;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const base = buildThemeBase() as Record<string, any>;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const opt = option as Record<string, any>;
		// visualMap applies to ALL series by default — only include it when the
		// chart option explicitly uses it (heatmaps), otherwise it overrides palette colors.
		if (!('visualMap' in opt)) delete base.visualMap;
		const merged = deepMerge(base, opt);
		chart.setOption(merged, { notMerge: true });
	});
</script>

<div bind:this={el} style="width:100%;height:100%"></div>
