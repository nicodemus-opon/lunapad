<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		GitBranch,
		ChevronDown,
		ChevronRight,
		ArrowUp,
		ArrowDown,
		RefreshCcw,
		X,
		Plus,
		Minus,
		ExternalLink,
		GitCommit,
		Loader2,
		FolderGit2
	} from '@lucide/svelte';
	import { getProjectFolder } from '$lib/stores/notebook.svelte';
	import {
		gitStatus,
		gitBranches,
		gitLog,
		gitStage,
		gitUnstage,
		gitDiscard,
		gitCommit,
		gitCheckout,
		gitInit,
		gitPush,
		gitPull,
		gitFetch,
		gitDiff,
		gitGetRemote,
		watchGitLogs
	} from '$lib/services/git-client';
	import type {
		GitStatus,
		GitBranches,
		GitCommitLogEntry,
		GitFileStatus,
		GitRemoteInfo
	} from '$lib/types/git';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import EmptyState from '$lib/components/sidebar/EmptyState.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import GitStatusBadge from '$lib/components/git/GitStatusBadge.svelte';
	import GitDiffView from '$lib/components/git/GitDiffView.svelte';

	const projectFolder = $derived(getProjectFolder());

	let status = $state<GitStatus | null>(null);
	let remote = $state<GitRemoteInfo | null>(null);
	let loadingStatus = $state(false);
	let commitMessage = $state('');
	let busy = $state(false);

	let branchesExpanded = $state(false);
	let branches = $state<GitBranches | null>(null);
	let newBranchName = $state('');

	let logExpanded = $state(false);
	let commits = $state<GitCommitLogEntry[]>([]);

	let expandedPath = $state<string | null>(null);
	let expandedDiff = $state('');
	let expandedDiffLoading = $state(false);

	let logLines = $state<string[]>([]);
	let logHeader = $state('');
	let logOpen = $state(false);
	let exitCode = $state<number | null>(null);
	let logUnsubscribe: (() => void) | null = null;

	let discardTarget = $state<{ paths: string[]; untracked: boolean } | null>(null);
	let discardConfirmOpen = $state(false);

	async function refresh() {
		if (!projectFolder) return;
		loadingStatus = true;
		try {
			const [s, r] = await Promise.all([gitStatus(projectFolder), gitGetRemote(projectFolder)]);
			status = s;
			remote = r;
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to load git status');
		} finally {
			loadingStatus = false;
		}
	}

	async function loadBranches() {
		if (!projectFolder) return;
		try {
			branches = await gitBranches(projectFolder);
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to load branches');
		}
	}

	async function loadLog() {
		if (!projectFolder) return;
		try {
			commits = await gitLog(projectFolder, undefined, 20);
		} catch {
			commits = [];
		}
	}

	$effect(() => {
		if (projectFolder) void refresh();
	});

	function relativeTime(dateStr: string): string {
		const diffMs = Date.now() - new Date(dateStr).getTime();
		const diffMin = Math.round(diffMs / 60_000);
		if (diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.round(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		return `${Math.round(diffHr / 24)}d ago`;
	}

	function watchJobAsPromise(jobId: string, label: string): Promise<number> {
		return new Promise((resolve) => {
			logHeader = label;
			logLines = [];
			exitCode = null;
			logOpen = true;
			logUnsubscribe?.();
			logUnsubscribe = watchGitLogs(
				jobId,
				(line) => {
					logLines = [...logLines, line];
				},
				(code) => {
					exitCode = code;
					resolve(code);
				}
			);
		});
	}

	async function toggleStage(file: GitFileStatus, currentlyStaged: boolean) {
		if (!projectFolder) return;
		try {
			if (currentlyStaged) await gitUnstage(projectFolder, [file.path]);
			else await gitStage(projectFolder, [file.path]);
			await refresh();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to update staging');
		}
	}

	async function stageUntracked(path: string) {
		if (!projectFolder) return;
		try {
			await gitStage(projectFolder, [path]);
			await refresh();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to stage file');
		}
	}

	async function stageAllUntracked() {
		if (!projectFolder || !status?.untracked.length) return;
		try {
			await gitStage(projectFolder, status.untracked);
			await refresh();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to stage files');
		}
	}

	function confirmDiscard(paths: string[], untracked: boolean) {
		discardTarget = { paths, untracked };
		discardConfirmOpen = true;
	}

	async function performDiscard() {
		if (!projectFolder || !discardTarget) return;
		try {
			await gitDiscard(projectFolder, discardTarget.paths, discardTarget.untracked);
			toast.success('Changes discarded');
			await refresh();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to discard changes');
		}
	}

	async function toggleDiff(file: { path: string; staged: boolean; untracked?: boolean }) {
		if (expandedPath === file.path) {
			expandedPath = null;
			return;
		}
		expandedPath = file.path;
		expandedDiffLoading = true;
		expandedDiff = '';
		try {
			expandedDiff = await gitDiff(projectFolder!, file.path, {
				staged: file.staged,
				untracked: file.untracked
			});
		} catch (err) {
			expandedDiff = `Error loading diff: ${(err as Error).message}`;
		} finally {
			expandedDiffLoading = false;
		}
	}

	async function commitOnly() {
		if (!projectFolder || !commitMessage.trim() || !status?.staged.length) return;
		busy = true;
		try {
			await gitCommit(projectFolder, commitMessage);
			commitMessage = '';
			toast.success('Committed');
			await Promise.all([refresh(), loadLog()]);
		} catch (err) {
			toast.error((err as Error).message ?? 'Commit failed');
		} finally {
			busy = false;
		}
	}

	async function commitAndSync() {
		if (!projectFolder || !commitMessage.trim() || !status?.staged.length) return;
		busy = true;
		try {
			await gitCommit(projectFolder, commitMessage);
			commitMessage = '';
			toast.success('Committed');

			if (status.behind > 0) {
				const pullJobId = await gitPull(projectFolder);
				const pullCode = await watchJobAsPromise(pullJobId, 'Pull');
				if (pullCode !== 0) {
					toast.error('Pull failed — resolve conflicts before pushing');
					await Promise.all([refresh(), loadLog()]);
					return;
				}
			}

			const pushJobId = await gitPush(projectFolder);
			const pushCode = await watchJobAsPromise(pushJobId, 'Push');
			if (pushCode === 0) toast.success('Pushed');
			else toast.error(`Push failed (exit ${pushCode})`);
		} catch (err) {
			toast.error((err as Error).message ?? 'Commit & sync failed');
		} finally {
			busy = false;
			await Promise.all([refresh(), loadLog()]);
		}
	}

	async function doPush(force = false) {
		if (!projectFolder) return;
		busy = true;
		try {
			const jobId = await gitPush(projectFolder, force);
			const code = await watchJobAsPromise(jobId, force ? 'Force push' : 'Push');
			if (code === 0) toast.success('Pushed');
			else toast.error(`Push failed (exit ${code})`);
		} catch (err) {
			toast.error((err as Error).message ?? 'Push failed');
		} finally {
			busy = false;
			await refresh();
		}
	}

	async function doPull() {
		if (!projectFolder) return;
		busy = true;
		try {
			const jobId = await gitPull(projectFolder);
			const code = await watchJobAsPromise(jobId, 'Pull');
			if (code === 0) toast.success('Pulled');
			else toast.error(`Pull failed (exit ${code}) — check for conflicts`);
		} catch (err) {
			toast.error((err as Error).message ?? 'Pull failed');
		} finally {
			busy = false;
			await refresh();
		}
	}

	async function doFetch() {
		if (!projectFolder) return;
		busy = true;
		try {
			const jobId = await gitFetch(projectFolder);
			await watchJobAsPromise(jobId, 'Fetch');
		} catch (err) {
			toast.error((err as Error).message ?? 'Fetch failed');
		} finally {
			busy = false;
			await refresh();
		}
	}

	async function switchBranch(name: string) {
		if (!projectFolder) return;
		try {
			await gitCheckout(projectFolder, name.replace(/^remotes\/[^/]+\//, ''), false);
			branchesExpanded = false;
			await Promise.all([refresh(), loadBranches()]);
			toast.success(`Switched to ${name}`);
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to switch branches');
		}
	}

	async function createBranch() {
		if (!projectFolder || !newBranchName.trim()) return;
		try {
			await gitCheckout(projectFolder, newBranchName.trim(), true);
			newBranchName = '';
			branchesExpanded = false;
			await Promise.all([refresh(), loadBranches()]);
			toast.success('Branch created');
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to create branch');
		}
	}

	async function doInit() {
		if (!projectFolder) return;
		busy = true;
		try {
			await gitInit(projectFolder);
			toast.success('Repository initialized');
			await refresh();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to initialize repository');
		} finally {
			busy = false;
		}
	}

	/** Builds a host-appropriate "open a PR" deep link from the remote URL — no
	 *  API scopes beyond what push already needs, just a compare-view URL. */
	function buildPrUrl(remoteUrl: string, base: string, branch: string): string | null {
		const match = remoteUrl.match(/(?:git@|https:\/\/)([^/:]+)[:/](.+?)(?:\.git)?$/);
		if (!match) return null;
		const host = match[1];
		const repoPath = match[2];
		if (host.includes('github.com'))
			return `https://${host}/${repoPath}/compare/${base}...${branch}?expand=1`;
		if (host.includes('gitlab.com'))
			return `https://${host}/${repoPath}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}&merge_request%5Btarget_branch%5D=${encodeURIComponent(base)}`;
		if (host.includes('dev.azure.com') || host.includes('visualstudio.com'))
			return `https://${host}/${repoPath}/pullrequestcreate?sourceRef=${encodeURIComponent(branch)}&targetRef=${encodeURIComponent(base)}`;
		return null;
	}

	const prUrl = $derived.by(() => {
		if (!remote || !status?.branch || status.ahead === 0) return null;
		return buildPrUrl(remote.remoteUrl, remote.defaultBranch, status.branch);
	});
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	<!-- Header -->
	<div class="sidebar-panel-header">
		<button
			class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
			onclick={() => {
				branchesExpanded = !branchesExpanded;
				if (branchesExpanded && !branches) void loadBranches();
			}}
			disabled={!status?.isRepo}
		>
			<GitBranch class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<span class="min-w-0 flex-1 truncate text-2xs font-medium text-muted-foreground">
				{status?.isRepo ? (status.branch ?? 'detached') : 'Source control'}
			</span>
			{#if status?.isRepo && (status.ahead > 0 || status.behind > 0)}
				<span class="ml-1 flex shrink-0 items-center gap-0.5 text-2xs text-muted-foreground">
					{#if status.ahead > 0}<span class="flex items-center"
							><ArrowUp class="h-2.5 w-2.5" />{status.ahead}</span
						>{/if}
					{#if status.behind > 0}<span class="flex items-center"
							><ArrowDown class="h-2.5 w-2.5" />{status.behind}</span
						>{/if}
				</span>
			{/if}
		</button>
		{#if status?.isRepo}
			<div class="flex items-center gap-0.5">
				<button
					class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground disabled:opacity-40"
					title="Fetch"
					disabled={busy}
					onclick={() => void doFetch()}
				>
					{#if busy}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<RefreshCcw
							class="h-3.5 w-3.5"
						/>{/if}
				</button>
				<button
					class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground disabled:opacity-40"
					title="Pull"
					disabled={busy || !status.hasRemote}
					onclick={() => void doPull()}
				>
					<ArrowDown class="h-3.5 w-3.5" />
				</button>
				<button
					class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground disabled:opacity-40"
					title="Push"
					disabled={busy || !status.hasRemote}
					onclick={() => void doPush(false)}
				>
					<ArrowUp class="h-3.5 w-3.5" />
				</button>
			</div>
		{/if}
	</div>

	{#if branchesExpanded && status?.isRepo}
		<div class="border-b border-border px-2 py-2">
			<div class="mb-1.5 max-h-32 overflow-y-auto">
				{#if branches}
					{#each branches.branches.filter((b) => !b.isRemote) as b}
						<button
							class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-2xs hover:bg-accent {b.current
								? 'text-foreground'
								: 'text-muted-foreground'}"
							onclick={() => void switchBranch(b.name)}
						>
							{#if b.current}<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-chart-1"
								></span>{:else}<span class="w-1.5"></span>{/if}
							{b.name}
						</button>
					{/each}
				{/if}
			</div>
			<div class="flex gap-1">
				<input
					class="w-full rounded border border-input bg-background px-2 py-1 font-mono text-2xs placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
					placeholder="New branch name"
					bind:value={newBranchName}
					onkeydown={(e) => e.key === 'Enter' && createBranch()}
				/>
				<button
					class="shrink-0 rounded border border-border px-2 text-2xs hover:bg-accent disabled:opacity-40"
					disabled={!newBranchName.trim()}
					onclick={() => void createBranch()}
				>
					<Plus class="h-3 w-3" />
				</button>
			</div>
		</div>
	{/if}

	<div class="min-h-0 flex-1 overflow-y-auto pb-2">
		{#if loadingStatus && !status}
			<div class="flex justify-center py-6">
				<Loader2 class="h-4 w-4 animate-spin text-muted-foreground" />
			</div>
		{:else if !status?.isRepo}
			<EmptyState description="This folder isn't a git repository yet.">
				{#snippet icon()}
					<FolderGit2 class="h-4 w-4" />
				{/snippet}
				{#snippet actions()}
					<button
						class="rounded border border-border bg-background px-2 py-1 text-2xs transition-colors hover:bg-accent disabled:opacity-40"
						disabled={busy}
						onclick={() => void doInit()}
					>
						Initialize repository
					</button>
				{/snippet}
			</EmptyState>
		{:else}
			<!-- Commit box -->
			{#if status.staged.length > 0}
				<div class="border-b border-border px-2 py-2">
					<textarea
						class="w-full resize-none rounded border border-input bg-background px-2 py-1.5 text-2xs placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
						rows="2"
						placeholder="Commit message"
						bind:value={commitMessage}
					></textarea>
					<div class="mt-1.5 flex gap-1">
						<button
							class="flex flex-1 items-center justify-center gap-1.5 rounded border border-border bg-primary px-2 py-1 text-2xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
							disabled={busy || !commitMessage.trim()}
							onclick={() => void commitAndSync()}
						>
							{#if busy}<Loader2 class="h-3 w-3 animate-spin" />{:else}<GitCommit
									class="h-3 w-3"
								/>{/if}
							{status.behind > 0 ? 'Pull, commit & sync' : 'Commit and sync'}
						</button>
						<button
							class="shrink-0 rounded border border-border bg-background px-2 py-1 text-2xs transition-colors hover:bg-accent disabled:opacity-40"
							disabled={busy || !commitMessage.trim()}
							title="Commit without pushing"
							onclick={() => void commitOnly()}
						>
							Commit only
						</button>
					</div>
				</div>
			{/if}

			<!-- Staged -->
			{#if status.staged.length > 0}
				<div class="px-3 pt-1.5 pb-0.5">
					<span class="text-2xs font-medium text-muted-foreground/50"
						>Staged ({status.staged.length})</span
					>
				</div>
				{#each status.staged as file (file.path)}
					<TreeRow
						leafSpacer={false}
						onActivate={() => void toggleDiff({ path: file.path, staged: true })}
					>
						{#snippet icon()}<GitStatusBadge status={file.status} />{/snippet}
						{#snippet label()}<span class="min-w-0 flex-1 truncate font-mono text-xs"
								>{file.path}</span
							>{/snippet}
						{#snippet trailing()}
							<button
								class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-foreground"
								title="Unstage"
								onclick={(e) => {
									e.stopPropagation();
									void toggleStage(file, true);
								}}
							>
								<Minus class="h-3 w-3" />
							</button>
						{/snippet}
					</TreeRow>
					{#if expandedPath === file.path}
						<div class="px-2 pb-1.5">
							<GitDiffView diff={expandedDiff} loading={expandedDiffLoading} />
						</div>
					{/if}
				{/each}
			{/if}

			<!-- Unstaged -->
			{#if status.unstaged.length > 0}
				<div class="px-3 pt-1.5 pb-0.5">
					<span class="text-2xs font-medium text-muted-foreground/50"
						>Changes ({status.unstaged.length})</span
					>
				</div>
				{#each status.unstaged as file (file.path)}
					<TreeRow
						leafSpacer={false}
						onActivate={() => void toggleDiff({ path: file.path, staged: false })}
					>
						{#snippet icon()}<GitStatusBadge status={file.status} />{/snippet}
						{#snippet label()}<span class="min-w-0 flex-1 truncate font-mono text-xs"
								>{file.path}</span
							>{/snippet}
						{#snippet trailing()}
							<button
								class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-destructive"
								title="Discard changes"
								onclick={(e) => {
									e.stopPropagation();
									confirmDiscard([file.path], false);
								}}
							>
								<X class="h-3 w-3" />
							</button>
							<button
								class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-foreground"
								title="Stage"
								onclick={(e) => {
									e.stopPropagation();
									void toggleStage(file, false);
								}}
							>
								<Plus class="h-3 w-3" />
							</button>
						{/snippet}
					</TreeRow>
					{#if expandedPath === file.path}
						<div class="px-2 pb-1.5">
							<GitDiffView diff={expandedDiff} loading={expandedDiffLoading} />
						</div>
					{/if}
				{/each}
			{/if}

			<!-- Untracked -->
			{#if status.untracked.length > 0}
				<div class="flex items-center justify-between px-3 pt-1.5 pb-0.5">
					<span class="text-2xs font-medium text-muted-foreground/50"
						>Untracked ({status.untracked.length})</span
					>
					<button
						class="text-2xs text-muted-foreground hover:text-foreground"
						onclick={() => void stageAllUntracked()}
					>
						Stage all
					</button>
				</div>
				{#each status.untracked as filePath (filePath)}
					<TreeRow
						leafSpacer={false}
						onActivate={() => void toggleDiff({ path: filePath, staged: false, untracked: true })}
					>
						{#snippet icon()}<GitStatusBadge status="?" />{/snippet}
						{#snippet label()}<span
								class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground/70"
								>{filePath}</span
							>{/snippet}
						{#snippet trailing()}
							<button
								class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-destructive"
								title="Delete file"
								onclick={(e) => {
									e.stopPropagation();
									confirmDiscard([filePath], true);
								}}
							>
								<X class="h-3 w-3" />
							</button>
							<button
								class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-foreground"
								title="Stage"
								onclick={(e) => {
									e.stopPropagation();
									void stageUntracked(filePath);
								}}
							>
								<Plus class="h-3 w-3" />
							</button>
						{/snippet}
					</TreeRow>
					{#if expandedPath === filePath}
						<div class="px-2 pb-1.5">
							<GitDiffView diff={expandedDiff} loading={expandedDiffLoading} />
						</div>
					{/if}
				{/each}
			{/if}

			{#if status.staged.length === 0 && status.unstaged.length === 0 && status.untracked.length === 0}
				<EmptyState description="No changes — working tree clean.">
					{#snippet icon()}<GitCommit class="h-4 w-4" />{/snippet}
				</EmptyState>
			{/if}

			{#if prUrl}
				<div class="px-2 pt-1">
					<a
						href={prUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="flex items-center justify-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-2xs transition-colors hover:bg-accent"
					>
						<ExternalLink class="h-3 w-3" /> Create pull request
					</a>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Recent commits -->
	{#if status?.isRepo}
		<div class="border-t border-border">
			<button
				class="sidebar-panel-header w-full text-left"
				onclick={() => {
					logExpanded = !logExpanded;
					if (logExpanded && commits.length === 0) void loadLog();
				}}
			>
				{#if logExpanded}<ChevronDown
						class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
					/>{:else}<ChevronRight class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{/if}
				<span class="text-2xs font-medium text-muted-foreground">History</span>
			</button>
			{#if logExpanded}
				{#if commits.length === 0}
					<EmptyState description="No commits yet." />
				{:else}
					<div class="max-h-40 overflow-y-auto pb-1">
						{#each commits as commit}
							<div
								class="mx-[var(--sidebar-row-inset)] px-[calc(var(--sidebar-panel-x)-var(--sidebar-row-inset))] py-1"
							>
								<p class="truncate text-2xs text-foreground">{commit.message}</p>
								<p class="text-3xs text-muted-foreground/60">
									{commit.author} · {relativeTime(commit.date)} · {commit.hash.slice(0, 7)}
								</p>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Live log drawer -->
	{#if logOpen && logLines.length > 0}
		<div
			class="fixed bottom-0 left-0 z-(--z-overlay) w-72 rounded-tr-lg border border-border bg-background shadow-xl"
		>
			<div class="flex items-center justify-between border-b border-border px-2 py-1">
				<span class="truncate text-2xs font-medium text-muted-foreground">
					{exitCode === null
						? `${logHeader}…`
						: exitCode === 0
							? `${logHeader} completed`
							: `${logHeader} failed (exit ${exitCode})`}
				</span>
				<button
					class="ml-2 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
					onclick={() => (logOpen = false)}
				>
					<X class="h-3 w-3" />
				</button>
			</div>
			<div
				class="max-h-44 overflow-y-auto px-2 py-1.5 font-mono text-2xs leading-5 text-muted-foreground"
			>
				{#each logLines as line}<div>{line}</div>{/each}
			</div>
		</div>
	{/if}
</div>

<ConfirmDialog
	bind:open={discardConfirmOpen}
	title={discardTarget?.untracked ? 'Delete file?' : 'Discard changes?'}
	body={discardTarget?.untracked
		? 'This permanently deletes the untracked file. This cannot be undone.'
		: 'This discards all uncommitted changes to the selected file(s). This cannot be undone.'}
	confirmLabel={discardTarget?.untracked ? 'Delete' : 'Discard'}
	onConfirm={performDiscard}
/>
