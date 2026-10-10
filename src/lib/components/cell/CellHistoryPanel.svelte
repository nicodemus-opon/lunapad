<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Pencil, History, Undo2 } from '@lucide/svelte';
	import { relativeTime, type CellRevision } from '$lib/services/cell-history';

	let {
		open = $bindable(false),
		cellName,
		revisions,
		revertingId = null,
		onRevert
	}: {
		open?: boolean;
		cellName: string;
		revisions: CellRevision[];
		revertingId?: string | null;
		onRevert: (revision: CellRevision) => void;
	} = $props();

	// Tick every 30s so "x minutes ago" stays fresh while open.
	let now = $state(Date.now());
	$effect(() => {
		if (!open) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="flex max-h-[85vh] w-full max-w-md flex-col gap-0 overflow-hidden p-0"
		aria-label={`History of ${cellName || 'cell'}`}
	>
		<Dialog.Header class="shrink-0 px-5 pt-5 pb-0">
			<Dialog.Title class="text-base">Info</Dialog.Title>
			<!-- Metabase Info panel tabs: History is the implemented one. -->
			<div
				class="mt-2 flex gap-4 border-b border-border text-sm"
				role="tablist"
				aria-label="Info sections"
			>
				<span class="cursor-not-allowed px-0.5 pb-2 text-muted-foreground/60" title="Coming soon">
					Overview
				</span>
				<span
					role="tab"
					aria-selected="true"
					class="-mb-px border-b-2 border-primary px-0.5 pb-2 font-medium text-primary"
				>
					History
				</span>
				<span class="cursor-not-allowed px-0.5 pb-2 text-muted-foreground/60" title="Coming soon">
					Relationships
				</span>
				<span class="cursor-not-allowed px-0.5 pb-2 text-muted-foreground/60" title="Coming soon">
					Insights
				</span>
			</div>
		</Dialog.Header>

		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			{#if revisions.length === 0}
				<div class="flex flex-col items-center gap-2 py-10 text-center">
					<History class="h-6 w-6 text-muted-foreground/50" />
					<p class="text-sm text-muted-foreground">No history yet.</p>
					<p class="max-w-60 text-xs text-muted-foreground/70">
						A version is saved automatically each time you edit this cell.
					</p>
				</div>
			{:else}
				<ol class="relative ml-3 border-l border-dotted border-border pl-0">
					{#each revisions as rev (rev.id)}
						<li class="relative flex items-start gap-3 py-3 pl-6">
							<span
								class="absolute top-3 -left-[13px] flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background"
								aria-hidden="true"
							>
								<Pencil class="h-3 w-3 text-muted-foreground" />
							</span>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium text-foreground">
									{rev.actor}
									{rev.label}.
								</p>
								<p class="mt-0.5 text-xs text-muted-foreground">{relativeTime(rev.ts, now)}</p>
							</div>
							<button
								type="button"
								class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
								title="Revert to this version"
								aria-label="Revert to version from {relativeTime(rev.ts, now)}"
								disabled={revertingId === rev.id}
								onclick={() => onRevert(rev)}
							>
								<Undo2 class="h-3.5 w-3.5" />
							</button>
						</li>
					{/each}
				</ol>
				<p class="mt-2 text-center text-xs text-muted-foreground/60">
					Showing up to 15 recent versions.
				</p>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
