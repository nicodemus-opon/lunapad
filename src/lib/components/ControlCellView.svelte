<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Badge } from '$lib/components/ui/badge';
	import * as Popover from '$lib/components/ui/popover';
	import NativeSelect from '$lib/components/ui/native-select/native-select.svelte';
	import {
		Bot,
		CalendarDays,
		CheckSquare,
		Download,
		FileUp,
		Map as MapIcon,
		Play,
		Settings2,
		Table2,
		TextCursorInput,
		ToggleLeft
	} from '@lucide/svelte';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import {
		updateControlCellConfig,
		updateControlCellValue,
		updateControlTableData,
		runAll,
		runAllStale
	} from '$lib/stores/notebook.svelte';
	import type { ControlCellConfig, ControlOption } from '$lib/services/control-cells';

	interface Props {
		cell: Cell;
		sourceRows?: Record<string, unknown>[];
		sourceColumns?: string[];
		reportView?: boolean;
	}

	const { cell, sourceRows = [], sourceColumns = [], reportView = false }: Props = $props();

	const config = $derived(cell.controlConfig!);
	let optionDraft = $state('');
	let tableDraft = $state('');
	let tableDraftError = $state<string | null>(null);
	let tableFilter = $state('');

	const numericColumns = $derived(
		sourceColumns.filter((col) => sourceRows.some((row) => typeof row[col] === 'number'))
	);
	const displayColumns = $derived.by(() => {
		const configured = config.source.columns?.filter((c) => sourceColumns.includes(c)) ?? [];
		return configured.length ? configured : sourceColumns.slice(0, 8);
	});
	const filteredRows = $derived.by(() => {
		const rows = sourceRows.length ? sourceRows : (config.tableData?.rows ?? []);
		if (!tableFilter.trim()) return rows.slice(0, 50);
		const q = tableFilter.toLowerCase();
		return rows
			.filter((row) =>
				Object.values(row).some((v) =>
					String(v ?? '')
						.toLowerCase()
						.includes(q)
				)
			)
			.slice(0, 50);
	});
	const activeColumns = $derived.by(() =>
		sourceRows.length ? displayColumns : (config.tableData?.columns ?? [])
	);
	const singleValue = $derived.by(() => {
		const col = config.source.columns?.[0] ?? numericColumns[0] ?? sourceColumns[0];
		if (!col) return null;
		const values = sourceRows
			.map((row) => row[col])
			.filter((v) => typeof v === 'number') as number[];
		if (!values.length) return sourceRows[0]?.[col] ?? null;
		return values.reduce((sum, value) => sum + value, 0);
	});
	const pivotRows = $derived.by(() => buildPivotRows(sourceRows, config, sourceColumns));
	const Icon = $derived(iconName());
	const mapRows = $derived.by(() => {
		const lat = config.source.columns?.[0] ?? findColumn(/lat|latitude/i);
		const lon = config.source.columns?.[1] ?? findColumn(/lon|lng|long|longitude/i);
		if (!lat || !lon) return [];
		return sourceRows
			.map((row) => ({
				lat: Number(row[lat]),
				lon: Number(row[lon]),
				label: String(row[sourceColumns[0]] ?? '')
			}))
			.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon))
			.slice(0, 20);
	});

	$effect(() => {
		tableDraft = JSON.stringify(config.tableData?.rows ?? [], null, 2);
		optionDraft = config.options.map((o) => `${o.label}:${o.value}`).join('\n');
	});

	function patchConfig(patch: Partial<ControlCellConfig>) {
		updateControlCellConfig(cell.id, patch);
	}

	function setValue(value: unknown) {
		updateControlCellValue(cell.id, value);
	}

	function parseOptions(): ControlOption[] {
		return optionDraft
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [label, ...rest] = line.split(':');
				const value = rest.join(':').trim() || label.trim();
				return { label: label.trim() || value, value };
			});
	}

	function applyTableDraft() {
		try {
			const rows = JSON.parse(tableDraft) as unknown;
			if (!Array.isArray(rows)) throw new Error('Use a JSON array of row objects.');
			const cleanRows = rows.filter(
				(row): row is Record<string, unknown> =>
					Boolean(row) && typeof row === 'object' && !Array.isArray(row)
			);
			const cols = [...new Set(cleanRows.flatMap((row) => Object.keys(row)))];
			updateControlTableData(cell.id, {
				rows: cleanRows,
				columns: cols.length ? cols : ['key', 'value']
			});
			tableDraftError = null;
		} catch (error) {
			tableDraftError = error instanceof Error ? error.message : 'Invalid JSON';
		}
	}

	function downloadCsv() {
		const rows = filteredRows;
		const cols = activeColumns;
		const csv = [
			cols.join(','),
			...rows.map((row) => cols.map((col) => JSON.stringify(row[col] ?? '')).join(','))
		].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${config.name || 'table'}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function findColumn(re: RegExp): string | undefined {
		return sourceColumns.find((col) => re.test(col));
	}

	function runButton() {
		setValue(Date.now());
		if (config.runTarget === 'all') void runAll();
		else if (config.runTarget === 'dependents') void runAllStale();
	}

	function iconName() {
		if (config.kind === 'run-button') return Play;
		if (config.kind === 'file-upload') return FileUp;
		if (config.kind === 'table-input' || config.kind === 'table-display' || config.kind === 'pivot')
			return Table2;
		if (config.kind === 'map') return MapIcon;
		if (config.kind === 'agent') return Bot;
		if (config.kind === 'checkbox') return CheckSquare;
		if (config.kind.includes('date')) return CalendarDays;
		if (config.kind === 'select' || config.kind === 'multiselect') return ToggleLeft;
		return TextCursorInput;
	}

	function badgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (status === 'error' || status === 'permission-blocked') return 'destructive';
		if (status === 'success' || status === 'valid') return 'secondary';
		return 'outline';
	}

	function formatValue(value: unknown): string {
		if (value == null || value === '') return '-';
		if (typeof value === 'number') {
			return Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
		}
		if (Array.isArray(value)) return value.join(', ');
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	}

	function buildPivotRows(
		rows: Record<string, unknown>[],
		pivotConfig: ControlCellConfig,
		columns: string[]
	): Record<string, unknown>[] {
		if (!rows.length) return [];
		const groupCol = pivotConfig.source.columns?.[0] ?? columns[0];
		const valueCol =
			pivotConfig.source.columns?.[1] ??
			columns.find((col) => rows.some((row) => typeof row[col] === 'number'));
		if (!groupCol || !valueCol) return [];
		const totals = new Map<string, number>();
		for (const row of rows) {
			const key = String(row[groupCol] ?? 'empty');
			const value = Number(row[valueCol] ?? 0);
			totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(value) ? value : 0));
		}
		return [...totals.entries()].map(([key, value]) => ({ [groupCol]: key, [valueCol]: value }));
	}
