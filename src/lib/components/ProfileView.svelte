<script lang="ts">
	import { onMount } from 'svelte';
	import { executeSQL } from '$lib/services/duckdb';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { BarChart2, AlertCircle } from '@lucide/svelte';
	import ColumnProfilePanel from '$lib/components/stats/ColumnProfilePanel.svelte';
	import {
		mapDuckDbProfile,
		computeDatasetOverview,
		type ColumnProfile,
		type DuckDbSummarizeRow
	} from '$lib/services/column-profile';

	interface Props {
		tableName: string;
	}

	const { tableName }: Props = $props();

	interface FreqRow {
		val: string | null;
		cnt: number;
	}

	let totalRows = $state<number>(0);
	let profiles = $state<ColumnProfile[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	function colCategory(type: string): 'numeric' | 'text' | 'bool' | 'temporal' | 'other' {
		const t = type.toUpperCase();
		if (
			t.includes('INT') ||
			t.includes('FLOAT') ||
			t.includes('DOUBLE') ||
			t.includes('DECIMAL') ||
			t.includes('NUMERIC') ||
			t.includes('REAL') ||
			t.includes('HUGEINT') ||
			t.includes('UBIGINT')
		) {
			return 'numeric';
		}
		if (t.includes('BOOL')) return 'bool';
		if (t.startsWith('DATE') || t.includes('TIMESTAMP') || t.includes('TIME')) return 'temporal';
		if (
			t.includes('VARCHAR') ||
			t.includes('TEXT') ||
			t.includes('CHAR') ||
			t.includes('STRING') ||
			t.includes('BLOB')
		) {
			return 'text';
		}
		return 'other';
	}

	onMount(async () => {
		try {
			const summarizeResult = await executeSQL(`SUMMARIZE "${tableName}"`);
			const summarizeRows = summarizeResult.rows as unknown as DuckDbSummarizeRow[];

			const countResult = await executeSQL(`SELECT COUNT(*) AS n FROM "${tableName}"`);
			totalRows = Number(countResult.rows[0]?.n ?? 0);

			const mapped = await Promise.all(
				summarizeRows.map(async (s): Promise<ColumnProfile> => {
					const cat = colCategory(s.column_type);
					const colExpr = `"${s.column_name}"`;

					const freqPromise = executeSQL(
						`SELECT ${colExpr}::VARCHAR AS val, COUNT(*) AS cnt ` +
							`FROM "${tableName}" GROUP BY ${colExpr} ORDER BY cnt DESC LIMIT 10`
					)
						.then((r) => r.rows as unknown as FreqRow[])
						.catch(() => [] as FreqRow[]);

					let skewKurtPromise: Promise<{ skew: number | null; kurt: number | null }> =
						Promise.resolve({ skew: null, kurt: null });
					let textStatsPromise: Promise<{
						avgLen: number | null;
						minLen: number | null;
						maxLen: number | null;
						emptyCount: number | null;
					}> = Promise.resolve({ avgLen: null, minLen: null, maxLen: null, emptyCount: null });

					if (cat === 'numeric') {
						skewKurtPromise = executeSQL(
							`SELECT skewness(${colExpr}) AS skew, kurtosis(${colExpr}) AS kurt FROM "${tableName}"`
						)
							.then((r) => {
								const row = r.rows[0] as Record<string, unknown> | undefined;
								return {
									skew: row?.skew != null ? Number(row.skew) : null,
									kurt: row?.kurt != null ? Number(row.kurt) : null
								};
							})
							.catch(() => ({ skew: null, kurt: null }));
					}

					if (cat === 'text') {
						textStatsPromise = executeSQL(
							`SELECT AVG(LENGTH(${colExpr})) AS avg_len, MIN(LENGTH(${colExpr})) AS min_len, ` +
								`MAX(LENGTH(${colExpr})) AS max_len, ` +
								`SUM(CASE WHEN ${colExpr} = '' THEN 1 ELSE 0 END) AS empty_count ` +
								`FROM "${tableName}"`
						)
							.then((r) => {
								const row = r.rows[0] as Record<string, unknown> | undefined;
								return {
									avgLen: row?.avg_len != null ? Number(row.avg_len) : null,
									minLen: row?.min_len != null ? Number(row.min_len) : null,
									maxLen: row?.max_len != null ? Number(row.max_len) : null,
									emptyCount: row?.empty_count != null ? Number(row.empty_count) : null
								};
							})
							.catch(() => ({
								avgLen: null,
								minLen: null,
								maxLen: null,
								emptyCount: null
							}));
					}

					const [topValues, skewKurt, textStats] = await Promise.all([
						freqPromise,
						skewKurtPromise,
						textStatsPromise
					]);

					return mapDuckDbProfile(s, {
						totalRows,
						topValues,
						skew: skewKurt.skew,
						kurt: skewKurt.kurt,
						avgLen: textStats.avgLen,
						minLen: textStats.minLen,
						maxLen: textStats.maxLen,
						emptyCount: textStats.emptyCount
					});
				})
			);

			profiles = mapped;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			loading = false;
		}
	});

	const overview = $derived(computeDatasetOverview(profiles, { rowCount: totalRows }));
</script>

<div class="flex flex-col gap-4">
	<div class="flex items-center gap-2">
		<BarChart2 class="h-4 w-4 text-primary" />
		<h2 class="font-mono text-sm font-semibold">{tableName}</h2>
		<span class="text-xs text-muted-foreground">profile</span>
	</div>

	{#if loading}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
		<div
			class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
		>
			<AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
			<span class="font-mono text-xs">{error}</span>
		</div>
	{:else}
		<ColumnProfilePanel {profiles} {overview} mode="full" fillHeight={false} />
	{/if}
</div>
