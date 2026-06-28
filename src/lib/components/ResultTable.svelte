<script lang="ts">
	import {
		type ColumnDef,
		type PaginationState,
		getCoreRowModel,
		getPaginationRowModel
	} from '@tanstack/table-core';
	import { createSvelteTable } from '$lib/components/ui/data-table/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		Download, X, Copy, Check, ArrowUp, ArrowDown, Filter, MessageSquare,
		Hash, Calendar, CalendarClock, ToggleLeft, AtSign, Link2, Tag, KeyRound, Type, Percent, DollarSign
	} from '@lucide/svelte';
	import FormattedCell from '$lib/components/FormattedCell.svelte';
	import { detectColumnFormat, type ColumnFormat, type ColumnFormatKind } from '$lib/services/column-format';

	interface Props {
		rows: Record<string, unknown>[];
		columns: string[];
		pageSize?: number;
		name?: string;
		headerInsights?: 'full' | 'compact';
		columnDescriptions?: Record<string, string>;
		onAddSort?: (column: string, dir: 'asc' | 'desc') => void;
		onAddFilter?: (column: string) => void;
		onColumnDescriptionChange?: (column: string, description: string) => void;
		/** True when rows were capped at the auto-limit */
		truncated?: boolean;
		/** Fill the parent's height instead of capping the table at max-h-125 (full result tab) */
		fillHeight?: boolean;
	}

	let {
		rows,
		columns,
		pageSize = 10,
		name = 'results',
		headerInsights = 'full',
		columnDescriptions = {},
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
		const values = allRows.map((r) => r[col]);
		const missing = values.filter((v) => v === null || v === undefined).length;
		const nonNull = values.filter((v) => v !== null && v !== undefined);
		const distinct = new Set(nonNull.map(String)).size;
		const isNumeric = nonNull.length > 0 && nonNull.every((v) => typeof v === 'number');
		let min: number | null = null;
		let max: number | null = null;
		let histBuckets: number[] | null = null;
		if (isNumeric) {
			const nums = nonNull as number[];
			min = Math.min(...nums);
			max = Math.max(...nums);
			const BUCKETS = 20;
			const range = max - min;
			histBuckets = new Array(BUCKETS).fill(0) as number[];
			if (range > 0) {
				nums.forEach((n) => {
					const bucket = Math.min(Math.floor(((n - min!) / range) * BUCKETS), BUCKETS - 1);
					histBuckets![bucket]++;
				});
			} else {
				histBuckets[10] = nums.length;
			}
		}
		return { col, missing, distinct, total: values.length, isNumeric, min, max, histBuckets };
	}

	let statsMap = $state<Record<string, ColStats>>({});
	let formatMap = $state<Record<string, ColumnFormat>>({});

	const KIND_ICON: Record<ColumnFormatKind, typeof Hash> = {
		boolean: ToggleLeft,
		id: KeyRound,
		email: AtSign,
		url: Link2,
		datetime: CalendarClock,
		date: Calendar,
		percentage: Percent,
		currency: DollarSign,
		number: Hash,
		category: Tag,
		text: Type
	};

	$effect(() => {
		// Capture reactive values before the async gap so the effect re-runs when they change.
		const localRows = rows;
		const localCols = [...columns];
		const id = setTimeout(() => {
			formatMap = Object.fromEntries(localCols.map((col) => [col, detectColumnFormat(localRows, col)]));
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

	// Cap text put into the DOM — CSS truncate alone still renders the full
	// string, which freezes the app on multi-MB values.
	const CELL_DISPLAY_MAX = 200;
	const DETAIL_DISPLAY_MAX = 20_000;

	function formatCell(value: unknown): string {
		if (value === null || value === undefined) return '—';
		const s =
			value instanceof Date
				? value.toISOString()
				: typeof value === 'object'
					? JSON.stringify(value)
					: String(value);
		return s.length > CELL_DISPLAY_MAX ? s.slice(0, CELL_DISPLAY_MAX) + '…' : s;
	}

	// ── TanStack Table ────────────────────────────────────────────────────
	// Use accessorFn + id instead of accessorKey to avoid dot-notation path
	// interpretation for columns like "table.column_name".
	const tableColumns = $derived<ColumnDef<Record<string, unknown>>[]>(
		columns.map((col) => ({
			id: col,
			accessorFn: (row: Record<string, unknown>) => row[col]
		}))
	);

	const initialPagination = (() => ({ pageIndex: 0, pageSize }))();
	let pagination = $state<PaginationState>(initialPagination);

	const table = createSvelteTable({
		get data() {
			return rows;
		},
		get columns() {
			return tableColumns;
		},
		state: {
			get pagination() {
				return pagination;
			}
		},
		onPaginationChange(updater) {
			pagination = typeof updater === 'function' ? updater(pagination) : updater;
		},
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel()
	});

	const totalRows = $derived(rows.length);
	const startRow = $derived(pagination.pageIndex * pagination.pageSize + 1);
	const endRow = $derived(
		Math.min(pagination.pageIndex * pagination.pageSize + pagination.pageSize, totalRows)
	);

	// ── Cell detail panel ────────────────────────────────────────────────
	interface SelectedCell {
		col: string;
		value: unknown;
	}
	let selectedCell = $state<SelectedCell | null>(null);
	let copied = $state(false);

	function formatFullValue(value: unknown): string {
		if (value === null || value === undefined) return 'null';
		if (value instanceof Date) return value.toISOString();
		if (typeof value === 'object') return JSON.stringify(value, null, 2);
		return String(value);
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
			const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
			return s.includes(',') || s.includes('"') || s.includes('\n')
				? `"${s.replace(/"/g, '""')}"`
				: s;
		};
		const csv = [columns.join(','), ...rows.map((r) => columns.map((c) => escape(r[c])).join(','))].join('\n');
		const blob = new Blob([csv], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${name}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<div class="flex flex-col gap-2 min-h-0 {fillHeight ? 'h-full' : ''}">
	<div class="flex gap-2 min-h-0 {fillHeight ? 'flex-1' : ''}">
	<div class="flex-1 min-w-0 {fillHeight ? 'min-h-0' : ''}">
		<Table.Root containerClass="overflow-auto rounded-md border {fillHeight ? 'h-full' : 'max-h-125'}">
			<Table.Header>
				{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
					<Table.Row class="border-b-0">
						{#each headerGroup.headers as header, hi (header.id)}
							{@const s = statsMap[header.id]}
							<Table.Head class="border-b p-2 align-top bg-background
								{hi === 0
									? 'sticky top-0 left-0 z-30'
									: 'sticky top-0 z-20'}">
								{#if s && headerInsights === 'full'}
									{@const Icon = formatMap[s.col] ? KIND_ICON[formatMap[s.col].kind] : (s.isNumeric ? Hash : Type)}
									<div class="flex min-w-22.5 flex-col gap-0.5">
										<!-- Type icon + column name + action buttons -->
										<div class="flex items-center gap-1 group/col">
											<Icon class="w-3 h-3 shrink-0 text-muted-foreground" />
											<span class="truncate text-xs font-semibold leading-none flex-1" title={columnDescriptions[s.col] || undefined}>{s.col}</span>
											{#if onColumnDescriptionChange || columnDescriptions[s.col]}
												<div class="relative">
													<button
														class="p-0.5 rounded transition-colors {columnDescriptions[s.col] ? 'text-primary/60' : 'text-muted-foreground/0 group-hover/col:text-muted-foreground/50'} hover:text-primary"
														onclick={(e) => openDescPopover(s.col, e.currentTarget as HTMLElement)}
														title={columnDescriptions[s.col] ? columnDescriptions[s.col] : 'Add column description'}
													>
														<MessageSquare class="w-3 h-3" />
													</button>
													{#if descPopoverCol === s.col}
														<div style="position: fixed; top: {descPopoverTop}px; left: {descPopoverLeft}px; z-index: 200;" class="w-48 rounded border border-border bg-popover p-2 shadow-md">
															<p class="mb-1 text-[10px] font-medium text-muted-foreground">{s.col}</p>
															<textarea
																class="w-full rounded border border-input bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
																rows={3}
																placeholder="Column description…"
																bind:value={descPopoverValue}
																onkeydown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveDescPopover(); if (e.key === 'Escape') { descPopoverCol = null; } }}
															></textarea>
															<div class="mt-1 flex gap-1 justify-end">
																<button class="rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted" onclick={() => { descPopoverCol = null; }}>Cancel</button>
																<button class="rounded bg-primary px-2 py-0.5 text-[10px] text-primary-foreground" onclick={saveDescPopover}>Save</button>
															</div>
														</div>
													{/if}
												</div>
											{/if}
											{#if onAddSort || onAddFilter}
												<div class="flex items-center gap-0.5 shrink-0">
													{#if onAddSort}
														<button
															class="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
															onclick={() => onAddSort?.(s.col, 'asc')}
															aria-label="Sort ascending by {s.col}"
															title="Sort ascending"
														>
															<ArrowUp class="w-3 h-3" />
														</button>
														<button
															class="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
															onclick={() => onAddSort?.(s.col, 'desc')}
															aria-label="Sort descending by {s.col}"
															title="Sort descending"
														>
															<ArrowDown class="w-3 h-3" />
														</button>
													{/if}
													{#if onAddFilter}
														<button
															class="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
															onclick={() => onAddFilter?.(s.col)}
															aria-label="Filter by {s.col}"
															title="Add filter"
														>
															<Filter class="w-3 h-3" />
														</button>
													{/if}
												</div>
											{/if}
										</div>
										<!-- Histogram for numeric columns -->
										{#if s.histBuckets}
											{@const maxBucket = Math.max(...s.histBuckets, 1)}
											<svg
												width="80"
												height="24"
												viewBox="0 0 80 24"
												class="mt-0.5 text-primary opacity-70"
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
												class="flex justify-between text-[9px] leading-none text-muted-foreground"
											>
												<span>Min {fmtNum(s.min!)}</span>
												<span>Max {fmtNum(s.max!)}</span>
											</div>
										{/if}
										<!-- Missing -->
										<div class="text-[10px] leading-none text-muted-foreground">
											Missing: <span class="font-medium"
												>{s.missing} ({pct(s.missing, s.total)})</span
											>
										</div>
										<!-- Distinct -->
										<div class="text-[10px] leading-none text-muted-foreground">
											Distinct: <span class="font-medium"
												>{s.distinct} ({pct(s.distinct, s.total)})</span
											>
										</div>
									</div>
								{:else if !header.isPlaceholder}
									<div class="flex items-center gap-1">
										<span class="truncate text-xs font-semibold leading-none flex-1">{header.id}</span>
										{#if onAddSort || onAddFilter}
											<div class="flex items-center gap-0.5 shrink-0">
												{#if onAddSort}
													<button
														class="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
														onclick={() => onAddSort?.(header.id, 'asc')}
														aria-label="Sort ascending by {header.id}"
														title="Sort ascending"
													>
														<ArrowUp class="w-3 h-3" />
													</button>
													<button
														class="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
														onclick={() => onAddSort?.(header.id, 'desc')}
														aria-label="Sort descending by {header.id}"
														title="Sort descending"
													>
														<ArrowDown class="w-3 h-3" />
													</button>
												{/if}
												{#if onAddFilter}
													<button
														class="p-0.5 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
														onclick={() => onAddFilter?.(header.id)}
														aria-label="Filter by {header.id}"
														title="Add filter"
													>
														<Filter class="w-3 h-3" />
													</button>
												{/if}
											</div>
										{/if}
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
							<Table.Cell
								class="max-w-70 truncate p-2 cursor-pointer hover:bg-muted/50 transition-colors
									{ci === 0 ? 'sticky left-0 z-10 bg-background' : ''}
									{!isNull && (fmt.kind === 'number' || fmt.kind === 'currency' || fmt.kind === 'percentage') ? 'text-right' : ''}"
								onclick={() => { selectedCell = { col: cell.column.id, value }; copied = false; }}
							>
								{#if isNull}
									<span class="font-mono text-xs text-muted-foreground">—</span>
								{:else}
									<FormattedCell {value} format={fmt} plainText={formatCell(value)} />
								{/if}
							</Table.Cell>
						{/each}
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={columns.length} class="h-24 text-center text-sm text-muted-foreground">
							No results.
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>

	<!-- Cell detail panel -->
	{#if selectedCell}
		<div class="w-64 shrink-0 flex flex-col gap-2 rounded-md border bg-card p-3">
			<div class="flex items-center justify-between gap-1">
				<span class="truncate text-xs font-semibold font-mono text-foreground" title={selectedCell.col}>{selectedCell.col}</span>
				<button
					class="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
					onclick={() => { selectedCell = null; copied = false; }}
					aria-label="Close"
				>
					<X class="w-3.5 h-3.5" />
				</button>
			</div>
			<pre class="flex-1 overflow-auto rounded bg-muted p-2 text-xs font-mono whitespace-pre-wrap break-all text-foreground min-h-0 max-h-105">{formatDetailValue(selectedCell.value)}</pre>
			<Button
				variant="outline"
				size="sm"
				class="h-7 w-full gap-1 text-xs"
				onclick={() => copyValue(selectedCell?.value)}
			>
				{#if copied}
					<Check class="w-3 h-3" />
					Copied!
				{:else}
					<Copy class="w-3 h-3" />
					Copy value
				{/if}
			</Button>
		</div>
	{/if}
	</div>

	<!-- Footer: one quiet line — range, optional truncation note, pager, export -->
	<div class="flex items-center justify-between px-1 text-2xs text-muted-foreground">
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
				> · first {totalRows.toLocaleString()} rows</span>
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
					<Select.Trigger class="h-7 w-16 border-transparent text-xs shadow-none hover:border-border" aria-label="Rows per page">
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
				<span class="text-2xs tabular-nums">{pagination.pageIndex + 1} / {table.getPageCount()}</span>
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
			<Button
				variant="ghost"
				size="sm"
				class="h-7 px-2 text-xs gap-1"
				onclick={downloadCSV}
			>
				<Download class="w-3 h-3" />
				Export CSV
			</Button>
		</div>
	</div>
</div>
