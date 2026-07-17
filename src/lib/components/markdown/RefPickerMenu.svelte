<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { AtSign } from '@lucide/svelte';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';

	interface Props {
		entries: MarkdownRefEntry[];
		onSelect: (cellName: string, column: string) => void;
	}

	const { entries, onSelect }: Props = $props();

	let open = $state(false);
	let query = $state('');

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return entries;
		return entries
			.map((e) => ({
				cellName: e.cellName,
				columns: e.columns.filter((c) => `${e.cellName}.${c.name}`.toLowerCase().includes(q))
			}))
			.filter((e) => e.columns.length > 0 || e.cellName.toLowerCase().includes(q));
	});

	function pick(cellName: string, column: string) {
		onSelect(cellName, column);
		open = false;
		query = '';
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="md-refpicker-trigger"
		title="Insert live ref from a cell"
		aria-label="Insert live ref from a cell"
	>
		<AtSign size={12} />
		<span>Insert ref</span>
	</Popover.Trigger>
	<Popover.Content class="md-refpicker-content" align="start">
		<Input bind:value={query} placeholder="Search cell.column…" class="h-7 text-xs" autofocus />
		<div class="md-refpicker-list">
			{#if filtered.length === 0}
				<div class="md-refpicker-empty">No matching cells</div>
			{/if}
			{#each filtered as entry (entry.cellName)}
				{#each entry.columns as column (column.name)}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="md-refpicker-item"
						onclick={() => pick(entry.cellName, column.name)}
					>
						<span class="md-refpicker-cell">{entry.cellName}</span><span class="md-refpicker-dot"
							>.</span
						><span class="md-refpicker-col">{column.name}</span>
					</Button>
				{/each}
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>

<style>
	:global(.md-refpicker-trigger) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.5rem;
		border-radius: 0.395rem;
		font-size: 0.7rem;
		color: var(--muted-foreground);
		background: color-mix(in oklch, currentColor 5%, transparent);
		border: 1px solid var(--border);
		cursor: pointer;
		transition:
			color var(--motion-fast) var(--motion-ease-out),
			background-color var(--motion-fast) var(--motion-ease-out);
	}
	:global(.md-refpicker-trigger:hover) {
		color: var(--foreground);
		background: color-mix(in oklch, currentColor 8%, transparent);
	}
	:global(.md-refpicker-content) {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.4rem;
		width: 16rem;
	}
	.md-refpicker-list {
		max-height: 14rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.md-refpicker-empty {
		font-size: 0.75rem;
		opacity: 0.6;
		padding: 0.4rem 0.3rem;
	}
	:global(.md-refpicker-item) {
		display: flex;
		align-items: baseline;
		gap: 0;
		padding: 0.3rem 0.4rem;
		border-radius: 0.3rem;
		font-size: 0.78rem;
		font-family: var(--font-mono, monospace);
		text-align: left;
		background: none;
		border: none;
		cursor: pointer;
	}
	:global(.md-refpicker-item:hover) {
		background: color-mix(in oklch, currentColor 6%, transparent);
	}
	.md-refpicker-cell {
		font-weight: 600;
	}
	.md-refpicker-dot {
		opacity: 0.5;
	}
	.md-refpicker-col {
		opacity: 0.8;
	}
</style>
