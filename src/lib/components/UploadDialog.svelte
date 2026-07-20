<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Upload, FileUp, Loader2, AlertCircle, CheckCircle2, X } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import {
		registerFile,
		detectFormat,
		sanitizeTableName,
		ACCEPT_ALL_FORMATS,
		executeSQL,
		dropTable,
		type FileFormat
	} from '$lib/services/duckdb';
	import {
		addTable,
		getConnections,
		persistUploadedTableFile,
		attachAndPersistDatabase
	} from '$lib/stores/notebook.svelte';
	import { BUILTIN_DUCKDB_CONNECTION, BUILTIN_DUCKDB_CONNECTION_ID } from '$lib/types/connection';
	import type { Connection } from '$lib/types/connection';

	interface Props {
		open: boolean;
	}

	let { open = $bindable() }: Props = $props();

	const PREVIEW_TABLE = '__upload_preview__';
	const PREVIEW_LIMIT = 5;

	// ── File state ────────────────────────────────────────────────────────────────

	let file = $state<File | null>(null);
	let buffer = $state<ArrayBuffer | null>(null);
	let format = $state<FileFormat | null>(null);
	let dragOver = $state(false);
	let fileInput: HTMLInputElement;

	// ── Config state ──────────────────────────────────────────────────────────────

	let connectionId = $state(BUILTIN_DUCKDB_CONNECTION_ID);
	let tableName = $state('');
	let targetSchema = $state('');
	let mode = $state<'replace' | 'append'>('replace');
	let hasHeader = $state(true);

	// ── Parse results ─────────────────────────────────────────────────────────────

	let previewColumns = $state<string[]>([]);
	let previewRows = $state<unknown[][]>([]);
	let columnTypes = $state<string[]>([]);
	let rowCount = $state(0);
	let parsing = $state(false);
	let parseError = $state('');

	// ── Upload state ──────────────────────────────────────────────────────────────

	let uploading = $state(false);
	let uploadError = $state('');

	// ── Derived ───────────────────────────────────────────────────────────────────

	const connections = $derived(getConnections());
	const selectedConnection = $derived(
		connections.find((c) => c.id === connectionId) ?? BUILTIN_DUCKDB_CONNECTION
	);
	const isExternal = $derived(selectedConnection.type !== 'duckdb-wasm');
	const isCsvLike = $derived(format === 'csv' || format === 'tsv');
	const isDuckDBAttach = $derived(format === 'duckdb');
	const canUpload = $derived(
		!!file && !!tableName.trim() && !parsing && !uploading && (isDuckDBAttach || !parseError)
	);

	// ── Cleanup when dialog closes ────────────────────────────────────────────────

	$effect(() => {
		if (!open) {
			dropTable(PREVIEW_TABLE).catch(() => {});
			resetState();
		}
	});

	function resetState() {
		file = null;
		buffer = null;
		format = null;
		tableName = '';
		targetSchema = '';
		mode = 'replace';
		hasHeader = true;
		previewColumns = [];
		previewRows = [];
		columnTypes = [];
		rowCount = 0;
		parsing = false;
		parseError = '';
		uploading = false;
		uploadError = '';
		connectionId = BUILTIN_DUCKDB_CONNECTION_ID;
	}

	// ── File parsing ──────────────────────────────────────────────────────────────

	async function parseFile() {
		if (!file || !buffer || !format || format === 'duckdb') return;
		parsing = true;
		parseError = '';
		try {
			const {
				rowCount: rc,
				columns,
				columnTypes: types
			} = await registerFile(PREVIEW_TABLE, `__preview_${file.name}`, buffer, format, {
				header: isCsvLike ? hasHeader : true
			});
			rowCount = rc;
			previewColumns = columns;
			columnTypes = types;

			const { rows } = await executeSQL(`SELECT * FROM "${PREVIEW_TABLE}" LIMIT ${PREVIEW_LIMIT}`);
			previewRows = rows.map((row) => columns.map((col) => row[col]));
		} catch (err) {
			parseError = (err as Error).message;
			previewColumns = [];
			previewRows = [];
			columnTypes = [];
			rowCount = 0;
		} finally {
			parsing = false;
		}
	}

	async function handleFile(f: File) {
		const fmt = detectFormat(f.name);
		if (!fmt) {
			toast.error(`Unsupported file type: ${f.name}`);
			return;
		}
		file = f;
		format = fmt;
		tableName = sanitizeTableName(f.name);
		buffer = await f.arrayBuffer();
		// parseFile is triggered by the $effect below when buffer is set
	}

	// Parse whenever a new file is loaded or hasHeader changes (CSV/TSV only)
	$effect(() => {
		if (!file || !buffer || !format) return;
		if (isCsvLike) {
			// eslint-disable-next-line @typescript-eslint/no-unused-expressions
			hasHeader; // track for re-parse on toggle
		}
		parseFile();
	});

	function onFileSelect(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (f) void handleFile(f);
		(e.target as HTMLInputElement).value = '';
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const f = e.dataTransfer?.files[0];
		if (f) void handleFile(f);
	}

	// ── Upload ────────────────────────────────────────────────────────────────────

	async function upload() {
		if (!canUpload) return;
		uploadError = '';
		uploading = true;

		try {
			if (isDuckDBAttach) {
				const alias = tableName.trim();
				await attachAndPersistDatabase(alias, file!.name, buffer!);
				toast.success(`Attached "${alias}" from ${file!.name}`);
			} else if (!isExternal) {
				// DuckDB WASM: re-register with the real table name
				const uploadFileName = `__upload_${file!.name}`;
				const uploadHasHeader = isCsvLike ? hasHeader : true;
				const {
					rowCount: rc,
					columns,
					columnTypes: types
				} = await registerFile(tableName.trim(), uploadFileName, buffer!, format!, {
					header: uploadHasHeader
				});
				const { storage, seedPath } = await persistUploadedTableFile({
					tableName: tableName.trim(),
					fileName: uploadFileName,
					format: format!,
					buffer: buffer!,
					hasHeader: uploadHasHeader
				});
				addTable({
					name: tableName.trim(),
					fileName: file!.name,
					rowCount: rc,
					columns,
					columnTypes: types,
					storage,
					seedPath
				});
				toast.success(`Loaded "${tableName.trim()}" — ${rc.toLocaleString()} rows`);
			} else {
				// External connection: query all rows from preview table
				const { rows: rowObjs } = await executeSQL(`SELECT * FROM "${PREVIEW_TABLE}"`);
				const rowArrays = rowObjs.map((row) => previewColumns.map((col) => row[col]));

				const res = await fetch('/api/connections/upload', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						connection: selectedConnection,
						tableName: tableName.trim(),
						schema: targetSchema.trim() || undefined,
						columns: previewColumns.map((name, i) => ({ name, type: columnTypes[i] })),
						rows: rowArrays,
						mode
					})
				});
				const data = await res.json();
				if (!data.ok) throw new Error(data.error ?? 'Upload failed.');
				toast.success(
					`Uploaded "${tableName.trim()}" — ${(data.rowsInserted as number).toLocaleString()} rows`
				);
			}
			open = false;
		} catch (err) {
			uploadError = (err as Error).message;
		} finally {
			uploading = false;
		}
	}

	function connectionLabel(c: Connection): string {
		if (c.type === 'duckdb-wasm') return 'Built-in DuckDB';
		return c.name;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-w-2xl flex-col gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<Dialog.Title>Upload file</Dialog.Title>
			<Dialog.Description
				>Import CSV, TSV, Parquet, or JSON into any connection — or attach a .duckdb file</Dialog.Description
			>
		</Dialog.Header>

		<div class="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-4">
			<!-- File drop zone -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed transition-[border-color,background-color,box-shadow] duration-(--motion-medium) select-none
					{dragOver
					? 'border-primary bg-primary/10 text-foreground shadow-[inset_0_0_0_3px_oklch(from_var(--primary)_l_c_h/0.08)]'
					: file
						? 'border-border bg-muted/15 text-foreground hover:border-primary'
						: 'surface-inset border-border text-muted-foreground hover:border-primary hover:bg-muted/15'}"
				ondragover={(e) => {
					e.preventDefault();
					dragOver = true;
				}}
				ondragleave={() => {
					dragOver = false;
				}}
				ondrop={onDrop}
				onclick={() => {
					if (!parsing && !uploading) fileInput.click();
				}}
				role="button"
				tabindex="0"
				onkeydown={(e) => {
					if (e.key === 'Enter' && !parsing && !uploading) fileInput.click();
				}}
			>
				{#if file}
					<FileUp class="h-4 w-4 {dragOver ? 'text-primary' : ''}" />
					<span class="text-xs font-medium">{file.name}</span>
					<span class="text-2xs">Click to change file</span>
				{:else}
					<Upload class="h-4 w-4 {dragOver ? 'text-primary' : ''}" />
					<span class="text-xs">Drop file or click to browse</span>
					<span class="text-2xs">csv · tsv · parquet · json · ndjson · duckdb</span>
				{/if}
			</div>

			{#if file && isDuckDBAttach}
				<!-- .duckdb attach flow: just an alias, no connection/schema/mode -->
				<div class="flex flex-col gap-1">
					<label
						for="upload-table-name"
						class="text-2xs font-medium tracking-wide text-muted-foreground uppercase"
						>Attach as</label
					>
					<Input
						id="upload-table-name"
						class="h-7 font-mono text-xs"
						bind:value={tableName}
						placeholder="warehouse"
					/>
					<p class="text-2xs text-muted-foreground">
						Query its tables as <code>{tableName.trim() || 'alias'}.main.table_name</code>
					</p>
				</div>
			{:else if file}
				<!-- Config row 1: Connection + Table name -->
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1">
						<label
							for="upload-connection"
							class="text-2xs font-medium tracking-wide text-muted-foreground uppercase"
							>Connection</label
						>
						<Select.Root type="single" bind:value={connectionId}>
							<Select.Trigger id="upload-connection" class="h-7 text-xs"
								>{connectionLabel(selectedConnection)}</Select.Trigger
							>
							<Select.Content>
								{#each connections as conn (conn.id)}
									<Select.Item value={conn.id} class="text-xs">{connectionLabel(conn)}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<div class="flex flex-col gap-1">
						<label
							for="upload-table-name"
							class="text-2xs font-medium tracking-wide text-muted-foreground uppercase"
							>Table name</label
						>
						<Input
							id="upload-table-name"
							class="h-7 font-mono text-xs"
							bind:value={tableName}
							placeholder="my_table"
						/>
					</div>
				</div>

				<!-- Config row 2: Schema (external only) + Mode -->
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1">
						<label
							for="upload-schema"
							class="text-2xs font-medium tracking-wide text-muted-foreground uppercase"
						>
							Schema {#if !isExternal}<span class="text-muted-foreground/50">(external only)</span
								>{/if}
						</label>
						<Input
							id="upload-schema"
							class="h-7 font-mono text-xs"
							disabled={!isExternal}
							bind:value={targetSchema}
							placeholder={isExternal ? 'public' : 'n/a'}
						/>
					</div>

					<div class="flex flex-col gap-1">
						<span class="text-2xs font-medium tracking-wide text-muted-foreground uppercase"
							>Mode</span
						>
						<div class="flex h-7 items-center gap-4" role="radiogroup" aria-label="Upload mode">
							<label class="flex cursor-pointer items-center gap-1.5 text-xs">
								<input
									type="radio"
									name="upload-mode"
									value="replace"
									bind:group={mode}
									class="accent-primary"
								/>
								Create / Replace
							</label>
							<label class="flex cursor-pointer items-center gap-1.5 text-xs">
								<input
									type="radio"
									name="upload-mode"
									value="append"
									bind:group={mode}
									class="accent-primary"
								/>
								Append
							</label>
						</div>
					</div>
				</div>

				<!-- Header toggle (CSV/TSV only) -->
				{#if isCsvLike}
					<label class="flex cursor-pointer items-center gap-2 text-xs">
						<input type="checkbox" bind:checked={hasHeader} class="accent-primary" />
						First row is header
					</label>
				{/if}

				<!-- Parse status / preview -->
				{#if parsing}
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
						Parsing file…
					</div>
				{:else if parseError}
					<div
						class="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive"
					>
						<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
						{parseError}
					</div>
				{:else if previewColumns.length > 0}
					<div class="flex flex-col gap-1.5">
						<div class="flex items-center justify-between">
							<span class="text-2xs font-medium tracking-wide text-muted-foreground uppercase"
								>Preview</span
							>
							<span class="text-2xs text-muted-foreground"
								>{rowCount.toLocaleString()} rows · {previewColumns.length} columns</span
							>
						</div>
						<div class="overflow-x-auto rounded-md border border-border">
							<table class="w-full text-2xs">
								<thead class="border-b border-border bg-muted/40">
									<tr>
										{#each previewColumns as col}
											<th
												class="px-2 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground"
												>{col}</th
											>
										{/each}
									</tr>
								</thead>
								<tbody>
									{#each previewRows as row, i}
										<tr class={i % 2 === 0 ? '' : 'bg-muted/20'}>
											{#each row as cell}
												<td
													class="max-w-32 overflow-hidden px-2 py-1 font-mono text-ellipsis whitespace-nowrap text-foreground/80"
												>
													{cell === null || cell === undefined ? '' : String(cell)}
												</td>
											{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			{/if}

			<!-- Upload error -->
			{#if file && uploadError}
				<div
					class="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive"
				>
					<AlertCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
					{uploadError}
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<Dialog.Footer>
			<Button variant="ghost" size="sm" class="h-7 text-xs" onclick={() => (open = false)}>
				Cancel
			</Button>
			<Button size="sm" class="h-7 text-xs" disabled={!canUpload} onclick={() => void upload()}>
				{#if uploading}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
					Uploading…
				{:else}
					<Upload class="h-3.5 w-3.5" />
					Upload
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<input
	bind:this={fileInput}
	type="file"
	accept={ACCEPT_ALL_FORMATS}
	class="hidden"
	onchange={onFileSelect}
/>
