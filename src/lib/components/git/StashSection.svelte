<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { ChevronDown, ChevronRight, Archive, Check, Trash2 } from '@lucide/svelte';
	import {
		gitStashList,
		gitStashSave,
		gitStashApply,
		gitStashPop,
		gitStashDrop
	} from '$lib/services/git-client';
	import type { GitStashEntry } from '$lib/types/git';

	let {
		projectFolder,
		hasChangesToStash,
		onWorkingTreeChanged
	}: {
		projectFolder: string | null;
		hasChangesToStash: boolean;
		onWorkingTreeChanged: () => void;
	} = $props();

	let expanded = $state(false);
	let stashes = $state<GitStashEntry[]>([]);
	let loaded = $state(false);
	let busy = $state(false);

	async function loadStashes() {
		if (!projectFolder) return;
		try {
			stashes = await gitStashList(projectFolder);
			loaded = true;
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to load stashes');
		}
	}

	async function stashChanges() {
		if (!projectFolder || busy) return;
		busy = true;
		try {
			// Untracked files are excluded from a plain `git stash` by default —
			// a common footgun — so this quick action includes them explicitly.
			await gitStashSave(projectFolder, undefined, true);
			toast.success('Changes stashed');
			expanded = true;
			await loadStashes();
			onWorkingTreeChanged();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to stash changes');
		} finally {
			busy = false;
		}
	}

	async function applyStash(index: number) {
		if (!projectFolder || busy) return;
		busy = true;
		try {
			await gitStashApply(projectFolder, index);
			toast.success('Stash applied');
			onWorkingTreeChanged();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to apply stash');
		} finally {
			busy = false;
		}
	}

	async function popStash(index: number) {
		if (!projectFolder || busy) return;
		busy = true;
		try {
			await gitStashPop(projectFolder, index);
			toast.success('Stash popped');
			await loadStashes();
			onWorkingTreeChanged();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to pop stash');
		} finally {
			busy = false;
		}
	}

	async function dropStash(index: number) {
		if (!projectFolder || busy) return;
		busy = true;
		try {
			await gitStashDrop(projectFolder, index);
			toast.success('Stash dropped');
			await loadStashes();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to drop stash');
		} finally {
			busy = false;
		}
	}

	function relativeTime(dateStr: string): string {
		const t = new Date(dateStr).getTime();
		if (Number.isNaN(t)) return '';
		const diffMin = Math.round((Date.now() - t) / 60_000);
		if (diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.round(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		return `${Math.round(diffHr / 24)}d ago`;
	}
</script>

<div class="border-t border-border">
	<div class="sidebar-panel-header">
		<button
			class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
			onclick={() => {
				expanded = !expanded;
				if (expanded && !loaded) void loadStashes();
			}}
		>
			{#if expanded}<ChevronDown
					class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
				/>{:else}<ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{/if}
			<span class="text-2xs font-medium text-muted-foreground"
				>Stashes{loaded && stashes.length > 0 ? ` (${stashes.length})` : ''}</span
			>
		</button>
		<button
			class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground disabled:opacity-40"
			title="Stash changes"
			disabled={busy || !hasChangesToStash}
			onclick={() => void stashChanges()}
		>
			<Archive class="h-3.5 w-3.5" />
		</button>
	</div>
	{#if expanded}
		{#if stashes.length === 0}
			<p class="px-3 py-2 text-2xs text-muted-foreground/60">No stashed changes.</p>
		{:else}
			<div class="max-h-40 overflow-y-auto pb-1">
				{#each stashes as stash (stash.index)}
					<div class="group/row flex items-center gap-1.5 px-3 py-1">
						<div class="min-w-0 flex-1">
							<p class="truncate text-2xs text-foreground">{stash.message}</p>
							<p class="text-3xs text-muted-foreground/60">{relativeTime(stash.date)}</p>
						</div>
						<button
							class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-foreground"
							title="Apply (keep in stash)"
							disabled={busy}
							onclick={() => void applyStash(stash.index)}
						>
							<Check class="h-3 w-3" />
						</button>
						<button
							class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-destructive"
							title="Drop"
							disabled={busy}
							onclick={() => void dropStash(stash.index)}
						>
							<Trash2 class="h-3 w-3" />
						</button>
						<button
							class="shrink-0 rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
							title="Pop (apply and remove from stash)"
							disabled={busy}
							onclick={() => void popStash(stash.index)}
						>
							Pop
						</button>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
