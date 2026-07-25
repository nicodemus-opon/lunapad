<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { AlertTriangle, Loader2, Check } from '@lucide/svelte';
	import { getProjectFolder, closeExtraTab } from '$lib/stores/notebook.svelte';
	import { refreshGitStatus } from '$lib/stores/git.svelte';
	import { gitConflictContent, gitResolveConflict } from '$lib/services/git-client';
	import { diffTextsAsUnifiedString } from '$lib/utils/unified-diff';
	import UnifiedDiffView from '$lib/components/git/UnifiedDiffView.svelte';

	let { conflictPath, tabId }: { conflictPath: string; tabId: string } = $props();

	const projectFolder = $derived(getProjectFolder());

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let base = $state<string | null>(null);
	let ours = $state<string | null>(null);
	let theirs = $state<string | null>(null);
	let resolving = $state(false);
	let resolved = $state<'ours' | 'theirs' | null>(null);

	$effect(() => {
		const folder = projectFolder;
		const path = conflictPath;
		if (!folder || !path) return;
		loading = true;
		loadError = null;
		void gitConflictContent(folder, path)
			.then((content) => {
				base = content.base;
				ours = content.ours;
				theirs = content.theirs;
			})
			.catch((err) => {
				loadError = (err as Error).message ?? 'Failed to load conflict';
			})
			.finally(() => {
				loading = false;
			});
	});

	const oursDiff = $derived(diffTextsAsUnifiedString(base ?? '', ours ?? '', 'base', 'ours'));
	const theirsDiff = $derived(diffTextsAsUnifiedString(base ?? '', theirs ?? '', 'base', 'theirs'));

	async function resolve(resolution: 'ours' | 'theirs') {
		if (!projectFolder || resolving) return;
		resolving = true;
		try {
			await gitResolveConflict(projectFolder, conflictPath, resolution);
			await refreshGitStatus(projectFolder);
			resolved = resolution;
			toast.success(
				`Resolved using ${resolution === 'ours' ? 'your version' : 'their version'} — commit to complete the merge.`
			);
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to resolve conflict');
		} finally {
			resolving = false;
		}
	}
</script>

<div class="flex h-full flex-col overflow-hidden">
	<div class="flex shrink-0 items-center gap-2 border-b border-border bg-warning/5 px-4 py-3">
		<AlertTriangle class="h-4 w-4 shrink-0 text-warning" />
		<div class="min-w-0 flex-1">
			<p class="truncate text-sm font-medium text-foreground">Merge conflict</p>
			<p class="truncate font-mono text-xs text-muted-foreground">{conflictPath}</p>
		</div>
		{#if resolved}
			<span class="flex items-center gap-1 text-xs text-success">
				<Check class="h-3.5 w-3.5" /> Resolved ({resolved})
			</span>
		{:else}
			<button
				class="rounded border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-40"
				disabled={resolving}
				onclick={() => void resolve('ours')}
			>
				Keep ours
			</button>
			<button
				class="rounded border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-40"
				disabled={resolving}
				onclick={() => void resolve('theirs')}
			>
				Keep theirs
			</button>
		{/if}
		<button
			class="rounded border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-accent"
			onclick={() => closeExtraTab(tabId)}
		>
			Close
		</button>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto p-4">
		{#if loading}
			<div class="flex justify-center py-8">
				<Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
			</div>
		{:else if loadError}
			<p class="text-sm text-destructive">{loadError}</p>
		{:else}
			<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
				<div>
					<p class="mb-1.5 text-xs font-medium text-muted-foreground">
						Base → Ours (yours) {ours === null ? '— deleted on your side' : ''}
					</p>
					<UnifiedDiffView diff={oursDiff} />
				</div>
				<div>
					<p class="mb-1.5 text-xs font-medium text-muted-foreground">
						Base → Theirs (incoming) {theirs === null ? '— deleted on their side' : ''}
					</p>
					<UnifiedDiffView diff={theirsDiff} />
				</div>
			</div>
		{/if}
	</div>
</div>
