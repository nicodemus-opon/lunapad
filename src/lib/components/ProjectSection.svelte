<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { FolderOpen, FolderX, FolderCode, ExternalLink, X, ChevronRight } from '@lucide/svelte';
	import {
		getProjectFolder,
		getIsDbtProject,
		openProject,
		closeProject
	} from '$lib/stores/notebook.svelte';
	import { revealInFinder, scaffoldProject } from '$lib/services/project-client';

	const projectFolder = $derived(getProjectFolder());
	const isDbtProject = $derived(getIsDbtProject());

	let dialog = $state<'none' | 'open' | 'new'>('none');
	let folderInput = $state('');
	let newName = $state('');
	let newFolder = $state('');
	let loading = $state(false);

	function folderDisplayName(folder: string): string {
		return folder.replace(/\\/g, '/').split('/').at(-1) || folder;
	}

	async function handleOpen() {
		const folder = folderInput.trim();
		if (!folder || loading) return;
		loading = true;
		try {
			await openProject(folder);
			dialog = 'none';
			folderInput = '';
		} catch (err) {
			toast.error((err as Error).message ?? 'Could not open project');
		} finally {
			loading = false;
		}
	}

	async function handleCreate() {
		const folder = newFolder.trim();
		const name = (newName.trim() || 'my_project').toLowerCase().replace(/\s+/g, '_');
		if (!folder || loading) return;
		loading = true;
		try {
			await scaffoldProject(folder, name);
			await openProject(folder);
			dialog = 'none';
			newName = '';
			newFolder = '';
			toast.success(`Created "${name}" in ${folderDisplayName(folder)}`);
		} catch (err) {
			toast.error((err as Error).message ?? 'Could not create project');
		} finally {
			loading = false;
		}
	}

	function closeDialog() {
		if (loading) return;
		dialog = 'none';
		folderInput = '';
		newName = '';
		newFolder = '';
	}
</script>

