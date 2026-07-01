<script lang="ts">
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { coerceNumber } from '$lib/utils';

	interface Props {
		rows: Record<string, unknown>[];
		columns: string[];
		name?: string;
	}

	const { rows, columns, name = 'result' }: Props = $props();

	type ColumnProfile = {
		column: string;
		nonNull: number;
		nullCount: number;
		nullPct: number;
		unique: number;
		uniquePct: number;
		numericCount: number;
		min: number | null;
		p25: number | null;
		median: number | null;
		p75: number | null;
		max: number | null;
		mean: number | null;
		stddev: number | null;
		sum: number | null;
		sample: string;
	};

	function quantile(sorted: number[], q: number): number | null {
		if (sorted.length === 0) return null;
		if (sorted.length === 1) return sorted[0];
		const pos = (sorted.length - 1) * q;
		const base = Math.floor(pos);
		const rest = pos - base;
		const next = sorted[base + 1] ?? sorted[base];
		return sorted[base] + rest * (next - sorted[base]);
	}

	function mean(values: number[]): number | null {
		if (values.length === 0) return null;
		return values.reduce((acc, n) => acc + n, 0) / values.length;
	}

	function stddev(values: number[]): number | null {
		if (values.length < 2) return null;
		const m = mean(values)!;
		const variance = values.reduce((acc, n) => acc + (n - m) ** 2, 0) / (values.length - 1);
		return Math.sqrt(variance);
	}

	function fmt(value: number | null, digits = 2): string {
		if (value === null || !Number.isFinite(value)) return '—';
		return value.toLocaleString(undefined, {
			minimumFractionDigits: 0,
			maximumFractionDigits: digits
		});
	}

	const profiles = $derived.by((): ColumnProfile[] => {
		const totalRows = rows.length;
		return columns.map((column) => {
			const values = rows.map((r) => r[column]);
			const nonNullValues = values.filter((v) => v !== null && v !== undefined);
			const nullCount = totalRows - nonNullValues.length;
			const unique = new Set(nonNullValues.map((v) => String(v))).size;
			const numericValues = nonNullValues
				.map((v) => coerceNumber(v))
				.filter((v): v is number => v !== null)
				.sort((a, b) => a - b);
			const sample = nonNullValues
				.slice(0, 3)
				.map((v) => String(v))
				.join(', ');

			return {
				column,
				nonNull: nonNullValues.length,
				nullCount,
				nullPct: totalRows === 0 ? 0 : (nullCount / totalRows) * 100,
				unique,
				uniquePct: totalRows === 0 ? 0 : (unique / totalRows) * 100,
				numericCount: numericValues.length,
				min: numericValues[0] ?? null,
				p25: quantile(numericValues, 0.25),
				median: quantile(numericValues, 0.5),
				p75: quantile(numericValues, 0.75),
				max: numericValues[numericValues.length - 1] ?? null,
				mean: mean(numericValues),
				stddev: stddev(numericValues),
				sum: numericValues.length > 0 ? numericValues.reduce((acc, n) => acc + n, 0) : null,
				sample: sample || '—'
			};
		});
	});

	const numericColumns = $derived(profiles.filter((p) => p.numericCount > 0).length);
	const totalNulls = $derived(profiles.reduce((acc, p) => acc + p.nullCount, 0));
</script>

<div class="space-y-3">
	<div class="grid grid-cols-2 gap-2 md:grid-cols-4">
		<div class="rounded-md border bg-card px-3 py-2">
			<div class="text-[11px] tracking-wide text-muted-foreground uppercase">Dataset</div>
			<div class="mt-1 text-sm font-semibold">{name}</div>
		</div>
		<div class="rounded-md border bg-card px-3 py-2">
			<div class="text-[11px] tracking-wide text-muted-foreground uppercase">Rows</div>
			<div class="mt-1 text-sm font-semibold">{rows.length.toLocaleString()}</div>
		</div>
		<div class="rounded-md border bg-card px-3 py-2">
			<div class="text-[11px] tracking-wide text-muted-foreground uppercase">Columns</div>
			<div class="mt-1 text-sm font-semibold">{columns.length}</div>
		</div>
		<div class="rounded-md border bg-card px-3 py-2">
			<div class="text-[11px] tracking-wide text-muted-foreground uppercase">Numeric Columns</div>
			<div class="mt-1 text-sm font-semibold">{numericColumns}</div>
		</div>
	</div>

	<div class="rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
		Null values across all columns: <span class="font-medium text-foreground"
			>{totalNulls.toLocaleString()}</span
		>
	</div>

	<div class="overflow-auto rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="min-w-44">Column</Table.Head>
					<Table.Head>Completeness</Table.Head>
					<Table.Head>Cardinality</Table.Head>
					<Table.Head>Distribution</Table.Head>
					<Table.Head>Range</Table.Head>
					<Table.Head>Moments</Table.Head>
					<Table.Head>Sample</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each profiles as p (p.column)}
					<Table.Row>
						<Table.Cell>
							<div class="font-mono text-xs">{p.column}</div>
							<div class="mt-1">
								<Badge variant={p.numericCount > 0 ? 'secondary' : 'outline'}>
									{p.numericCount > 0 ? 'numeric' : 'categorical'}
								</Badge>
							</div>
						</Table.Cell>
						<Table.Cell class="text-xs">
							<div>non-null: {p.nonNull.toLocaleString()}</div>
							<div class="text-muted-foreground">
								null: {p.nullCount.toLocaleString()} ({p.nullPct.toFixed(1)}%)
							</div>
						</Table.Cell>
						<Table.Cell class="text-xs">
							<div>unique: {p.unique.toLocaleString()}</div>
							<div class="text-muted-foreground">{p.uniquePct.toFixed(1)}% of rows</div>
						</Table.Cell>
						<Table.Cell class="text-xs">
							<div>q25: {fmt(p.p25)}</div>
							<div>median: {fmt(p.median)}</div>
							<div>q75: {fmt(p.p75)}</div>
						</Table.Cell>
						<Table.Cell class="text-xs">
							<div>min: {fmt(p.min)}</div>
							<div>max: {fmt(p.max)}</div>
							<div>sum: {fmt(p.sum)}</div>
						</Table.Cell>
						<Table.Cell class="text-xs">
							<div>mean: {fmt(p.mean)}</div>
							<div>stddev: {fmt(p.stddev)}</div>
							<div class="text-muted-foreground">
								numeric values: {p.numericCount.toLocaleString()}
							</div>
						</Table.Cell>
						<Table.Cell class="max-w-80 truncate text-xs text-muted-foreground" title={p.sample}>
							{p.sample}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>
