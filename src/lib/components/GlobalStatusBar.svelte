<script lang="ts">
	import { GitBranch, ArrowUp, ArrowDown, FolderGit2 } from '@lucide/svelte';
	import { getRawGitStatus, refreshGitStatus } from '$lib/stores/git.svelte';

	let {
		projectFolder,
		onOpenGitPanel
	}: { projectFolder: string | null; onOpenGitPanel: () => void } = $props();

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
</script>

{#if status?.isRepo}
	<button
		class="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-muted/20 px-3 text-2xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
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
		class="flex h-6 shrink-0 items-center gap-1.5 border-t border-border bg-muted/20 px-3 text-2xs text-muted-foreground/60 transition-colors hover:bg-muted/40 hover:text-foreground"
		onclick={onOpenGitPanel}
		title="Not a git repository — open source control to initialize"
	>
		<FolderGit2 class="h-3 w-3" />
		No repository
	</button>
{/if}
