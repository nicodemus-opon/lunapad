<script lang="ts">
	import { untrack } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Loader2, ArrowUpToLine, CheckCircle2, XCircle } from '@lucide/svelte';
	import {
		getPromotionChain,
		promoteCellChain,
		type Cell,
		type CellMaterializationMode,
		type PromotionChainItem
	} from '$lib/stores/notebook.svelte';

	interface Props {
		cell: Cell;
		open: boolean;
	}

	let { cell, open = $bindable() }: Props = $props();

	interface RowState {
		targetRelPath: string;
		materialized: CellMaterializationMode;
		schema: string;
		tags: string;
	}

	let chain = $state<PromotionChainItem[]>([]);
	let rows = $state<Map<string, RowState>>(new Map());
	let submitting = $state(false);
	let result = $state<{ promoted: string[]; errors: string[] } | null>(null);

	$effect(() => {
		if (open) {
			const freshChain = untrack(() => getPromotionChain(cell.id));
			chain = freshChain;
			const freshRows = new Map<string, RowState>();
			for (const { cell: c, suggestedRelPath } of freshChain) {
				freshRows.set(c.id, {
					targetRelPath: suggestedRelPath,
					materialized: c.materializeMode === 'ephemeral' ? 'view' : c.materializeMode,
					schema: c.dbtSchema ?? '',
					tags: c.dbtTags?.join(', ') ?? ''
				});
			}
			rows = freshRows;
			result = null;
			submitting = false;
		}
	});

	const modes: CellMaterializationMode[] = ['view', 'table', 'incremental'];

	function updateRow(cellId: string, patch: Partial<RowState>): void {
		const row = rows.get(cellId);
		if (!row) return;
		rows = new Map(rows).set(cellId, { ...row, ...patch });
	}

	async function submit(): Promise<void> {
		submitting = true;
		result = null;
		try {
			const overrides = new Map(
				[...rows.entries()].map(([id, r]) => [
					id,
					{
						targetRelPath: r.targetRelPath,
						materialized: r.materialized,
						schema: r.schema.trim() || null,
						tags: r.tags
							.split(',')
							.map((t) => t.trim())
							.filter(Boolean)
					}
				])
			);
			const res = await promoteCellChain(cell.id, overrides);
			result = { promoted: res.promoted.map((p) => p.outputName), errors: res.errors };
			if (res.errors.length === 0) {
				open = false;
			}
		} catch (err) {
			result = { promoted: [], errors: [(err as Error).message ?? String(err)] };
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<Dialog.Title>Promote to dbt model</Dialog.Title>
			<Dialog.Description>
				{chain.length > 1
					? `${chain.length} cells will become real model files, wired with {{ ref() }}.`
					: 'This cell will become a real model file.'}
			</Dialog.Description>
		</Dialog.Header>

		<div class="max-h-[70vh] space-y-3 overflow-y-auto px-4 py-3">
			{#each chain as { cell: c } (c.id)}
				{@const row = rows.get(c.id)}
				{#if row}
					<div class="space-y-1.5 rounded border border-border p-2.5">
						<div class="flex items-center justify-between">
							<p class="font-mono text-2xs font-medium">{c.outputName}</p>
							{#if c.id !== cell.id}
								<span class="text-3xs text-muted-foreground">dependency</span>
							{/if}
						</div>
						<Input
							class="h-7 font-mono text-2xs"
							value={row.targetRelPath}
							oninput={(e) =>
								updateRow(c.id, { targetRelPath: (e.target as HTMLInputElement).value })}
							placeholder="models/staging/{c.outputName}"
						/>
						<div class="flex flex-wrap gap-1.5">
							{#each modes as mode}
								<button
									class="rounded border px-2 py-0.5 text-3xs font-medium transition-colors {row.materialized ===
									mode
										? 'border-primary bg-primary/10 text-primary'
										: 'border-border text-muted-foreground hover:bg-accent'}"
									onclick={() => updateRow(c.id, { materialized: mode })}
								>
									{mode}
								</button>
							{/each}
						</div>
						<div class="flex gap-1.5">
							<Input
								class="h-7 text-2xs"
								placeholder="Schema override"
								value={row.schema}
								oninput={(e) => updateRow(c.id, { schema: (e.target as HTMLInputElement).value })}
							/>
							<Input
								class="h-7 text-2xs"
								placeholder="Tags (comma-separated)"
								value={row.tags}
								oninput={(e) => updateRow(c.id, { tags: (e.target as HTMLInputElement).value })}
							/>
						</div>
					</div>
				{/if}
			{/each}

			{#if result}
				<div class="space-y-1">
					{#if result.promoted.length > 0}
						<p class="flex items-center gap-1.5 text-2xs text-success">
							<CheckCircle2 class="h-3.5 w-3.5" /> Promoted: {result.promoted.join(', ')}
						</p>
					{/if}
					{#each result.errors as err}
						<p class="flex items-center gap-1.5 text-2xs text-destructive">
							<XCircle class="h-3.5 w-3.5 shrink-0" />
							{err}
						</p>
					{/each}
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="ghost" size="sm" class="h-8 text-xs" onclick={() => (open = false)}>
				Cancel
			</Button>
			<Button
				size="sm"
				class="h-8 text-xs"
				disabled={submitting || chain.length === 0}
				onclick={submit}
			>
				{#if submitting}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
				{:else}
					<ArrowUpToLine class="h-3.5 w-3.5" />
				{/if}
				Promote {chain.length > 1 ? `${chain.length} cells` : 'cell'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
