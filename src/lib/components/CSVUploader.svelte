<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { registerCSV } from '$lib/services/duckdb';
	import { addTable } from '$lib/stores/notebook.svelte';
	import { toast } from 'svelte-sonner';
	import { Upload } from '@lucide/svelte';

	interface Props {
		compact?: boolean;
	}

	let { compact = false }: Props = $props();

	let dragOver = $state(false);
	let uploading = $state(false);
	let fileInput: HTMLInputElement;

	export function trigger() {
		fileInput?.click();
	}

	async function handleFile(file: File) {
		if (!file.name.endsWith('.csv')) {
			toast.error('Only .csv files are supported');
			return;
		}
		uploading = true;
		try {
			const buffer = await file.arrayBuffer();
			// Sanitize table name: remove extension, replace non-alphanumeric with _
			const tableName = file.name
				.replace(/\.csv$/i, '')
				.replace(/[^a-zA-Z0-9_]/g, '_')
				.replace(/^([0-9])/, '_$1');

			const { rowCount, columns, columnTypes } = await registerCSV(tableName, buffer);
			addTable({
				name: tableName,
				fileName: file.name,
				rowCount,
				columns,
				columnTypes
			});
			toast.success(`Loaded "${tableName}" — ${rowCount.toLocaleString()} rows, ${columns.length} columns`);
		} catch (err: unknown) {
			toast.error(`Failed to load CSV: ${(err as Error).message}`);
		} finally {
			uploading = false;
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		const file = e.dataTransfer?.files[0];
		if (file) handleFile(file);
	}

	function onFileSelect(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) handleFile(file);
		// Reset so same file can be re-uploaded
		(e.target as HTMLInputElement).value = '';
	}
</script>

{#if compact}
	<Button
		variant="ghost"
		size="sm"
		class="h-7 w-7 p-0"
		onclick={() => fileInput.click()}
		title={uploading ? 'Uploading CSV...' : 'Upload CSV'}
		disabled={uploading}
	>
		{#if uploading}
			<Skeleton class="h-3.5 w-3.5 rounded-full" />
		{:else}
			<Upload class="w-3.5 h-3.5" />
		{/if}
	</Button>
{:else}
	<!-- Drop zone -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 transition-colors cursor-pointer
			{dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-muted/30'}"
		ondragover={(e) => { e.preventDefault(); dragOver = true; }}
		ondragleave={() => (dragOver = false)}
		ondrop={onDrop}
		onclick={() => fileInput.click()}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Enter' && fileInput.click()}
		aria-label="Upload CSV file"
	>
		{#if uploading}
			<Skeleton class="h-4 w-4 rounded-full" />
			<span class="text-xs text-muted-foreground">Loading…</span>
		{:else}
			<Upload class="w-3.5 h-3.5 text-muted-foreground" />
			<span class="text-xs text-muted-foreground">
				{#if dragOver}
					Drop CSV here
				{:else}
					Upload CSV
				{/if}
			</span>
		{/if}
	</div>
{/if}

<input
	bind:this={fileInput}
	type="file"
	accept=".csv"
	class="hidden"
	onchange={onFileSelect}
/>