</script>

<section class="control-cell rounded-lg border border-border bg-background/70 p-3 shadow-xs">
	<div class="mb-3 flex flex-wrap items-start justify-between gap-3">
		<div class="flex min-w-0 items-start gap-2">
			<span
				class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/35 text-muted-foreground"
			>
				<Icon class="size-3.5" />
			</span>
			<div class="min-w-0">
				<div class="flex flex-wrap items-center gap-2">
					<p class="text-sm font-medium text-foreground">{config.label}</p>
					<Badge variant={badgeVariant(config.status)} class="h-5 text-2xs">{config.status}</Badge>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">{config.description}</p>
				{#if config.name}
					<p class="mt-1 font-mono text-2xs text-muted-foreground">${config.name}</p>
				{/if}
			</div>
		</div>
		{#if !reportView}
			<Popover.Root>
				<Popover.Trigger
					class="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
					aria-label="Configure control"
					title="Configure control"
				>
					<Settings2 class="size-3.5" />
				</Popover.Trigger>
				<Popover.Content class="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-3" align="end">
					<label class="block space-y-1">
						<span class="text-2xs font-medium text-muted-foreground">Label</span>
						<Input
							value={config.label}
							oninput={(e) => patchConfig({ label: e.currentTarget.value })}
						/>
					</label>
					<label class="block space-y-1">
						<span class="text-2xs font-medium text-muted-foreground">Variable name</span>
						<Input
							value={config.name}
							oninput={(e) => patchConfig({ name: e.currentTarget.value })}
						/>
					</label>
					{#if config.kind === 'select' || config.kind === 'multiselect'}
						<label class="block space-y-1">
							<span class="text-2xs font-medium text-muted-foreground">Options</span>
							<Textarea class="min-h-24 font-mono text-xs" bind:value={optionDraft} />
						</label>
						<Button
							size="sm"
							variant="outline"
							class="h-7 text-xs"
							onclick={() => patchConfig({ options: parseOptions() })}
						>
							Save options
						</Button>
					{/if}
					{#if config.kind === 'slider' || config.kind === 'number-input'}
						<div class="grid grid-cols-3 gap-2">
							<label class="space-y-1">
								<span class="text-2xs font-medium text-muted-foreground">Min</span>
								<Input
									type="number"
									value={config.validation.min ?? 0}
									oninput={(e) =>
										patchConfig({ validation: { min: Number(e.currentTarget.value) } })}
								/>
							</label>
							<label class="space-y-1">
								<span class="text-2xs font-medium text-muted-foreground">Max</span>
								<Input
									type="number"
									value={config.validation.max ?? 100}
									oninput={(e) =>
										patchConfig({ validation: { max: Number(e.currentTarget.value) } })}
								/>
							</label>
							<label class="space-y-1">
								<span class="text-2xs font-medium text-muted-foreground">Step</span>
								<Input
									type="number"
									value={config.validation.step ?? 1}
									oninput={(e) =>
										patchConfig({ validation: { step: Number(e.currentTarget.value) } })}
								/>
							</label>
						</div>
					{/if}
					{#if sourceColumns.length && ['table-display', 'pivot', 'map', 'single-value'].includes(config.kind)}
						<label class="block space-y-1">
							<span class="text-2xs font-medium text-muted-foreground">Primary column</span>
							<NativeSelect
								value={config.source.columns?.[0] ?? ''}
								onchange={(e) =>
									patchConfig({
										source: {
											columns: [e.currentTarget.value, ...(config.source.columns ?? []).slice(1)]
										}
									})}
							>
								<option value="">Auto</option>
								{#each sourceColumns as col (col)}
									<option value={col}>{col}</option>
								{/each}
							</NativeSelect>
						</label>
					{/if}
				</Popover.Content>
			</Popover.Root>
		{/if}
	</div>

	{#if config.kind === 'text-input'}
		<Input
			aria-label={config.label}
			placeholder={config.display.placeholder}
			value={String(config.value ?? '')}
			oninput={(e) => setValue(e.currentTarget.value)}
		/>
	{:else if config.kind === 'number-input'}
		<Input
			aria-label={config.label}
			type="number"
			min={config.validation.min}
			max={config.validation.max}
			step={config.validation.step ?? 1}
			value={String(config.value ?? '')}
			oninput={(e) => setValue(Number(e.currentTarget.value))}
		/>
	{:else if config.kind === 'slider'}
		<div class="flex items-center gap-3">
			<input
				class="h-2 flex-1 accent-primary"
				aria-label={config.label}
				type="range"
				min={config.validation.min ?? 0}
				max={config.validation.max ?? 100}
				step={config.validation.step ?? 1}
				value={Number(config.value ?? 0)}
				oninput={(e) => setValue(Number(e.currentTarget.value))}
			/>
			<span class="w-12 text-right font-mono text-xs text-muted-foreground">{config.value}</span>
		</div>
	{:else if config.kind === 'date-input'}
		<Input
			aria-label={config.label}
			type="date"
			value={String(config.value ?? '')}
			oninput={(e) => setValue(e.currentTarget.value)}
		/>
	{:else if config.kind === 'date-range'}
		<div class="grid gap-2 sm:grid-cols-2">
			<Input
				aria-label={`${config.label} start`}
				type="date"
				value={String((config.value as { start?: string })?.start ?? '')}
				oninput={(e) =>
					setValue({ ...((config.value as object) ?? {}), start: e.currentTarget.value })}
			/>
			<Input
				aria-label={`${config.label} end`}
				type="date"
				value={String((config.value as { end?: string })?.end ?? '')}
				oninput={(e) =>
					setValue({ ...((config.value as object) ?? {}), end: e.currentTarget.value })}
			/>
		</div>
	{:else if config.kind === 'checkbox'}
		<label class="inline-flex items-center gap-2 text-sm">
			<input
				class="size-4 rounded border-input accent-primary"
				type="checkbox"
				checked={Boolean(config.value)}
				onchange={(e) => setValue(e.currentTarget.checked)}
			/>
			<span>{config.label}</span>
		</label>
	{:else if config.kind === 'select'}
		<NativeSelect
			value={String(config.value ?? '')}
			onchange={(e) => setValue(e.currentTarget.value)}
		>
			{#each config.options as opt (opt.value)}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</NativeSelect>
	{:else if config.kind === 'multiselect'}
		<div class="flex flex-wrap gap-1.5">
			{#each config.options as opt (opt.value)}
				<button
					type="button"
					class="rounded-md border px-2 py-1 text-xs transition-colors {Array.isArray(
						config.value
					) && config.value.includes(opt.value)
						? 'border-primary bg-primary/10 text-primary'
						: 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
					onclick={() => {
						const current = Array.isArray(config.value) ? config.value : [];
						setValue(
							current.includes(opt.value)
								? current.filter((v) => v !== opt.value)
								: [...current, opt.value]
						);
					}}
				>
					{opt.label}
				</button>
			{/each}
		</div>
	{:else if config.kind === 'run-button'}
		<Button size="sm" class="h-8 gap-2" onclick={runButton}
			><Play class="size-3.5" />Run linked cells</Button
		>
	{:else if config.kind === 'file-upload'}
		<Input
			type="file"
			aria-label={config.label}
			accept={config.validation.accept}
			onchange={(e) => {
				const file = e.currentTarget.files?.[0];
				if (!file) return;
				setValue({
					name: file.name,
					size: file.size,
					type: file.type,
					lastModified: file.lastModified
				});
			}}
		/>
		{#if config.value && typeof config.value === 'object'}
			<p class="mt-2 text-xs text-muted-foreground">{(config.value as { name?: string }).name}</p>
		{/if}
	{:else if config.kind === 'table-input'}
		<Textarea class="min-h-32 font-mono text-xs" bind:value={tableDraft} />
		<div class="mt-2 flex items-center gap-2">
			<Button size="sm" variant="outline" class="h-7 text-xs" onclick={applyTableDraft}
				>Apply rows</Button
			>
			{#if tableDraftError}<span class="text-xs text-destructive">{tableDraftError}</span>{/if}
		</div>
	{:else if config.kind === 'single-value'}
		<div class="rounded-md bg-muted/25 px-3 py-4">
			<p class="text-3xl font-semibold tracking-normal text-foreground">
				{formatValue(singleValue)}
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				{config.source.columns?.[0] ?? numericColumns[0] ?? 'value'}
			</p>
		</div>
	{:else if config.kind === 'map'}
		<div class="relative min-h-56 overflow-hidden rounded-md border border-border bg-muted/20">
			{#if mapRows.length}
				{#each mapRows as point, idx (`${point.lat}-${point.lon}-${idx}`)}
					<span
						class="absolute size-2 rounded-full bg-primary shadow-sm"
						title={point.label}
						style={`left:${((point.lon + 180) / 360) * 100}%;top:${((90 - point.lat) / 180) * 100}%`}
					></span>
				{/each}
			{:else}
				<div class="flex h-56 items-center justify-center text-xs text-muted-foreground">
					Choose latitude and longitude columns.
				</div>
			{/if}
		</div>
	{:else if config.kind === 'pivot'}
		{@render dataTable({ rows: pivotRows, columns: pivotRows[0] ? Object.keys(pivotRows[0]) : [] })}
	{:else if config.kind === 'table-display'}
		<div class="mb-2 flex items-center gap-2">
			<Input class="h-7 max-w-56 text-xs" placeholder="Filter rows" bind:value={tableFilter} />
			<Button size="sm" variant="outline" class="h-7 gap-1.5 text-xs" onclick={downloadCsv}
				><Download class="size-3" />CSV</Button
			>
		</div>
		{@render dataTable({ rows: filteredRows, columns: activeColumns })}
	{:else if config.kind === 'writeback'}
		<div
			class="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
		>
			Writeback is guarded. Choose a connection and enable writes before this cell can run.
		</div>
	{:else if config.kind === 'agent'}
		<Textarea
			placeholder={config.display.placeholder}
			value={config.agent?.instruction ?? ''}
			oninput={(e) =>
				patchConfig({
					agent: { ...(config.agent ?? { scope: 'notebook' }), instruction: e.currentTarget.value }
				})}
		/>
		<p class="mt-2 text-xs text-muted-foreground">
			Agent execution is scoped to notebook context and stays disabled until an AI provider is
			configured.
		</p>
	{/if}
</section>

{#snippet dataTable({ rows, columns }: { rows: Record<string, unknown>[]; columns: string[] })}
	{#if rows.length && columns.length}
		<div class="max-h-72 overflow-auto rounded-md border border-border">
			<table class="w-full border-collapse text-left text-xs">
				<thead class="sticky top-0 bg-muted/80">
					<tr>
						{#each columns as col (col)}
							<th class="border-b border-border px-2 py-1.5 font-medium text-muted-foreground"
								>{col}</th
							>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as row, idx (idx)}
						<tr class="border-b border-border/50 last:border-b-0">
							{#each columns as col (col)}
								<td class="max-w-48 truncate px-2 py-1.5">{formatValue(row[col])}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div
			class="rounded-md border border-dashed border-border p-5 text-center text-xs text-muted-foreground"
		>
			Run an upstream cell or configure data.
		</div>
	{/if}
{/snippet}
