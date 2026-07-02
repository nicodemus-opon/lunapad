<script lang="ts">
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Loader2, FileSpreadsheet, CheckCircle2, XCircle } from '@lucide/svelte';
	import { promotePythonCellToSeed, type Cell } from '$lib/stores/notebook.svelte';

	interface Props {
		cell: Cell;
		open: boolean;
	}

	let { cell, open = $bindable() }: Props = $props();

	let relPath = $state('');
	let submitting = $state(false);
	let error = $state<string | null>(null);
	let succeeded = $state(false);

	$effect(() => {
		if (open) {
			relPath = untrack(() => cell.promotedSeedPath) || `seeds/${cell.outputName || cell.id}.csv`;
			error = null;
			succeeded = false;
		}
	});

	async function submit(): Promise<void> {
		submitting = true;
		error = null;
		try {
			await promotePythonCellToSeed(cell.id, relPath.trim());
			succeeded = true;
		} catch (err) {
			error = (err as Error).message ?? String(err);
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm gap-0 overflow-hidden p-0">
		<div class="border-b px-4 py-3">
			<p class="text-xs font-semibold">Promote to dbt seed</p>
			<p class="mt-0.5 text-[11px] text-muted-foreground">
				Writes this cell's last result to a CSV under <span class="font-mono">seeds/</span> — a one-shot
				export, not a live link. Re-running the cell won't update the file; promote again when you want
				a fresh snapshot.
			</p>
		</div>

		<div class="space-y-3 px-4 py-3">
			<div class="space-y-1">
				<label for="seed-path" class="text-[11px] text-muted-foreground">Seed file path</label>
				<Input id="seed-path" class="h-8 font-mono text-xs" bind:value={relPath} />
			</div>

			{#if !cell.result}
				<p class="text-[11px] text-destructive">
					Run this cell first — there's no result to export yet.
				</p>
			{/if}

			{#if succeeded}
				<p class="flex items-center gap-1.5 text-[11px] text-success">
					<CheckCircle2 class="h-3.5 w-3.5" /> Exported to {relPath}
				</p>
			{/if}
			{#if error}
				<p class="flex items-center gap-1.5 text-[11px] text-destructive">
					<XCircle class="h-3.5 w-3.5 shrink-0" />
					{error}
				</p>
			{/if}

			<Button
				class="h-8 w-full text-xs"
				disabled={submitting || !relPath.trim() || !cell.result}
				onclick={submit}
			>
				{#if submitting}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
				{:else}
					<FileSpreadsheet class="h-3.5 w-3.5" />
				{/if}
				{cell.promotedSeedPath ? 'Re-export' : 'Export'}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
