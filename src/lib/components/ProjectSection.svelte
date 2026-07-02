<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { FolderOpen, FolderX, FolderCode, ExternalLink, ChevronRight } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
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
	let dialogOpen = $state(false);
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

	function showDialog(which: 'open' | 'new') {
		dialog = which;
		dialogOpen = true;
	}

	function closeDialog() {
		if (loading) {
			dialogOpen = true;
			return;
		}
		dialogOpen = false;
		dialog = 'none';
		folderInput = '';
		newName = '';
		newFolder = '';
	}
</script>

<!-- Project bar (always visible at top of sidebar) -->
<div class="flex h-9 shrink-0 items-center gap-1 border-b border-border/30 px-2">
	{#if projectFolder}
		<FolderCode class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
		<span
			class="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80"
			title={projectFolder}
		>
			{folderDisplayName(projectFolder)}
		</span>
		{#if isDbtProject}
			<span
				class="shrink-0 rounded border bg-accent px-1 py-px text-3xs font-semibold tracking-wide text-foreground"
			>
				dbt
			</span>
		{/if}
		<Tooltip.Root>
			<Tooltip.Trigger
				class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
				onclick={revealInFinder.bind(null, projectFolder)}
				aria-label="Reveal in Finder"
			>
				<ExternalLink class="h-3.5 w-3.5" />
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom">Reveal in Finder</Tooltip.Content>
		</Tooltip.Root>
		<Tooltip.Root>
			<Tooltip.Trigger
				class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-sidebar-accent/60 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
				onclick={closeProject}
				aria-label="Close project"
			>
				<FolderX class="h-3.5 w-3.5" />
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom">Close project</Tooltip.Content>
		</Tooltip.Root>
	{:else}
		<FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
		<span class="flex-1 text-xs text-muted-foreground/60 select-none">No project open</span>
		<button
			class="shrink-0 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
			onclick={() => showDialog('open')}
		>
			Open
		</button>
		<span class="text-2xs text-border/60">·</span>
		<button
			class="shrink-0 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
			onclick={() => showDialog('new')}
		>
			New
		</button>
	{/if}
</div>

<Dialog.Root
	bind:open={dialogOpen}
	onOpenChange={(v) => {
		if (!v) closeDialog();
	}}
>
	<Dialog.Content class="flex max-w-md flex-col gap-0 overflow-hidden p-0">
		<Dialog.Header class="items-center">
			<div class="min-w-0 flex-1">
				<Dialog.Title>
					{dialog === 'open' ? 'Open project folder' : 'Create new dbt project'}
				</Dialog.Title>
			</div>
			<Dialog.Close />
		</Dialog.Header>

		{#if dialog === 'open'}
			<!-- Open existing project -->
			<div class="flex flex-col gap-4 px-4 py-4">
				<Dialog.Description>
					Enter the path to an existing project folder. Supports SQL, PRQL, and project formats
					including dbt.
				</Dialog.Description>
				<div class="flex flex-col gap-1.5">
					<label for="open-folder-path" class="text-xs font-medium text-foreground/70"
						>Folder path</label
					>
					<Input
						id="open-folder-path"
						class="font-mono text-xs"
						placeholder="/Users/you/my-project"
						bind:value={folderInput}
						onkeydown={(e) => {
							if (e.key === 'Enter') void handleOpen();
						}}
					/>
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="ghost" size="sm" onclick={closeDialog}>Cancel</Button>
				<Button
					size="sm"
					onclick={() => void handleOpen()}
					disabled={!folderInput.trim() || loading}
				>
					{loading ? 'Opening…' : 'Open project'}
				</Button>
			</Dialog.Footer>

			<!-- Switch to New -->
			<div class="border-t border-border/40 px-4 py-3">
				<button
					class="flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
					onclick={() => {
						dialog = 'new';
						folderInput = '';
					}}
				>
					<ChevronRight class="h-3 w-3" />
					Create a new dbt project instead
				</button>
			</div>
		{:else if dialog === 'new'}
			<!-- Create new dbt project -->
			<div class="flex flex-col gap-4 px-4 py-4">
				<Dialog.Description>
					Scaffolds a new project following best-practice layer structure
					<span class="font-mono text-foreground/80">(staging → intermediate → marts)</span>.
				</Dialog.Description>

				<div class="flex flex-col gap-3">
					<div class="flex flex-col gap-1.5">
						<label for="new-project-name" class="text-xs font-medium text-foreground/70"
							>Project name</label
						>
						<Input
							id="new-project-name"
							class="font-mono text-xs"
							placeholder="analytics"
							bind:value={newName}
						/>
						<p class="text-2xs text-muted-foreground/70">
							Used in <span class="font-mono">dbt_project.yml</span> as the project name.
						</p>
					</div>

					<div class="flex flex-col gap-1.5">
						<label for="new-folder-path" class="text-xs font-medium text-foreground/70"
							>Folder path</label
						>
						<Input
							id="new-folder-path"
							class="font-mono text-xs"
							placeholder="/Users/you/analytics"
							bind:value={newFolder}
							onkeydown={(e) => {
								if (e.key === 'Enter') void handleCreate();
							}}
						/>
						<p class="text-2xs text-muted-foreground/70">
							Directory will be created if it doesn't exist.
						</p>
					</div>
				</div>

				<!-- Structure preview -->
				<div
					class="rounded-lg border border-border/50 bg-muted/30 p-3 font-mono text-2xs leading-5 text-muted-foreground"
				>
					<div class="mb-1 font-semibold text-foreground/60">{newName || 'project'}/</div>
					<div class="pl-3">
						<div>models/</div>
						<div class="pl-4 text-muted-foreground/60">
							staging/ <span class="text-chart-1/80">· views</span>
						</div>
						<div class="pl-4 text-muted-foreground/60">
							intermediate/ <span class="text-chart-2/80">· ephemeral</span>
						</div>
						<div class="pl-4 text-muted-foreground/60">
							marts/ <span class="text-chart-3/80">· tables</span>
						</div>
						<div>analyses/</div>
						<div>seeds/</div>
						<div>macros/</div>
					</div>
				</div>
			</div>
			<Dialog.Footer>
				<Button variant="ghost" size="sm" onclick={closeDialog}>Cancel</Button>
				<Button
					size="sm"
					onclick={() => void handleCreate()}
					disabled={!newFolder.trim() || loading}
				>
					{loading ? 'Creating…' : 'Create project'}
				</Button>
			</Dialog.Footer>

			<!-- Switch to Open -->
			<div class="border-t border-border/40 px-4 py-3">
				<button
					class="flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
					onclick={() => {
						dialog = 'open';
						newName = '';
						newFolder = '';
					}}
				>
					<ChevronRight class="h-3 w-3" />
					Open an existing project instead
				</button>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
