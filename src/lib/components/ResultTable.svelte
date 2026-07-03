<script lang="ts">
	import {
		type ColumnDef,
		type ColumnFiltersState,
		type PaginationState,
		type SortingState,
		getCoreRowModel,
		getFilteredRowModel,
		getPaginationRowModel,
		getSortedRowModel
	} from '@tanstack/table-core';
	import { createSvelteTable } from '$lib/components/ui/data-table/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { coerceNumber } from '$lib/utils';
	import {
		Download,
		X,
		Copy,
		Check,
		ArrowUp,
		ArrowDown,
		Filter,
		MoreHorizontal,
		Search,
		MessageSquare,
		Hash,
		Type
	} from '@lucide/svelte';
	import FormattedCell from '$lib/components/FormattedCell.svelte';
	import { KIND_ICON } from '$lib/components/stats/stats-ui';
	import { buildReportTableModel } from '$lib/services/report-table-model';
	import { type ColumnFormat } from '$lib/services/column-format';
	import { formatCellPlainText, formatFullValueText } from '$lib/services/report-table-format';
	import { computeTableHeaderStats } from '$lib/services/column-profile';
	import {
		conditionalToneToCssVar,
		defaultConditionalRulesForColumn,
		evaluateConditionalCellStyle,
		type CellConditionalStyle,
		type ColumnConditionalRules
	} from '$lib/services/report-table-conditional-format';

	interface Props {
		rows: Record<string, unknown>[];
		columns: string[];
		pageSize?: number;
		name?: string;
		headerInsights?: 'full' | 'compact';
		columnDescriptions?: Record<string, string>;
		/** Optional formatting override for specific columns (used by pivot/summary outputs). */
		columnFormatOverrides?: Record<string, ColumnFormat>;
		columnFormatRules?: ColumnConditionalRules;
		onColumnFormatRulesChange?: (rules: ColumnConditionalRules) => void;
		/** Optional externally controlled global table search. */
		searchValue?: string;
		onSearchValueChange?: (value: string) => void;
		/** Show the built-in search row (standalone markdown datatables). */
		showSearch?: boolean;
		onAddSort?: (column: string, dir: 'asc' | 'desc') => void;
		onAddFilter?: (column: string) => void;
		onColumnDescriptionChange?: (column: string, description: string) => void;
		/** True when rows were capped at the auto-limit */
		truncated?: boolean;
		/** Fill the parent's height instead of capping the table at max-h-96 (full result tab) */
		fillHeight?: boolean;
	}

	let {
		rows,
		columns,
		pageSize = 10,
		name = 'results',
		headerInsights = 'compact',
		columnDescriptions = {},
		columnFormatOverrides = {},
		columnFormatRules = {},
		onColumnFormatRulesChange,
		searchValue,
		onSearchValueChange,
		showSearch = true,
		truncated = false,
		fillHeight = false,
		onAddSort,
		onAddFilter,
		onColumnDescriptionChange
	}: Props = $props();

	let descPopoverCol = $state<string | null>(null);
	let descPopoverValue = $state('');
	let descPopoverTop = $state(0);
	let descPopoverLeft = $state(0);

	function openDescPopover(col: string, anchorEl: HTMLElement) {
		const r = anchorEl.getBoundingClientRect();
		descPopoverTop = r.bottom + 4;
		descPopoverLeft = r.left;
		descPopoverCol = col;
		descPopoverValue = columnDescriptions[col] ?? '';
	}

	function saveDescPopover() {
		if (descPopoverCol) {
			onColumnDescriptionChange?.(descPopoverCol, descPopoverValue);
		}
		descPopoverCol = null;
	}

	// ── Table interaction state ─────────────────────────────────────────
	// `ResultTable` is used both in notebooks and in exported/shared report views.
	// These controls provide native client-side sorting/filtering/search while also
	// optionally notifying the GUI layer via `onAddSort` / `onAddFilter`.
	let internalSearch = $state('');
	const globalSearch = $derived(searchValue ?? internalSearch);
	let sorting = $state<SortingState>([]);
	let columnFilters = $state<ColumnFiltersState>([]);

	let filterPopoverCol = $state<string | null>(null);
	let filterPopoverValue = $state('');
	let filterPopoverTop = $state(0);
	let filterPopoverLeft = $state(0);
	let columnMenuCol = $state<string | null>(null);
	let columnMenuTop = $state(0);
	let columnMenuLeft = $state(0);

	function resetPaginationToFirstPage() {
		pagination = { pageIndex: 0, pageSize: pagination.pageSize };
	}

	function setGlobalSearch(value: string) {
		if (searchValue !== undefined) onSearchValueChange?.(value);
		else internalSearch = value;
		resetPaginationToFirstPage();
	}

	function openColumnMenu(col: string, anchorEl: HTMLElement) {
		const r = anchorEl.getBoundingClientRect();
		columnMenuTop = r.bottom + 4;
		columnMenuLeft = r.left;
		columnMenuCol = col;
	}

	function closeColumnMenu() {
		columnMenuCol = null;
	}

	function setSort(col: string, dir: 'asc' | 'desc') {
		sorting = [{ id: col, desc: dir === 'desc' }];
		resetPaginationToFirstPage();
	}

	function toggleSort(col: string) {
		const current = sorting.find((s) => s.id === col);
		if (!current) {
			setSort(col, 'asc');
			onAddSort?.(col, 'asc');
			return;
		}
		if (current.desc === false) {
			setSort(col, 'desc');
			onAddSort?.(col, 'desc');
			return;
		}
		sorting = sorting.filter((s) => s.id !== col);
		resetPaginationToFirstPage();
	}

	function sortDirFor(col: string): 'asc' | 'desc' | null {
		const s = sorting.find((x) => x.id === col);
		if (!s) return null;
		return s.desc ? 'desc' : 'asc';
	}

	function hasFilterFor(col: string): boolean {
		return columnFilters.some((f) => f.id === col && String(f.value ?? '').trim() !== '');
	}

	function hasRulesFor(col: string): boolean {
		return Array.isArray(columnFormatRules[col]) && columnFormatRules[col].length > 0;
	}

	function openFilterPopover(col: string, anchorEl: HTMLElement) {
		const r = anchorEl.getBoundingClientRect();
		filterPopoverTop = r.bottom + 4;
		filterPopoverLeft = r.left;
		filterPopoverCol = col;
		const existing = columnFilters.find((f) => f.id === col);
		filterPopoverValue = existing?.value != null ? String(existing.value) : '';
		onAddFilter?.(col);
	}

	function closeFilterPopover() {
		filterPopoverCol = null;
		filterPopoverValue = '';
	}

	function applyFilterPopover() {
		if (!filterPopoverCol) return;
		const term = filterPopoverValue.trim();
		if (!term) columnFilters = columnFilters.filter((f) => f.id !== filterPopoverCol);
		else columnFilters = [{ id: filterPopoverCol, value: term }];
		closeFilterPopover();
		resetPaginationToFirstPage();
	}

	function setColumnRules(col: string, next: ColumnConditionalRules[string]) {
		onColumnFormatRulesChange?.({
			...columnFormatRules,
			[col]: next
		});
	}

	function clearColumnRules(col: string) {
		const copy: ColumnConditionalRules = { ...columnFormatRules };
		delete copy[col];
		onColumnFormatRulesChange?.(copy);
	}

	const pageSizeOptions = [10, 25, 50, 100, 250];

	// ── Column stats ─────────────────────────────────────────────────────
	interface ColStats {
		col: string;
		missing: number;
		distinct: number;
		total: number;
		isNumeric: boolean;
		min: number | null;
		max: number | null;
		histBuckets: number[] | null;
	}

	function computeColStats(allRows: Record<string, unknown>[], col: string): ColStats {
		return computeTableHeaderStats(allRows, col);
	}

	let statsMap = $state<Record<string, ColStats>>({});
	let formatMap = $state<Record<string, ColumnFormat>>({});

	$effect(() => {
		// Capture reactive values before the async gap so the effect re-runs when they change.
		const localRows = rows;
		const localCols = [...columns];
		const id = setTimeout(() => {
			const model = buildReportTableModel(localRows, localCols, {
				name,
				formatOverrides: columnFormatOverrides
			});
			formatMap = Object.fromEntries(model.columns.map((c) => [c.id, c.format]));
			statsMap =
				headerInsights === 'full'
					? Object.fromEntries(localCols.map((col) => [col, computeColStats(localRows, col)]))
					: {};
		}, 0);
		return () => clearTimeout(id);
	});

	function fmtNum(n: number): string {
		if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
		if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
		return Number.isInteger(n) ? String(n) : n.toFixed(2);
	}

	function pct(n: number, total: number): string {
		return total > 0 ? ((n / total) * 100).toFixed(0) + '%' : '0%';
	}

	const DETAIL_DISPLAY_MAX = 20_000;

	// ── TanStack Table ────────────────────────────────────────────────────
	// Use accessorFn + id instead of accessorKey to avoid dot-notation path
	// interpretation for columns like "table.column_name".
	const tableColumns = $derived<ColumnDef<Record<string, unknown>>[]>(
		columns.map((col) => ({
			id: col,
			accessorFn: (row: Record<string, unknown>) => row[col],
			// Sorting: prefer numeric ordering when values are coercible numbers,
			// otherwise fall back to locale-aware string comparison.
			sortingFn: (rowA, rowB, columnId) => {
				const aRaw = rowA.getValue(columnId);
				const bRaw = rowB.getValue(columnId);
				if (aRaw === null || aRaw === undefined)
					return bRaw === null || bRaw === undefined ? 0 : -1;
				if (bRaw === null || bRaw === undefined) return 1;

				const aNum = coerceNumber(aRaw);
				const bNum = coerceNumber(bRaw);
				if (aNum !== null && bNum !== null) return aNum === bNum ? 0 : aNum < bNum ? -1 : 1;

				const aStr = String(aRaw);
				const bStr = String(bRaw);
				return aStr.localeCompare(bStr, undefined, { sensitivity: 'base', numeric: true });
			},
			// Filtering: case-insensitive substring match on the stringified cell value.
			filterFn: (row, columnId, filterValue) => {
				const term = String(filterValue ?? '')
					.trim()
					.toLowerCase();
				if (!term) return true;
				const v = row.getValue(columnId);
				if (v === null || v === undefined) return false;
				return String(v).toLowerCase().includes(term);
			}
		}))
	);

	const effectiveRows = $derived.by(() => {
		const term = globalSearch.trim().toLowerCase();
		if (!term) return rows;
		return rows.filter((r) =>
			columns.some((col) => {
				const v = r[col];
				if (v === null || v === undefined) return false;
				return String(v).toLowerCase().includes(term);
			})
		);
	});

	const initialPagination = (() => ({ pageIndex: 0, pageSize }))();
	let pagination = $state<PaginationState>(initialPagination);

	const table = createSvelteTable({
		get data() {
			return effectiveRows;
		},
		get columns() {
			return tableColumns;
		},
		state: {
			get pagination() {
				return pagination;
			},
			get sorting() {
				return sorting;
			},
			get columnFilters() {
				return columnFilters;
			}
		},
		onPaginationChange(updater) {
			pagination = typeof updater === 'function' ? updater(pagination) : updater;
		},
		onSortingChange(updater) {
			sorting = typeof updater === 'function' ? updater(sorting) : updater;
			resetPaginationToFirstPage();
		},
		onColumnFiltersChange(updater) {
			columnFilters = typeof updater === 'function' ? updater(columnFilters) : updater;
			resetPaginationToFirstPage();
		},
		getCoreRowModel: getCoreRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel()
	});

	const totalRows = $derived.by(() => table.getFilteredRowModel().rows.length);
	const startRow = $derived(pagination.pageIndex * pagination.pageSize + 1);
	const endRow = $derived(
		Math.min(pagination.pageIndex * pagination.pageSize + pagination.pageSize, totalRows)
	);

	let previousSearch = $state<string | null>(null);
	$effect(() => {
		const current = globalSearch;
		if (previousSearch === null) {
			previousSearch = current;
			return;
		}
		if (current === previousSearch) return;
		previousSearch = current;
		resetPaginationToFirstPage();
	});

	const conditionalDomainCache = $derived.by(
		() => new Map<string, { min: number; max: number } | null>()
	);

	function styleForCell(value: unknown, colId: string): CellConditionalStyle | null {
		return evaluateConditionalCellStyle(value, columnFormatRules[colId], {
			rows,
			columnId: colId,
			domainCache: conditionalDomainCache
		});
	}

	function styleAttrForCell(style: CellConditionalStyle | null, sticky = false): string {
		if (!style) return sticky ? 'background-color: var(--background);' : '';
		const tone = conditionalToneToCssVar(style.tone ?? style.textTone ?? 'neutral');
		const alpha = style.backgroundAlpha ?? 0.14;
		const bg = `color-mix(in oklab, ${tone} ${Math.round(alpha * 100)}%, transparent)`;
		let css = `--cf-tone:${tone};--cf-bg:${bg};background-color:${bg};`;
		if (style.dataBar) {
			const pct = Math.max(0, Math.min(100, Math.round(style.dataBar.percent * 100)));
			const dir = style.dataBar.direction === 'negative' ? 'to left' : 'to right';
			css += `background-image:linear-gradient(${dir}, color-mix(in oklab, ${tone} 26%, transparent) ${pct}%, transparent ${pct}%);`;
		}
		if (sticky) css += 'position: sticky; left:0;';
		return css;
	}

	// ── Cell detail panel ────────────────────────────────────────────────
	interface SelectedCell {
		col: string;
		value: unknown;
	}
	let selectedCell = $state<SelectedCell | null>(null);
	let copied = $state(false);

	function formatFullValue(value: unknown): string {
		return formatFullValueText(value);
	}

	function formatDetailValue(value: unknown): string {
		const s = formatFullValue(value);
		return s.length > DETAIL_DISPLAY_MAX
			? s.slice(0, DETAIL_DISPLAY_MAX) + '\n… (truncated — use Copy for full value)'
			: s;
	}

	async function copyValue(value: unknown) {
		try {
			await navigator.clipboard.writeText(formatFullValue(value));
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// clipboard not available
		}
	}

	function downloadCSV() {
		const escape = (v: unknown): string => {
			if (v === null || v === undefined) return '';
			const s =
				v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
			return s.includes(',') || s.includes('"') || s.includes('\n')
				? `"${s.replace(/"/g, '""')}"`
				: s;
		};
		const csv = [
			columns.join(','),
			...rows.map((r) => columns.map((c) => escape(r[c])).join(','))
		].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${name}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<!--
	Header controls (client-side sort toggle + filter) shown for every column
	regardless of whether the GUI callbacks are wired, so report/markdown tables
	are fully interactive. Buttons stay faint until hovered or active.
-->
{#snippet headerControls(col: string)}
	{@const dir = sortDirFor(col)}
	{@const filtered = hasFilterFor(col)}
	{@const hasRules = hasRulesFor(col)}
	<div class="flex shrink-0 items-center gap-1">
		{#if dir || filtered || hasRules}
			<span
				class="h-1.5 w-1.5 rounded-full {hasRules
					? 'bg-primary'
					: filtered
						? 'bg-warning'
						: 'bg-muted-foreground'}"
				aria-hidden="true"
			></span>
		{/if}
		<button
			type="button"
			class="rounded p-0.5 transition-colors hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none {dir ||
			filtered ||
			hasRules
				? 'text-primary'
				: 'text-muted-foreground/40 group-hover/col:text-muted-foreground'}"
			onclick={(e) => openColumnMenu(col, e.currentTarget as HTMLElement)}
			aria-label="Column actions for {col}"
			title="Column actions"
		>
			<MoreHorizontal class="h-3 w-3" />
		</button>
	</div>
{/snippet}

<div class="flex min-h-0 flex-col gap-2 {fillHeight ? 'min-h-0 flex-1' : ''}">
	<div class="flex min-h-0 min-w-0 gap-2 {fillHeight ? 'flex-1' : ''}">
		<div class="min-h-0 min-w-0 flex-1">
			{#if showSearch}
				<div class="flex items-center px-1">
					<label class="group/search relative ml-auto flex items-center">
						<Search
							class="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground/45 transition-colors group-focus-within/search:text-muted-foreground"
						/>
						<input
							class="h-7 w-40 rounded-md border border-transparent bg-transparent pr-6 pl-7 text-xs text-foreground transition-[width,background-color,border-color] duration-(--motion-medium) ease-(--motion-ease-out) outline-none placeholder:text-muted-foreground/45 hover:bg-muted/40 focus:w-72 focus:border-border focus:bg-background motion-reduce:transition-none"
							type="text"
							placeholder="Search"
							aria-label="Search table"
							value={globalSearch}
							oninput={(e) => setGlobalSearch(e.currentTarget.value)}
						/>
						{#if globalSearch.trim()}
							<button
								type="button"
								class="absolute right-1.5 flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground"
								onclick={() => setGlobalSearch('')}
								aria-label="Clear search"
								title="Clear search"
							>
								<X class="h-3 w-3" />
							</button>
						{/if}
					</label>
				</div>
			{/if}
			<Table.Root
				containerClass="overflow-auto rounded-sm border border-border {fillHeight
					? 'h-full max-h-full'
					: 'max-h-96'}"
			>
				<Table.Header>
					{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
						<Table.Row class="border-b-0">
							{#each headerGroup.headers as header, hi (header.id)}
								{@const s = statsMap[header.id]}
								<Table.Head
									class="border-b bg-background p-2 align-top
								{hi === 0 ? 'sticky top-0 left-0 z-30' : 'sticky top-0 z-20'}"
								>
									{#if s && headerInsights === 'full'}
										{@const Icon = formatMap[s.col]
											? KIND_ICON[formatMap[s.col].kind]
											: s.isNumeric
												? Hash
												: Type}
										<div class="flex min-w-24 flex-col gap-0.5">
											<!-- Type icon + column name + action buttons -->
											<div class="group/col flex items-center gap-1">
												<Icon class="h-3 w-3 shrink-0 text-muted-foreground" />
												<span
													class="flex-1 cursor-pointer truncate text-xs leading-none font-semibold transition-colors select-none hover:text-primary"
													title={columnDescriptions[s.col] || 'Click to sort'}
													role="button"
													tabindex={0}
													onkeydown={(e) => {
														if (e.key === 'Enter' || e.key === ' ') {
															e.preventDefault();
															toggleSort(s.col);
														}
													}}
													onclick={() => toggleSort(s.col)}>{s.col}</span
												>
												{@render headerControls(s.col)}
											</div>
											<!-- Histogram for numeric columns -->
											{#if s.histBuckets}
												{@const maxBucket = Math.max(...s.histBuckets, 1)}
												<svg
													width="80"
													height="24"
													viewBox="0 0 80 24"
													class="mt-0.5 text-chart-4/75"
												>
													{#each s.histBuckets as v, i (i)}
														{@const bw = 80 / s.histBuckets.length}
														{@const bh = (v / maxBucket) * 24}
														<rect
															x={i * bw}
															y={24 - bh}
															width={bw - 0.5}
															height={bh}
															fill="currentColor"
														/>
													{/each}
												</svg>
												<div
													class="flex justify-between text-3xs leading-none text-muted-foreground"
												>
													<span>Min {fmtNum(s.min!)}</span>
													<span>Max {fmtNum(s.max!)}</span>
												</div>
											{/if}
											<!-- Missing -->
											<div class="text-2xs leading-none text-muted-foreground">
												Missing: <span class="font-medium"
													>{s.missing} ({pct(s.missing, s.total)})</span
												>
											</div>
											<!-- Distinct -->
											<div class="text-2xs leading-none text-muted-foreground">
												Distinct: <span class="font-medium"
													>{s.distinct} ({pct(s.distinct, s.total)})</span
												>
											</div>
										</div>
									{:else if !header.isPlaceholder}
										<div class="group/col flex items-center gap-1">
											<span
												class="flex-1 cursor-pointer truncate text-xs leading-none font-semibold transition-colors select-none hover:text-primary"
												title="Click to sort"
												role="button"
												tabindex={0}
												onkeydown={(e) => {
													if (e.key === 'Enter' || e.key === ' ') {
														e.preventDefault();
														toggleSort(header.id);
													}
												}}
												onclick={() => toggleSort(header.id)}>{header.id}</span
											>
											{@render headerControls(header.id)}
										</div>
									{/if}
								</Table.Head>
							{/each}
						</Table.Row>
					{/each}
				</Table.Header>
				<Table.Body>
					{#each table.getRowModel().rows as row (row.id)}
						<Table.Row>
							{#each row.getVisibleCells() as cell, ci (cell.id)}
								{@const value = row.original[cell.column.id]}
								{@const isNull = value === null || value === undefined}
								{@const fmt = formatMap[cell.column.id] ?? { kind: 'text' }}
								{@const conditional = styleForCell(value, cell.column.id)}
								<Table.Cell
									class="max-w-64 cursor-pointer truncate p-2 transition-colors hover:bg-muted/50
									{ci === 0 ? 'sticky left-0 z-10 bg-background' : ''}
									{!isNull && (fmt.kind === 'number' || fmt.kind === 'currency' || fmt.kind === 'percentage')
										? 'text-right'
										: ''}"
									style={styleAttrForCell(conditional, ci === 0)}
									onclick={() => {
										selectedCell = { col: cell.column.id, value };
										copied = false;
									}}
								>
									{#if isNull}
										<span class="font-mono text-xs text-muted-foreground">—</span>
									{:else}
										<span class="inline-flex items-center gap-1">
											{#if conditional?.icon}
												<span
													class="shrink-0 text-2xs font-semibold"
													style="color: {conditionalToneToCssVar(
														conditional.textTone ?? conditional.tone ?? 'neutral'
													)}"
													>{conditional.icon === 'up'
														? '▲'
														: conditional.icon === 'down'
															? '▼'
															: conditional.icon === 'flat'
																? '•'
																: conditional.icon === 'check'
																	? '✓'
																	: '!'}</span
												>
											{/if}
											<FormattedCell {value} format={fmt} plainText={formatCellPlainText(value)} />
										</span>
									{/if}
								</Table.Cell>
							{/each}
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell
								colspan={columns.length}
								class="h-24 text-center text-sm text-muted-foreground"
							>
								No results.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>

		{#if columnMenuCol}
			{@const menuCol = columnMenuCol}
			<button
				type="button"
				class="fixed inset-0 z-(--z-overlay) cursor-default"
				aria-label="Dismiss column actions"
				tabindex={-1}
				onclick={closeColumnMenu}
			></button>
			<div
				style="position: fixed; top: {columnMenuTop}px; left: {columnMenuLeft}px;"
				class="column-menu z-(--z-dropdown) w-60 rounded-lg border border-border bg-popover p-1.5 shadow-xl shadow-black/15 backdrop-blur-sm"
			>
				<div class="flex items-start justify-between gap-2 px-2 py-1.5">
					<div class="min-w-0">
						<p class="truncate font-mono text-2xs leading-none font-medium text-foreground">
							{menuCol}
						</p>
						<p class="mt-1 text-2xs leading-none text-muted-foreground">Column actions</p>
					</div>
					<div class="flex shrink-0 items-center gap-1 pt-0.5">
						{#if sortDirFor(menuCol)}
							<span class="rounded bg-primary/12 px-1.5 py-0.5 text-3xs text-primary">sort</span>
						{/if}
						{#if hasFilterFor(menuCol)}
							<span class="rounded bg-warning/12 px-1.5 py-0.5 text-3xs text-warning">filter</span>
						{/if}
						{#if hasRulesFor(menuCol)}
							<span class="rounded bg-primary/12 px-1.5 py-0.5 text-3xs text-primary">format</span>
						{/if}
					</div>
				</div>

				<div class="grid">
					<div class="px-1 py-1.5">
						<p class="px-1 pb-1 text-2xs font-medium text-muted-foreground">Sort</p>
						<div class="grid grid-cols-3 gap-1">
							<Button
								variant="ghost"
								size="sm"
								class="h-7 justify-center gap-1 px-1.5 text-2xs focus-visible:ring-2 focus-visible:ring-ring/50 {sortDirFor(
									menuCol
								) === 'asc'
									? 'bg-primary/12 text-primary'
									: ''}"
								onclick={() => {
									setSort(menuCol, 'asc');
									onAddSort?.(menuCol, 'asc');
									closeColumnMenu();
								}}
							>
								<ArrowUp class="h-3 w-3" />
								Asc
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 justify-center gap-1 px-1.5 text-2xs focus-visible:ring-2 focus-visible:ring-ring/50 {sortDirFor(
									menuCol
								) === 'desc'
									? 'bg-primary/12 text-primary'
									: ''}"
								onclick={() => {
									setSort(menuCol, 'desc');
									onAddSort?.(menuCol, 'desc');
									closeColumnMenu();
								}}
							>
								<ArrowDown class="h-3 w-3" />
								Desc
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 justify-center px-1.5 text-2xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
								onclick={() => {
									sorting = sorting.filter((s) => s.id !== menuCol);
									resetPaginationToFirstPage();
									closeColumnMenu();
								}}
							>
								Clear
							</Button>
						</div>
					</div>

					<div class="grid gap-0.5 border-t border-border px-1 py-1.5">
						<Button
							variant="ghost"
							size="sm"
							class="h-7 justify-start gap-2 px-2 text-2xs focus-visible:ring-2 focus-visible:ring-ring/50 {hasFilterFor(
								menuCol
							)
								? 'text-warning'
								: ''}"
							onclick={(e) => {
								openFilterPopover(menuCol, e.currentTarget as HTMLElement);
								closeColumnMenu();
							}}
						>
							<Filter class="h-3 w-3" />
							<span class="flex-1 text-left">Filter values</span>
							{#if hasFilterFor(menuCol)}
								<span class="text-3xs text-muted-foreground">active</span>
							{/if}
						</Button>
						{#if onColumnDescriptionChange}
							<Button
								variant="ghost"
								size="sm"
								class="h-7 justify-start gap-2 px-2 text-2xs focus-visible:ring-2 focus-visible:ring-ring/50"
								onclick={(e) => {
									openDescPopover(menuCol, e.currentTarget as HTMLElement);
									closeColumnMenu();
								}}
							>
								<MessageSquare class="h-3 w-3" />
								<span class="flex-1 text-left">Column description</span>
							</Button>
						{/if}
					</div>

					<div class="border-t border-border px-1 py-1.5">
						<div class="flex items-center justify-between px-1 pb-1">
							<p class="text-2xs font-medium text-muted-foreground">Conditional format</p>
							{#if hasRulesFor(menuCol)}
								<span class="text-3xs text-primary">active</span>
							{/if}
						</div>
						<div class="grid grid-cols-2 gap-1">
							<Button
								variant="ghost"
								size="sm"
								class="h-7 justify-start px-2 text-2xs focus-visible:ring-2 focus-visible:ring-ring/50"
								onclick={() => {
									setColumnRules(menuCol, defaultConditionalRulesForColumn(menuCol));
									closeColumnMenu();
								}}
							>
								Quick preset
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 justify-start px-2 text-2xs focus-visible:ring-2 focus-visible:ring-ring/50"
								onclick={() => {
									setColumnRules(menuCol, [
										{
											id: `${menuCol}:scale`,
											type: 'colorScale',
											minColor: 'negative',
											midColor: 'warning',
											maxColor: 'positive'
										}
									]);
									closeColumnMenu();
								}}
							>
								Heatmap
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 justify-start px-2 text-2xs focus-visible:ring-2 focus-visible:ring-ring/50"
								onclick={() => {
									setColumnRules(menuCol, [
										{ id: `${menuCol}:bar`, type: 'dataBar', tone: 'info' }
									]);
									closeColumnMenu();
								}}
							>
								Data bars
							</Button>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 justify-start px-2 text-2xs focus-visible:ring-2 focus-visible:ring-ring/50"
								onclick={() => {
									setColumnRules(menuCol, [{ id: `${menuCol}:icons`, type: 'iconSet' }]);
									closeColumnMenu();
								}}
							>
								Icon set
							</Button>
						</div>
						{#if hasRulesFor(menuCol)}
							<Button
								variant="ghost"
								size="sm"
								class="mt-1 h-7 w-full justify-start px-2 text-2xs text-destructive hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50"
								onclick={() => {
									clearColumnRules(menuCol);
									closeColumnMenu();
								}}
							>
								Clear conditional formatting
							</Button>
						{/if}
					</div>
				</div>
			</div>
		{/if}

		{#if filterPopoverCol}
			<!-- Click-away backdrop so the popover dismisses seamlessly. -->
			<button
				type="button"
				class="fixed inset-0 z-(--z-overlay) cursor-default"
				aria-label="Dismiss filter"
				tabindex={-1}
				onclick={closeFilterPopover}
			></button>
			<div
				style="position: fixed; top: {filterPopoverTop}px; left: {filterPopoverLeft}px;"
				class="z-(--z-dropdown) w-64 rounded-md border border-border bg-popover p-2 shadow-lg"
			>
				<p class="mb-1 flex items-center gap-1 text-2xs font-medium text-muted-foreground">
					<Filter class="h-3 w-3" />
					<span class="truncate">Filter: {filterPopoverCol}</span>
				</p>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="w-full rounded border border-input bg-background px-2 py-1 text-2xs focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
					type="text"
					placeholder="Type to match…"
					autofocus
					bind:value={filterPopoverValue}
					onkeydown={(e) => {
						if (e.key === 'Enter') applyFilterPopover();
						if (e.key === 'Escape') closeFilterPopover();
					}}
				/>
				<div class="mt-1.5 flex justify-end gap-1">
					<button
						class="rounded px-2 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-muted/60"
						onclick={closeFilterPopover}
					>
						Cancel
					</button>
					<button
						class="rounded bg-primary px-2 py-0.5 text-2xs text-primary-foreground transition-opacity hover:opacity-90"
						onclick={applyFilterPopover}
					>
						Apply
					</button>
				</div>
			</div>
		{/if}

		{#if descPopoverCol}
			<button
				type="button"
				class="fixed inset-0 z-(--z-overlay) cursor-default"
				aria-label="Dismiss description editor"
				tabindex={-1}
				onclick={() => (descPopoverCol = null)}
			></button>
			<div
				style="position: fixed; top: {descPopoverTop}px; left: {descPopoverLeft}px;"
				class="z-(--z-dropdown) w-64 rounded-md border border-border bg-popover p-2 shadow-lg"
			>
				<p class="mb-1 text-2xs font-medium text-muted-foreground">{descPopoverCol}</p>
				<textarea
					class="w-full resize-none rounded border border-input bg-background px-2 py-1 text-2xs focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
					rows={3}
					placeholder="Column description…"
					bind:value={descPopoverValue}
				></textarea>
				<div class="mt-1 flex justify-end gap-1">
					<button
						class="rounded px-2 py-0.5 text-2xs text-muted-foreground hover:bg-muted/60"
						onclick={() => (descPopoverCol = null)}
					>
						Cancel
					</button>
					<button
						class="rounded bg-primary px-2 py-0.5 text-2xs text-primary-foreground"
						onclick={saveDescPopover}
					>
						Save
					</button>
				</div>
			</div>
		{/if}

		<!-- Cell detail panel -->
		{#if selectedCell}
			<div class="flex w-64 shrink-0 flex-col gap-2 rounded-md border bg-card p-3">
				<div class="flex items-center justify-between gap-1">
					<span
						class="truncate font-mono text-xs font-semibold text-foreground"
						title={selectedCell.col}>{selectedCell.col}</span
					>
					<button
						class="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
						onclick={() => {
							selectedCell = null;
							copied = false;
						}}
						aria-label="Close"
					>
						<X class="h-3.5 w-3.5" />
					</button>
				</div>
				<pre
					class="max-h-105 min-h-0 flex-1 overflow-auto rounded bg-muted p-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground">{formatDetailValue(
						selectedCell.value
					)}</pre>
				<Button
					variant="outline"
					size="sm"
					class="h-7 w-full gap-1 text-xs"
					onclick={() => copyValue(selectedCell?.value)}
				>
					{#if copied}
						<Check class="h-3 w-3" />
						Copied!
					{:else}
						<Copy class="h-3 w-3" />
						Copy value
					{/if}
				</Button>
			</div>
		{/if}
	</div>

	<!-- Footer: one quiet line — range, optional truncation note, pager, export -->
	<div class="flex shrink-0 items-center justify-between px-1 text-2xs text-muted-foreground">
		<span>
			{#if totalRows > pagination.pageSize}
				{startRow.toLocaleString()}–{endRow.toLocaleString()} of {totalRows.toLocaleString()}
			{:else}
				{totalRows.toLocaleString()} row{totalRows === 1 ? '' : 's'}
			{/if}
			{#if truncated}
				<span
					class="text-warning"
					title="Result capped at the auto-limit; run with a higher limit or export for the full set"
				>
					· first {totalRows.toLocaleString()} rows</span
				>
			{/if}
		</span>
		<div class="flex items-center gap-1.5">
			{#if totalRows > pagination.pageSize}
				<Select.Root
					type="single"
					value={String(pagination.pageSize)}
					onValueChange={(v) => {
						pagination = { pageIndex: 0, pageSize: Number(v) };
					}}
				>
					<Select.Trigger
						class="h-7 w-16 border-transparent text-xs shadow-none hover:border-border"
						aria-label="Rows per page"
					>
						{pagination.pageSize}
					</Select.Trigger>
					<Select.Content>
						{#each pageSizeOptions as size (size)}
							<Select.Item value={String(size)} class="text-xs">{size} per page</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button
					variant="ghost"
					size="sm"
					class="h-7 px-2 text-xs"
					onclick={() => table.previousPage()}
					disabled={!table.getCanPreviousPage()}
				>
					Previous
				</Button>
				<span class="text-2xs tabular-nums"
					>{pagination.pageIndex + 1} / {table.getPageCount()}</span
				>
				<Button
					variant="ghost"
					size="sm"
					class="h-7 px-2 text-xs"
					onclick={() => table.nextPage()}
					disabled={!table.getCanNextPage()}
				>
					Next
				</Button>
			{/if}
			<Button variant="ghost" size="sm" class="h-7 gap-1 px-2 text-xs" onclick={downloadCSV}>
				<Download class="h-3 w-3" />
				Export CSV
			</Button>
		</div>
	</div>
</div>

<style>
	.column-menu {
		transform-origin: top left;
		animation: column-menu-in 120ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes column-menu-in {
		from {
			opacity: 0;
			transform: translateY(-2px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.column-menu {
			animation: none;
		}
	}
</style>
