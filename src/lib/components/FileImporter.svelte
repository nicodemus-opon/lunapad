<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { FileUp, Link, Loader2, X } from '@lucide/svelte';
	import {
		registerFile,
		detectFormat,
		sanitizeTableName,
		persistUploadedFile,
		ACCEPT_ALL_FORMATS,
		type FileFormat
	} from '$lib/services/duckdb';
	import { addTable } from '$lib/stores/notebook.svelte';

	let dragOver = $state(false);
	let dragCount = $state(0);
	let loading = $state(false);
	let importCount = $state(0);
	let showUrl = $state(false);
	let urlInput = $state('');
	let fileInput: HTMLInputElement;

	async function importBuffer(fileName: string, buffer: ArrayBuffer, format: FileFormat) {
		const tableName = sanitizeTableName(fileName);
		const { rowCount, columns, columnTypes } = await registerFile(
			tableName,
			fileName,
			buffer,
			format
		);
		await persistUploadedFile({ tableName, fileName, format, buffer, hasHeader: true });
		addTable({ name: tableName, fileName, rowCount, columns, columnTypes });
		return { tableName, rowCount };
	}

	async function handleFiles(files: File[]) {
		const valid: File[] = [];
		const skipped: string[] = [];
		for (const f of files) {
			if (detectFormat(f.name)) valid.push(f);
			else skipped.push(f.name);
		}
		if (skipped.length)
			toast.error(`Skipped ${skipped.length} unsupported file(s): ${skipped.join(', ')}`);
		if (!valid.length) return;

		loading = true;
		importCount = valid.length;
		let ok = 0;
		for (const file of valid) {
			try {
				const buffer = await file.arrayBuffer();
				const { tableName, rowCount } = await importBuffer(
					file.name,
					buffer,
					detectFormat(file.name)!
				);
				if (valid.length === 1)
					toast.success(`Loaded "${tableName}" — ${rowCount.toLocaleString()} rows`);
				ok++;
			} catch (err) {
				toast.error(`"${file.name}": ${(err as Error).message}`);
			}
		}
		if (ok > 1) toast.success(`Imported ${ok} files`);
		loading = false;
		importCount = 0;
	}

	async function handleURL() {
		const url = urlInput.trim();
		if (!url) return;
		const fileName = url.split('/').at(-1)?.split('?')[0] ?? 'data';
		const format = detectFormat(fileName);
		if (!format) {
			toast.error(
				'Cannot detect format from URL — ensure the URL ends with a supported extension.'
			);
			return;
		}
		loading = true;
		importCount = 1;
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
			const buffer = await res.arrayBuffer();
			const { tableName, rowCount } = await importBuffer(fileName, buffer, format);
			toast.success(`Loaded "${tableName}" — ${rowCount.toLocaleString()} rows`);
			urlInput = '';
			showUrl = false;
		} catch (err) {
			toast.error(`Import failed: ${(err as Error).message}`);
		} finally {
			loading = false;
			importCount = 0;
		}
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
		dragCount = e.dataTransfer?.items.length ?? 0;
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		dragCount = 0;
		const files = [...(e.dataTransfer?.files ?? [])];
		if (files.length) void handleFiles(files);
	}

	function onFileSelect(e: Event) {
		const files = [...((e.target as HTMLInputElement).files ?? [])];
		if (files.length) void handleFiles(files);
		(e.target as HTMLInputElement).value = '';
	}
</script>

<!-- Always-visible compact import area -->
<div class="mx-2 mt-1 mb-1.5 shrink-0">
	<!-- Drop / click zone -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-dashed px-2 transition-colors select-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none
			{dragOver
			? 'border-primary bg-primary/8 text-foreground'
			: 'border-border/50 text-muted-foreground hover:border-primary/50 hover:bg-muted/30 hover:text-foreground'}"
		ondragover={onDragOver}
		ondragleave={() => {
			dragOver = false;
			dragCount = 0;
		}}
		ondrop={onDrop}
		onclick={() => {
			if (!loading) fileInput.click();
		}}
		role="button"
		tabindex="0"
		onkeydown={(e) => {
			if (e.key === 'Enter' && !loading) fileInput.click();
		}}
	>
		{#if loading}
			<Loader2 class="h-3 w-3 shrink-0 animate-spin" />
			<span class="flex-1 text-2xs">
				{importCount > 1 ? `Importing ${importCount} files…` : 'Importing…'}
			</span>
		{:else if dragOver}
			<FileUp class="h-3 w-3 shrink-0 text-primary" />
			<span class="flex-1 text-2xs">
				{dragCount > 1 ? `Drop ${dragCount} files` : 'Drop file to import'}
			</span>
		{:else}
			<FileUp class="h-3 w-3 shrink-0" />
			<span class="flex-1 text-2xs">Import files…</span>
			<button
				class="rounded-md px-1.5 py-0.5 text-2xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none {showUrl
					? 'bg-muted text-foreground'
					: 'hover:bg-muted/60'}"
				onclick={(e) => {
					e.stopPropagation();
					showUrl = !showUrl;
				}}
				title="Import from URL"
			>
				URL
			</button>
		{/if}
	</div>

	<!-- Format hint -->
	<p class="mt-0.5 px-0.5 text-2xs text-muted-foreground/60">csv · tsv · parquet · json · ndjson</p>

	<!-- URL input (shown when URL button clicked) -->
	{#if showUrl && !loading}
		<div class="mt-1 flex gap-1">
			<input
				class="min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 py-1 font-mono text-2xs transition-colors placeholder:text-muted-foreground/60 focus:border-ring/60 focus:ring-2 focus:ring-ring/30 focus:outline-none"
				placeholder="https://…/data.parquet"
				bind:value={urlInput}
				onkeydown={(e) => {
					if (e.key === 'Enter') void handleURL();
					if (e.key === 'Escape') {
						showUrl = false;
						urlInput = '';
					}
				}}
			/>
			<button
				class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-40"
				onclick={() => void handleURL()}
				disabled={!urlInput.trim()}
				title="Fetch and import"
			>
				<Link class="h-3 w-3" />
			</button>
			<button
				class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
				onclick={() => {
					showUrl = false;
					urlInput = '';
				}}
				title="Cancel"
			>
				<X class="h-3 w-3" />
			</button>
		</div>
	{/if}
</div>

<input
	bind:this={fileInput}
	type="file"
	multiple
	accept={ACCEPT_ALL_FORMATS}
	class="hidden"
	onchange={onFileSelect}
/>
