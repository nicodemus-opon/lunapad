<script lang="ts">
	import { Plus, Minus, X } from '@lucide/svelte';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import GitStatusBadge from '$lib/components/git/GitStatusBadge.svelte';
	import UnifiedDiffView from '$lib/components/git/UnifiedDiffView.svelte';
	import type { GitDisplayStatus } from '$lib/types/git';

	interface FileEntry {
		path: string;
		status: GitDisplayStatus;
	}

	let {
		title,
		files,
		staged,
		untracked = false,
		accent = 'default',
		bulkActionLabel,
		onBulkAction,
		expandedPath,
		expandedDiff,
		expandedDiffLoading,
		onToggleDiff,
		onPrimaryAction,
		onSecondaryAction
	}: {
		title: string;
		files: FileEntry[];
		/** Whether these files are already staged (controls diff staged-flag + primary action icon). */
		staged: boolean;
		untracked?: boolean;
		accent?: 'staged' | 'default';
		bulkActionLabel?: string;
		onBulkAction?: () => void;
		expandedPath: string | null;
		expandedDiff: string;
		expandedDiffLoading: boolean;
		onToggleDiff: (file: { path: string; staged: boolean; untracked?: boolean }) => void;
		onPrimaryAction: (path: string) => void;
		onSecondaryAction?: (path: string) => void;
	} = $props();
</script>

{#if files.length > 0}
	<div class={accent === 'staged' ? 'bg-success/5' : ''}>
		<div class="flex items-center justify-between px-3 pt-2 pb-1">
			<div class="flex items-center gap-1.5">
				<span class="text-xs font-semibold text-foreground/80">{title}</span>
				<span class="rounded-full bg-muted px-1.5 py-px text-3xs font-medium text-muted-foreground">
					{files.length}
				</span>
			</div>
			{#if bulkActionLabel && onBulkAction}
				<button class="text-2xs text-muted-foreground hover:text-foreground" onclick={onBulkAction}>
					{bulkActionLabel}
				</button>
			{/if}
		</div>
		{#each files as file (file.path)}
			<TreeRow
				leafSpacer={false}
				onActivate={() => onToggleDiff({ path: file.path, staged, untracked })}
			>
				{#snippet icon()}<GitStatusBadge status={file.status} />{/snippet}
				{#snippet label()}
					<span
						class={[
							'min-w-0 flex-1 truncate font-mono text-xs',
							untracked ? 'text-muted-foreground/70' : ''
						].join(' ')}>{file.path}</span
					>
				{/snippet}
				{#snippet trailing()}
					{#if onSecondaryAction}
						<button
							class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-destructive"
							title={untracked ? 'Delete file' : 'Discard changes'}
							onclick={(e) => {
								e.stopPropagation();
								onSecondaryAction?.(file.path);
							}}
						>
							<X class="h-3 w-3" />
						</button>
					{/if}
					<button
						class="invisible shrink-0 rounded p-0.5 text-muted-foreground group-hover/row:visible hover:bg-sidebar-accent/60 hover:text-foreground"
						title={staged ? 'Unstage' : 'Stage'}
						onclick={(e) => {
							e.stopPropagation();
							onPrimaryAction(file.path);
						}}
					>
						{#if staged}<Minus class="h-3 w-3" />{:else}<Plus class="h-3 w-3" />{/if}
					</button>
				{/snippet}
			</TreeRow>
			{#if expandedPath === file.path}
				<div class="px-2 pb-1.5">
					<UnifiedDiffView diff={expandedDiff} loading={expandedDiffLoading} />
				</div>
			{/if}
		{/each}
	</div>
{/if}
