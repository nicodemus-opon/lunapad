<script lang="ts">
	import { GitBranch, ArrowUp, ArrowDown, FolderGit2, Loader2 } from '@lucide/svelte';
	import { getRawGitStatus, refreshGitStatus } from '$lib/stores/git.svelte';
	import {
		getActiveNotebookRunningCount,
		getActiveNotebookStaleCount,
		getCells,
		runAllStale
	} from '$lib/stores/notebook.svelte';
	import type { Connection } from '$lib/types/connection';
	import { BUILTIN_DUCKDB_CONNECTION_ID } from '$lib/types/connection';
	import CellStatusChip from '$lib/components/cell/CellStatusChip.svelte';

	let {
		projectFolder,
		onOpenGitPanel,
		showNotebookStatus = false,
		connections = [],
		defaultConnectionId = null,
		reportView = false
	}: {
		projectFolder: string | null;
		onOpenGitPanel: () => void;
		showNotebookStatus?: boolean;
		connections?: Connection[];
		defaultConnectionId?: string | null;
		reportView?: boolean;
	} = $props();

	// Mirrors GitPanel's own refresh effect so the status bar has data even if
	// the user has never opened the Git sidebar panel this session.
	$effect(() => {
		if (projectFolder) void refreshGitStatus(projectFolder);
	});

	const status = $derived(getRawGitStatus());
	const dirtyCount = $derived.by(() => {
		const s = status;
		if (!s?.isRepo) return 0;
		return s.staged.length + s.unstaged.length + s.untracked.length;
	});

	const cells = $derived(getCells());
	const runningCount = $derived(getActiveNotebookRunningCount());
	const staleCount = $derived(getActiveNotebookStaleCount());
	const connectionLabel = $derived.by(() => {
		const id = defaultConnectionId ?? BUILTIN_DUCKDB_CONNECTION_ID;
		return connections.find((c) => c.id === id)?.name ?? 'DuckDB (built-in)';
	});
</script>

<div
	class="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-muted/20 px-3 text-2xs text-muted-foreground select-none"
	role="status"
	aria-live="polite"
>
	{#if showNotebookStatus}
		<span class="min-w-0 truncate font-mono" title="Default connection">{connectionLabel}</span>

		<span class="shrink-0 font-mono tabular-nums">
			{#if runningCount > 0}
				<span class="inline-flex items-center gap-1 text-foreground">
					<Loader2 class="h-3 w-3 animate-spin" />
					Running {runningCount}
				</span>
			{:else}
				Idle
			{/if}
		</span>

		<span class="flex shrink-0 items-center gap-1.5 font-mono tabular-nums">
			{cells.length} cell{cells.length === 1 ? '' : 's'}
			{#if staleCount > 0 && !reportView}
				<span class="text-muted-foreground/50">·</span>
				<CellStatusChip
					tone="warning"
					ariaLabel="Run all stale cells"
					onclick={() => void runAllStale()}
				>
					{#snippet label()}
						{staleCount} stale
					{/snippet}
				</CellStatusChip>
			{/if}
		</span>
	{/if}

	<span class="flex-1"></span>

	{#if status?.isRepo}
		<button
			class="-my-1 flex h-7 shrink-0 items-center gap-3 px-2 transition-colors hover:bg-muted/40 hover:text-foreground"
			onclick={onOpenGitPanel}
			title="Open source control"
		>
			<span class="flex items-center gap-1">
				<GitBranch class="h-3 w-3" />
				{status.branch ?? 'detached'}
			</span>
			{#if status.ahead > 0 || status.behind > 0}
				<span class="flex items-center gap-1.5">
					{#if status.ahead > 0}<span class="flex items-center"
							><ArrowUp class="h-2.5 w-2.5" />{status.ahead}</span
						>{/if}
					{#if status.behind > 0}<span class="flex items-center"
							><ArrowDown class="h-2.5 w-2.5" />{status.behind}</span
						>{/if}
				</span>
			{/if}
			{#if dirtyCount > 0}
				<span class="flex items-center gap-1">
					<span class="h-1.5 w-1.5 rounded-full bg-warning"></span>
					{dirtyCount} change{dirtyCount === 1 ? '' : 's'}
				</span>
			{/if}
		</button>
	{:else if status && !status.isRepo}
		<button
			class="-my-1 flex h-7 shrink-0 items-center gap-1.5 px-2 text-muted-foreground/60 transition-colors hover:bg-muted/40 hover:text-foreground"
			onclick={onOpenGitPanel}
			title="Not a git repository — open source control to initialize"
		>
			<FolderGit2 class="h-3 w-3" />
			No repository
		</button>
	{/if}
</div>
