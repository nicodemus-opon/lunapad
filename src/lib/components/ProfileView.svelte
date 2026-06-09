<script lang="ts">
	import { onMount } from 'svelte';
	import { executeSQL } from '$lib/services/duckdb';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Separator } from '$lib/components/ui/separator';
	import {
		BarChart2,
		AlertCircle,
		Hash,
		Type,
		ToggleLeft,
		Calendar,
		Clock,
		List,
		Braces,
		Binary
	} from '@lucide/svelte';

	interface Props {
		tableName: string;
	}

	const { tableName }: Props = $props();

	// ── Types ───────────────────────────────────────────────────────────────
	interface SummarizeRow {
		column_name: string;
		column_type: string;
		min: string | null;
		max: string | null;
		approx_unique: number | null;
		avg: string | null;
		std: string | null;
		q25: string | null;
		q50: string | null;
		q75: string | null;
		count: number | null;
		null_percentage: string | null;
	}

	interface FreqRow {
		val: string | null;
		cnt: number;
	}

	interface ColumnProfile {
		summarize: SummarizeRow;
		topValues: FreqRow[];
		skew?: number | null;
		kurt?: number | null;
		avgLen?: number | null;
		minLen?: number | null;
		maxLen?: number | null;
		emptyCount?: number | null;
	}

	// ── State ───────────────────────────────────────────────────────────────
	let totalRows = $state<number>(0);
	let columnProfiles = $state<ColumnProfile[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// ── Helpers ──────────────────────────────────────────────────────────────
	function colCategory(type: string): 'numeric' | 'text' | 'bool' | 'temporal' | 'other' {
		const t = type.toUpperCase();
		if (
			t.includes('INT') || t.includes('FLOAT') || t.includes('DOUBLE') ||
			t.includes('DECIMAL') || t.includes('NUMERIC') || t.includes('REAL') ||
			t.includes('HUGEINT') || t.includes('UBIGINT')
		) return 'numeric';
		if (t.includes('BOOL')) return 'bool';
		if (t.startsWith('DATE') || t.includes('TIMESTAMP') || t.includes('TIME')) return 'temporal';
		if (
			t.includes('VARCHAR') || t.includes('TEXT') || t.includes('CHAR') ||
			t.includes('STRING') || t.includes('BLOB')
		) return 'text';
		return 'other';
	}

	function fmtNum(v: string | number | null, decimals = 2): string {
		if (v === null || v === undefined) return '—';
		const n = typeof v === 'string' ? parseFloat(v) : v;
		if (isNaN(n)) return '—';
		return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
	}

	function nullPct(s: SummarizeRow): number {
		if (!s.null_percentage) return 0;
		return Math.min(100, Math.max(0, parseFloat(s.null_percentage)));
	}

	function completeness(s: SummarizeRow): number {
		return 100 - nullPct(s);
	}

	function distinctPct(s: SummarizeRow, total: number): number {
		if (!total || !s.approx_unique) return 0;
		return Math.min(100, (s.approx_unique / total) * 100);
	}

	function colTypeIcon(type: string) {
		const t = type.toUpperCase();
		if (t.includes('INT') || t.includes('FLOAT') || t.includes('DOUBLE') || t.includes('DECIMAL') || t.includes('NUMERIC') || t.includes('REAL')) return Hash;
		if (t.includes('BOOL')) return ToggleLeft;
		if (t.startsWith('DATE')) return Calendar;
		if (t.includes('TIMESTAMP') || t.includes('TIME')) return Clock;
		if (t.includes('VARCHAR') || t.includes('TEXT') || t.includes('CHAR') || t.includes('STRING') || t.includes('BLOB')) return Type;
		if (t.includes('LIST') || t.includes('ARRAY')) return List;
		if (t.includes('STRUCT') || t.includes('JSON') || t.includes('MAP')) return Braces;
		if (t.includes('BINARY') || t.includes('BIT')) return Binary;
		return Type;
	}

	function categoryColor(cat: ReturnType<typeof colCategory>): string {
		switch (cat) {
			case 'numeric': return 'bg-[var(--chart-3)]/15 text-[var(--chart-3)]';
			case 'text': return 'bg-[var(--chart-1)]/15 text-[var(--chart-1)]';
			case 'bool': return 'bg-[var(--chart-4)]/15 text-[var(--chart-4)]';
			case 'temporal': return 'bg-[var(--chart-2)]/15 text-[var(--chart-2)]';
			default: return 'bg-muted text-muted-foreground';
		}
	}

	function safeDateRange(min: string | null, max: string | null): string {
		if (!min || !max) return '—';
		try {
			const d1 = new Date(min);
			const d2 = new Date(max);
			const days = Math.round(Math.abs(d2.getTime() - d1.getTime()) / 86400000);
			return `${days.toLocaleString()} days`;
		} catch {
			return '—';
		}
	}

	// ── Fetch ────────────────────────────────────────────────────────────────
	onMount(async () => {
		try {
			// Stage 1: summarize
			const summarizeResult = await executeSQL(`SUMMARIZE "${tableName}"`);
			const summarizeRows = summarizeResult.rows as unknown as SummarizeRow[];

			// Also get exact total row count
			const countResult = await executeSQL(`SELECT COUNT(*) AS n FROM "${tableName}"`);
			totalRows = Number(countResult.rows[0]?.n ?? 0);

			// Stage 2: per-column follow-up queries in parallel
			const profiles = await Promise.all(
				summarizeRows.map(async (s): Promise<ColumnProfile> => {
					const cat = colCategory(s.column_type);
					const colExpr = `"${s.column_name}"`;

					// Always: top-10 values
					const freqPromise = executeSQL(
						`SELECT ${colExpr}::VARCHAR AS val, COUNT(*) AS cnt ` +
						`FROM "${tableName}" GROUP BY ${colExpr} ORDER BY cnt DESC LIMIT 10`
					).then(r => r.rows as unknown as FreqRow[]).catch(() => [] as FreqRow[]);

					let skewKurtPromise: Promise<{ skew: number | null; kurt: number | null }> =
						Promise.resolve({ skew: null, kurt: null });
					let textStatsPromise: Promise<{ avgLen: number | null; minLen: number | null; maxLen: number | null; emptyCount: number | null }> =
						Promise.resolve({ avgLen: null, minLen: null, maxLen: null, emptyCount: null });

					if (cat === 'numeric') {
						skewKurtPromise = executeSQL(
							`SELECT skewness(${colExpr}) AS skew, kurtosis(${colExpr}) AS kurt FROM "${tableName}"`
						).then(r => {
							const row = r.rows[0] as Record<string, unknown> | undefined;
							return {
								skew: row?.skew != null ? Number(row.skew) : null,
								kurt: row?.kurt != null ? Number(row.kurt) : null
							};
						}).catch(() => ({ skew: null, kurt: null }));
					}

					if (cat === 'text') {
						textStatsPromise = executeSQL(
							`SELECT AVG(LENGTH(${colExpr})) AS avg_len, MIN(LENGTH(${colExpr})) AS min_len, ` +
							`MAX(LENGTH(${colExpr})) AS max_len, ` +
							`SUM(CASE WHEN ${colExpr} = '' THEN 1 ELSE 0 END) AS empty_count ` +
							`FROM "${tableName}"`
						).then(r => {
							const row = r.rows[0] as Record<string, unknown> | undefined;
							return {
								avgLen: row?.avg_len != null ? Number(row.avg_len) : null,
								minLen: row?.min_len != null ? Number(row.min_len) : null,
								maxLen: row?.max_len != null ? Number(row.max_len) : null,
								emptyCount: row?.empty_count != null ? Number(row.empty_count) : null
							};
						}).catch(() => ({ avgLen: null, minLen: null, maxLen: null, emptyCount: null }));
					}

					const [topValues, skewKurt, textStats] = await Promise.all([
						freqPromise, skewKurtPromise, textStatsPromise
					]);

					return {
						summarize: s,
						topValues,
						skew: skewKurt.skew,
						kurt: skewKurt.kurt,
						avgLen: textStats.avgLen,
						minLen: textStats.minLen,
						maxLen: textStats.maxLen,
						emptyCount: textStats.emptyCount
					};
				})
			);

			columnProfiles = profiles;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	});

	// ── Derived overview stats ────────────────────────────────────────────────
	const overviewStats = $derived.by(() => {
		if (!columnProfiles.length) return null;
		const colCount = columnProfiles.length;
		const totalCells = totalRows * colCount;
		const totalMissing = columnProfiles.reduce((sum, p) => {
			return sum + Math.round(nullPct(p.summarize) / 100 * totalRows);
		}, 0);
		const avgCompleteness =
			columnProfiles.reduce((sum, p) => sum + completeness(p.summarize), 0) / colCount;
		return { colCount, totalCells, totalMissing, avgCompleteness };
	});
</script>

<div class="flex flex-col gap-6">
	<!-- Page header -->
	<div class="flex items-center gap-2">
		<BarChart2 class="w-4 h-4 text-primary" />
		<h2 class="text-sm font-semibold font-mono">{tableName}</h2>
		<span class="text-xs text-muted-foreground">— Profile Report</span>
	</div>

	{#if loading}
		<!-- Loading skeleton -->
		<div class="grid grid-cols-4 gap-3">
			{#each Array.from({ length: 4 }) as _, index (index)}
				<Skeleton class="h-16 rounded-lg" />
			{/each}
		</div>
		<div class="space-y-3">
			{#each Array.from({ length: 3 }) as _, index (index)}
				<Skeleton class="h-48 rounded-lg" />
			{/each}
		</div>

	{:else if error}
		<div class="flex items-start gap-2 text-destructive text-sm border border-destructive/30 rounded-md px-3 py-2 bg-destructive/5">
			<AlertCircle class="w-4 h-4 mt-0.5 shrink-0" />
			<span class="font-mono text-xs">{error}</span>
		</div>

	{:else}
		{@const ov = overviewStats}

		<!-- Overview cards -->
		{#if ov}
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<div class="border rounded-lg px-4 py-3 bg-card">
					<p class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Rows</p>
					<p class="text-xl font-semibold tabular-nums">{totalRows.toLocaleString()}</p>
				</div>
				<div class="border rounded-lg px-4 py-3 bg-card">
					<p class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Columns</p>
					<p class="text-xl font-semibold tabular-nums">{ov.colCount}</p>
				</div>
				<div class="border rounded-lg px-4 py-3 bg-card">
					<p class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Missing cells</p>
					<p class="text-xl font-semibold tabular-nums">{ov.totalMissing.toLocaleString()}</p>
					<p class="text-[10px] text-muted-foreground tabular-nums">
						{ov.totalCells ? fmtNum((ov.totalMissing / ov.totalCells) * 100, 1) : 0}% of {ov.totalCells.toLocaleString()}
					</p>
				</div>
				<div class="border rounded-lg px-4 py-3 bg-card">
					<p class="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Avg completeness</p>
					<p class="text-xl font-semibold tabular-nums">{fmtNum(ov.avgCompleteness, 1)}%</p>
					<!-- completeness bar -->
					<div class="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
						<div
						class="h-full rounded-full bg-chart-1 transition-all"
							style="width: {ov.avgCompleteness}%"
						></div>
					</div>
				</div>
			</div>
		{/if}

		<Separator />

		<!-- Per-column cards -->
		<div class="space-y-4">
			{#each columnProfiles as profile (profile.summarize.column_name)}
				{@const s = profile.summarize}
				{@const cat = colCategory(s.column_type)}
				{@const Icon = colTypeIcon(s.column_type)}
				{@const nullP = nullPct(s)}
				{@const compP = completeness(s)}
				{@const distP = distinctPct(s, totalRows)}
				{@const missingCount = Math.round(nullP / 100 * totalRows)}
				{@const maxFreq = profile.topValues[0]?.cnt ?? 1}

				<div class="border rounded-lg bg-card overflow-hidden">
					<!-- Column header -->
					<div class="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
						<Icon class="w-3.5 h-3.5 text-muted-foreground shrink-0" />
						<span class="text-sm font-mono font-medium">{s.column_name}</span>
						<span class="text-[10px] px-1.5 py-0.5 rounded font-medium {categoryColor(cat)}">
							{s.column_type.toLowerCase().split('(')[0]}
						</span>
					</div>

					<div class="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x">
						<!-- Left: core stats -->
						<div class="px-4 py-3 space-y-3">

							<!-- Completeness bar -->
							<div>
								<div class="flex items-center justify-between text-[11px] mb-1">
									<span class="text-muted-foreground">Completeness</span>
									<span class="font-medium tabular-nums">{fmtNum(compP, 1)}%</span>
								</div>
								<div class="h-2 rounded-full bg-muted overflow-hidden">
									<div class="h-full rounded-full bg-chart-1" style="width: {compP}%"></div>
								</div>
								{#if missingCount > 0}
									<p class="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
										{missingCount.toLocaleString()} missing ({fmtNum(nullP, 1)}%)
									</p>
								{:else}
									<p class="text-[10px] text-chart-1 mt-0.5">No missing values</p>
								{/if}
							</div>

							<!-- Distinct -->
							<div>
								<div class="flex items-center justify-between text-[11px] mb-1">
									<span class="text-muted-foreground">Distinct</span>
									<span class="font-medium tabular-nums">
										{s.approx_unique?.toLocaleString() ?? '—'}
										<span class="text-muted-foreground font-normal">
											({fmtNum(distP, 1)}%)
										</span>
									</span>
								</div>
								<div class="h-2 rounded-full bg-muted overflow-hidden">
									<div class="h-full rounded-full bg-chart-3" style="width: {distP}%"></div>
								</div>
							</div>

							<!-- Type-specific stats -->
							{#if cat === 'numeric'}
								<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
									<div class="flex justify-between">
										<span class="text-muted-foreground">Min</span>
										<span class="font-mono tabular-nums">{fmtNum(s.min)}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Max</span>
										<span class="font-mono tabular-nums">{fmtNum(s.max)}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Mean</span>
										<span class="font-mono tabular-nums">{fmtNum(s.avg)}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Median</span>
										<span class="font-mono tabular-nums">{fmtNum(s.q50)}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Std dev</span>
										<span class="font-mono tabular-nums">{fmtNum(s.std)}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">IQR</span>
										<span class="font-mono tabular-nums">
											{#if s.q25 != null && s.q75 != null}
												{fmtNum(parseFloat(s.q75) - parseFloat(s.q25))}
											{:else}—{/if}
										</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Q25</span>
										<span class="font-mono tabular-nums">{fmtNum(s.q25)}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Q75</span>
										<span class="font-mono tabular-nums">{fmtNum(s.q75)}</span>
									</div>
									{#if profile.skew != null}
										<div class="flex justify-between">
											<span class="text-muted-foreground">Skewness</span>
											<span class="font-mono tabular-nums">{fmtNum(profile.skew, 3)}</span>
										</div>
									{/if}
									{#if profile.kurt != null}
										<div class="flex justify-between">
											<span class="text-muted-foreground">Kurtosis</span>
											<span class="font-mono tabular-nums">{fmtNum(profile.kurt, 3)}</span>
										</div>
									{/if}
								</div>

								<!-- SVG box-plot strip -->
								{#if s.min != null && s.max != null && s.q25 != null && s.q50 != null && s.q75 != null}
									{@const minV = parseFloat(s.min)}
									{@const maxV = parseFloat(s.max)}
									{@const range = maxV - minV || 1}
									{@const q25x = ((parseFloat(s.q25) - minV) / range) * 100}
									{@const q50x = ((parseFloat(s.q50) - minV) / range) * 100}
									{@const q75x = ((parseFloat(s.q75) - minV) / range) * 100}
									<div class="mt-2">
										<p class="text-[10px] text-muted-foreground mb-1">Distribution (box plot)</p>
										<svg class="w-full h-8" viewBox="0 0 100 16" preserveAspectRatio="none">
											<!-- Full range line -->
											<line x1="2" y1="8" x2="98" y2="8" stroke="currentColor" stroke-width="1" class="text-muted-foreground/40" />
											<!-- IQR box -->
											<rect
												x={q25x}
												y="4"
												width={q75x - q25x}
												height="8"
												fill="hsl(var(--primary) / 0.25)"
												stroke="hsl(var(--primary))"
												stroke-width="0.8"
											/>
											<!-- Median line -->
											<line
												x1={q50x} y1="3"
												x2={q50x} y2="13"
												stroke="hsl(var(--primary))"
												stroke-width="1.5"
											/>
											<!-- Min/max ticks -->
											<line x1="2" y1="5" x2="2" y2="11" stroke="currentColor" stroke-width="1" class="text-muted-foreground/60" />
											<line x1="98" y1="5" x2="98" y2="11" stroke="currentColor" stroke-width="1" class="text-muted-foreground/60" />
										</svg>
										<div class="flex justify-between text-[10px] text-muted-foreground font-mono tabular-nums -mt-0.5">
											<span>{fmtNum(s.min)}</span>
											<span>{fmtNum(s.max)}</span>
										</div>
									</div>
								{/if}

							{:else if cat === 'text'}
								<div class="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
									<div class="flex justify-between">
										<span class="text-muted-foreground">Avg length</span>
										<span class="font-mono tabular-nums">{fmtNum(profile.avgLen ?? null, 1)}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Min length</span>
										<span class="font-mono tabular-nums">{fmtNum(profile.minLen ?? null, 0)}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Max length</span>
										<span class="font-mono tabular-nums">{fmtNum(profile.maxLen ?? null, 0)}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Empty strings</span>
										<span class="font-mono tabular-nums">{profile.emptyCount?.toLocaleString() ?? '—'}</span>
									</div>
								</div>

							{:else if cat === 'bool'}
								{@const trueRow = profile.topValues.find(v => v.val?.toLowerCase() === 'true')}
								{@const falseRow = profile.topValues.find(v => v.val?.toLowerCase() === 'false')}
								{@const trueCount = trueRow?.cnt ?? 0}
								{@const falseCount = falseRow?.cnt ?? 0}
								{@const total = trueCount + falseCount || 1}
								{@const truePct = (trueCount / total) * 100}
								<div class="space-y-1.5 text-[11px]">
									<div class="flex items-center gap-2">
							<span class="text-chart-1 w-10">True</span>
							<div class="flex-1 h-3 rounded bg-muted overflow-hidden">
								<div class="h-full rounded bg-chart-1" style="width: {truePct}%"></div>
										</div>
										<span class="font-mono tabular-nums w-12 text-right">{trueCount.toLocaleString()} ({fmtNum(truePct, 1)}%)</span>
									</div>
									<div class="flex items-center gap-2">
							<span class="text-destructive w-10">False</span>
							<div class="flex-1 h-3 rounded bg-muted overflow-hidden">
								<div class="h-full rounded bg-destructive/60" style="width: {100 - truePct}%"></div>
										</div>
										<span class="font-mono tabular-nums w-12 text-right">{falseCount.toLocaleString()} ({fmtNum(100 - truePct, 1)}%)</span>
									</div>
								</div>

							{:else if cat === 'temporal'}
								<div class="grid grid-cols-1 gap-y-1 text-[11px]">
									<div class="flex justify-between">
										<span class="text-muted-foreground">Min</span>
										<span class="font-mono">{s.min ?? '—'}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Max</span>
										<span class="font-mono">{s.max ?? '—'}</span>
									</div>
									<div class="flex justify-between">
										<span class="text-muted-foreground">Range</span>
										<span class="font-mono">{safeDateRange(s.min, s.max)}</span>
									</div>
								</div>
							{/if}
						</div>

						<!-- Right: top-10 value frequencies -->
						<div class="px-4 py-3">
							<p class="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
								Top values
							</p>
							{#if profile.topValues.length === 0}
								<p class="text-[11px] text-muted-foreground italic">No data</p>
							{:else}
								<div class="space-y-1">
									{#each profile.topValues as row (`${row.val ?? 'null'}-${row.cnt}`)}
										{@const pct = maxFreq > 0 ? (row.cnt / maxFreq) * 100 : 0}
										{@const rowPct = totalRows > 0 ? (row.cnt / totalRows) * 100 : 0}
										<div class="flex items-center gap-2 text-[11px]">
											<span class="font-mono truncate w-3/4 shrink-0 text-foreground/80" title={row.val ?? ''}>
											{#if row.val != null}{row.val}{:else}<em class="text-muted-foreground">null</em>{/if}
										</span>
											<div class="flex-1 h-3 rounded bg-muted overflow-hidden min-w-0">
												<div class="h-full rounded bg-primary/50" style="width: {pct}%"></div>
											</div>
											<span class="tabular-nums text-muted-foreground w-16 text-right shrink-0">
												{row.cnt.toLocaleString()} ({fmtNum(rowPct, 1)}%)
											</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