<!-- Project bar (always visible at top of sidebar) -->
<div class="flex h-9 shrink-0 items-center gap-1 border-b border-border/40 px-3">
	{#if projectFolder}
		<FolderCode class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
		<span
			class="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/80"
			title={projectFolder}
		>
			{folderDisplayName(projectFolder)}
		</span>
		{#if isDbtProject}
			<span
				class="shrink-0 rounded px-1 py-px text-[9px] font-semibold tracking-wide bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
			>
				dbt
			</span>
		{/if}
		<button
			class="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
			onclick={revealInFinder.bind(null, projectFolder)}
			title="Reveal in Finder"
		>
			<ExternalLink class="h-3 w-3" />
		</button>
		<button
			class="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-destructive hover:bg-muted transition-colors"
			onclick={closeProject}
			title="Close project"
		>
			<FolderX class="h-3 w-3" />
		</button>
	{:else}
		<FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
		<span class="flex-1 text-[12px] text-muted-foreground/50 select-none">No project open</span>
		<button
			class="shrink-0 text-[11px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
			onclick={() => (dialog = 'open')}
		>
			Open
		</button>
		<span class="text-border/60 text-[11px]">·</span>
		<button
			class="shrink-0 text-[11px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
			onclick={() => (dialog = 'new')}
		>
			New
		</button>
	{/if}
</div>

<!-- Modal dialogs -->
{#if dialog !== 'none'}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
		onclick={closeDialog}
	></div>

	<!-- Dialog panel -->
	<div
		class="fixed left-1/2 top-[30%] z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl"
	>
		<!-- Header -->
		<div class="flex items-center justify-between border-b border-border/60 px-5 py-4">
			<h2 class="text-[15px] font-semibold">
				{dialog === 'open' ? 'Open project folder' : 'Create new dbt project'}
			</h2>
			<button
				class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
				onclick={closeDialog}
			>
				<X class="h-4 w-4" />
			</button>
		</div>

		{#if dialog === 'open'}
			<!-- Open existing project -->
			<div class="flex flex-col gap-4 p-5">
				<p class="text-[13px] text-muted-foreground leading-relaxed">
					Enter the path to an existing project folder. Supports SQL, PRQL, and project formats including dbt.
				</p>
				<div class="flex flex-col gap-1.5">
					<label for="open-folder-path" class="text-[12px] font-medium text-foreground/70">Folder path</label>
					<input
						id="open-folder-path"
						class="w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/40"
						placeholder="/Users/you/my-project"
						bind:value={folderInput}
						onkeydown={(e) => {
							if (e.key === 'Enter') void handleOpen();
							if (e.key === 'Escape') closeDialog();
						}}
					/>
				</div>
				<div class="flex justify-end gap-2 pt-1">
					<button
						class="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted transition-colors"
						onclick={closeDialog}
					>
						Cancel
					</button>
					<button
						class="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
						onclick={() => void handleOpen()}
						disabled={!folderInput.trim() || loading}
					>
						{loading ? 'Opening…' : 'Open'}
					</button>
				</div>
			</div>

			<!-- Switch to New -->
			<div class="border-t border-border/40 px-5 py-3">
				<button
					class="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
					onclick={() => { dialog = 'new'; folderInput = ''; }}
				>
					<ChevronRight class="h-3 w-3" />
					Create a new dbt project instead
				</button>
			</div>

		{:else}
			<!-- Create new dbt project -->
			<div class="flex flex-col gap-4 p-5">
				<p class="text-[13px] text-muted-foreground leading-relaxed">
					Scaffolds a new project following best-practice layer structure
					<span class="font-mono text-foreground/80">(staging → intermediate → marts)</span>.
				</p>

				<div class="flex flex-col gap-3">
					<div class="flex flex-col gap-1.5">
						<label for="new-project-name" class="text-[12px] font-medium text-foreground/70">Project name</label>
						<input
							id="new-project-name"
							class="w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/40"
							placeholder="analytics"
							bind:value={newName}
						/>
						<p class="text-[11px] text-muted-foreground/60">
							Used in <span class="font-mono">dbt_project.yml</span> as the project name.
						</p>
					</div>

					<div class="flex flex-col gap-1.5">
						<label for="new-folder-path" class="text-[12px] font-medium text-foreground/70">Folder path</label>
						<input
							id="new-folder-path"
							class="w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/40"
							placeholder="/Users/you/analytics"
							bind:value={newFolder}
							onkeydown={(e) => {
								if (e.key === 'Enter') void handleCreate();
								if (e.key === 'Escape') closeDialog();
							}}
						/>
						<p class="text-[11px] text-muted-foreground/60">
							Directory will be created if it doesn't exist.
						</p>
					</div>
				</div>

				<!-- Structure preview -->
				<div class="rounded-lg border border-border/50 bg-muted/30 p-3 font-mono text-[11px] text-muted-foreground leading-5">
					<div class="text-foreground/60 font-semibold mb-1">{newName || 'project'}/</div>
					<div class="pl-3">
						<div>models/</div>
						<div class="pl-4 text-muted-foreground/60">staging/   <span class="text-chart-1/80">· views</span></div>
						<div class="pl-4 text-muted-foreground/60">intermediate/   <span class="text-chart-2/80">· ephemeral</span></div>
						<div class="pl-4 text-muted-foreground/60">marts/   <span class="text-chart-3/80">· tables</span></div>
						<div>analyses/</div>
						<div>seeds/</div>
						<div>macros/</div>
					</div>
				</div>

				<div class="flex justify-end gap-2 pt-1">
					<button
						class="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted transition-colors"
						onclick={closeDialog}
					>
						Cancel
					</button>
					<button
						class="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
						onclick={() => void handleCreate()}
						disabled={!newFolder.trim() || loading}
					>
						{loading ? 'Creating…' : 'Create project'}
					</button>
				</div>
			</div>

			<!-- Switch to Open -->
			<div class="border-t border-border/40 px-5 py-3">
				<button
					class="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
					onclick={() => { dialog = 'open'; newName = ''; newFolder = ''; }}
				>
					<ChevronRight class="h-3 w-3" />
					Open an existing project instead
				</button>
			</div>
		{/if}
	</div>
{/if}
