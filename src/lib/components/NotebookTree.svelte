<script lang="ts">
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as Popover from '$lib/components/ui/popover';
	import {
		addNotebook,
		addNotebookInFolder,
		createFolder,
		deleteFolderIfEmpty,
		deleteNotebook,
		duplicateNotebook,
		getActiveTabId,
		getExpandedNotebookFolderIds,
		getFolders,
		getNotebooks,
		getOpenNotebookTabIds,
		isNotebookDirty,
		isFolderEmpty,
		moveNotebookToFolder,
		openNotebookTab,
		renameFolder,
		renameNotebook,
		setFolderExpanded,
		loadDemoNotebook,
		type Notebook,
		type NotebookFolder
	} from '$lib/stores/notebook.svelte';
	import { toast } from 'svelte-sonner';
	import { ChevronRight, Copy, NotebookText, Folder, FolderOpen, FolderPlus, MoreHorizontal, Plus, Trash2 } from '@lucide/svelte';

	let { pendingRenameFolderId = $bindable<string | null>(null), filterQuery = '' } = $props();

	type TreeRow =
		| { kind: 'folder'; depth: number; folder: NotebookFolder }
		| { kind: 'notebook'; depth: number; notebook: Notebook; folderName?: string };

	const notebooks = $derived(getNotebooks());
	const folders = $derived(getFolders());
	const activeTabId = $derived(getActiveTabId());
	const expandedFolderIds = $derived(getExpandedNotebookFolderIds());
	const openTabIds = $derived(getOpenNotebookTabIds());

	let renamingNotebookId = $state<string | null>(null);
	let renamingFolderId = $state<string | null>(null);
	let renameValue = $state('');
	let openPopoverNotebookId = $state<string | null>(null);
	let draggingNotebookId = $state<string | null>(null);
	let dragOverFolderId = $state<string | null>(null);

	$effect(() => {
		if (pendingRenameFolderId) {
			startRenameFolder(pendingRenameFolderId, 'New Folder');
			pendingRenameFolderId = null;
		}
	});

	const treeRows = $derived.by(() => {
		const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name));
		const sortedNotebooks = [...notebooks].sort((a, b) => a.name.localeCompare(b.name));

		const q = filterQuery.trim().toLowerCase();
		if (q) {
			const folderMap = new Map(sortedFolders.map((f) => [f.id, f.name]));
			return sortedNotebooks
				.filter((n) => n.name.toLowerCase().includes(q))
				.map((n): TreeRow => ({
					kind: 'notebook',
					depth: 0,
					notebook: n,
					folderName: n.folderId ? folderMap.get(n.folderId) : undefined
				}));
		}

		const rows: TreeRow[] = [];

		const build = (parentId: string | null, depth: number) => {
			const childFolders = sortedFolders.filter((f) => (f.parentId ?? null) === parentId);
			const childNotebooks = sortedNotebooks.filter((n) => (n.folderId ?? null) === parentId);

			for (const folder of childFolders) {
				rows.push({ kind: 'folder', depth, folder });
				if (expandedFolderIds.includes(folder.id)) {
					build(folder.id, depth + 1);
				}
			}

			for (const notebook of childNotebooks) {
				rows.push({ kind: 'notebook', depth, notebook });
			}
		};

		build(null, 0);
		return rows;
	});

	function toggleFolder(folderId: string) {
		setFolderExpanded(folderId, !expandedFolderIds.includes(folderId));
	}

	function startRenameNotebook(id: string, currentName: string) {
		renamingFolderId = null;
		renamingNotebookId = id;
		renameValue = currentName;
	}

	function startRenameFolder(id: string, currentName: string) {
		renamingNotebookId = null;
		renamingFolderId = id;
		renameValue = currentName;
	}

	function commitRename() {
		const next = renameValue.trim();
		if (!next) {
			clearRename();
			return;
		}
		if (renamingNotebookId) {
			renameNotebook(renamingNotebookId, next);
		}
		if (renamingFolderId) {
			renameFolder(renamingFolderId, next);
		}
		clearRename();
	}

	function clearRename() {
		renamingNotebookId = null;
		renamingFolderId = null;
		renameValue = '';
	}

	function onRenameKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Enter') commitRename();
		if (event.key === 'Escape') clearRename();
	}

	function handleDeleteNotebook(id: string, name: string) {
		if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
		deleteNotebook(id);
	}

	function handleDeleteFolder(id: string, name: string) {
		if (!isFolderEmpty(id)) {
			toast.error('Folder is not empty. Move or delete items first.');
			return;
		}
		if (!confirm(`Delete folder "${name}"?`)) return;
		const ok = deleteFolderIfEmpty(id);
		if (!ok) toast.error('Folder could not be deleted.');
	}

	function createFolderAt(parentId: string | null) {
		const id = createFolder('New Folder', parentId);
		startRenameFolder(id, 'New Folder');
	}

	function createNotebookAt(folderId: string | null) {
		if (folderId === null) {
			addNotebook();
			return;
		}
		addNotebookInFolder(folderId);
	}
</script>

<div class="flex h-full flex-col overflow-hidden">
	<div class="flex-1 overflow-y-auto py-1">
		{#if treeRows.length === 0}
			<div class="px-3 py-4 text-center">
				<p class="text-xs italic text-muted-foreground">No notebooks yet.</p>
				<button
					class="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
					onclick={loadDemoNotebook}
				>Load demo notebook</button>
			</div>
		{:else}
			{#each treeRows as row (row.kind === 'folder' ? row.folder.id : row.notebook.id)}
				{#if row.kind === 'folder'}
					{@const isExpanded = expandedFolderIds.includes(row.folder.id)}
					{@const isDragTarget = dragOverFolderId === row.folder.id}
					<ContextMenu.Root>
						<ContextMenu.Trigger>
							<div
								class="mx-1 flex cursor-pointer select-none items-center gap-1.5 rounded-sm py-1 pr-2 transition-colors hover:bg-accent/60 {isDragTarget ? 'bg-accent ring-1 ring-primary/30' : ''}"
								style={`padding-left: ${8 + row.depth * 14}px`}
								onclick={() => toggleFolder(row.folder.id)}
								role="treeitem"
								aria-expanded={isExpanded}
								aria-selected="false"
								tabindex="0"
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') toggleFolder(row.folder.id);
								}}
								ondragover={(e) => { e.preventDefault(); dragOverFolderId = row.folder.id; }}
								ondragleave={() => { if (dragOverFolderId === row.folder.id) dragOverFolderId = null; }}
								ondrop={(e) => {
									e.preventDefault();
									const id = e.dataTransfer?.getData('text/plain') ?? draggingNotebookId;
									if (id) moveNotebookToFolder(id, row.folder.id);
									dragOverFolderId = null;
									draggingNotebookId = null;
								}}
							>
								<ChevronRight
									class="h-3 w-3 shrink-0 text-muted-foreground transition-transform {isExpanded ? 'rotate-90' : ''}"
								/>
								{#if isExpanded}
									<FolderOpen class="h-3.5 w-3.5 shrink-0 text-primary/80" />
								{:else}
									<Folder class="h-3.5 w-3.5 shrink-0 text-primary/80" />
								{/if}
								{#if renamingFolderId === row.folder.id}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										autofocus
										class="h-5 min-w-0 flex-1 border-0 border-b border-primary bg-transparent px-0 text-xs text-foreground outline-none"
										bind:value={renameValue}
										onblur={commitRename}
										onkeydown={onRenameKeydown}
										onclick={(e) => e.stopPropagation()}
									/>
								{:else}
									<span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">{row.folder.name}</span>
								{/if}
							</div>
						</ContextMenu.Trigger>
						<ContextMenu.Content class="w-48">
							<ContextMenu.Item onclick={() => createFolderAt(row.folder.id)}>
								<FolderPlus class="mr-2 h-3.5 w-3.5" />
								New folder
							</ContextMenu.Item>
							<ContextMenu.Item onclick={() => createNotebookAt(row.folder.id)}>
								<Plus class="mr-2 h-3.5 w-3.5" />
								New notebook
							</ContextMenu.Item>
							<ContextMenu.Separator />
							<ContextMenu.Item onclick={() => startRenameFolder(row.folder.id, row.folder.name)}>
								<Copy class="mr-2 h-3.5 w-3.5" />
								Rename folder
							</ContextMenu.Item>
							<ContextMenu.Item onclick={() => handleDeleteFolder(row.folder.id, row.folder.name)}>
								<Trash2 class="mr-2 h-3.5 w-3.5" />
								Delete folder
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Root>
				{:else}
					{@const isActive = activeTabId === row.notebook.id}
					{@const isOpen = openTabIds.includes(row.notebook.id)}
					<ContextMenu.Root>
						<ContextMenu.Trigger>
							<div
								class="group mx-1 flex cursor-pointer select-none items-center gap-1.5 rounded-sm py-1 pr-1 transition-colors hover:bg-muted/60 {isActive ? 'bg-muted' : ''}"
								style={`padding-left: ${20 + row.depth * 14}px`}
								onclick={() => openNotebookTab(row.notebook.id)}
								role="treeitem"
								aria-selected={isActive}
								tabindex="0"
								draggable={true}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') openNotebookTab(row.notebook.id);
								}}
								ondragstart={(e) => {
									draggingNotebookId = row.notebook.id;
									e.dataTransfer?.setData('text/plain', row.notebook.id);
								}}
								ondragend={() => { draggingNotebookId = null; dragOverFolderId = null; }}
							>
								<NotebookText class="h-3.5 w-3.5 shrink-0 {isActive ? 'text-foreground' : 'text-muted-foreground'}" />
								{#if renamingNotebookId === row.notebook.id}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										autofocus
										class="h-5 min-w-0 flex-1 border-0 border-b border-primary bg-transparent px-0 text-xs text-foreground outline-none"
										bind:value={renameValue}
										onblur={commitRename}
										onkeydown={onRenameKeydown}
										onclick={(e) => e.stopPropagation()}
									/>
								{:else}
									<span class="min-w-0 flex-1 overflow-hidden">
										<span class="block truncate text-xs {isActive ? 'font-semibold text-foreground' : 'text-foreground/80'}">
											{row.notebook.name}
										</span>
										{#if row.folderName}
											<span class="block truncate text-[10px] text-muted-foreground/50 leading-none pb-0.5">{row.folderName}</span>
										{/if}
									</span>
								{/if}
								{#if isNotebookDirty(row.notebook.id)}
									<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80" title="Unsaved"></span>
								{:else if isOpen && !isActive}
									<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50"></span>
								{/if}
								<Popover.Root
									open={openPopoverNotebookId === row.notebook.id}
									onOpenChange={(v) => { openPopoverNotebookId = v ? row.notebook.id : null; }}
								>
									<Popover.Trigger>
										<button
											class="ml-auto shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-opacity {isActive || openPopoverNotebookId === row.notebook.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}"
											onclick={(e) => e.stopPropagation()}
											aria-label="Notebook options"
										>
											<MoreHorizontal class="h-3.5 w-3.5" />
										</button>
									</Popover.Trigger>
									<Popover.Content class="w-44 p-1" side="right" align="start">
										<button
											class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
											onclick={(e) => { e.stopPropagation(); openNotebookTab(row.notebook.id); openPopoverNotebookId = null; }}
										>
											<NotebookText class="h-3.5 w-3.5 text-muted-foreground" />
											Open
										</button>
										<button
											class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
											onclick={(e) => { e.stopPropagation(); createNotebookAt(row.notebook.folderId ?? null); openPopoverNotebookId = null; }}
										>
											<Plus class="h-3.5 w-3.5 text-muted-foreground" />
											New notebook here
										</button>
										<div class="my-1 h-px bg-border"></div>
										<button
											class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
											onclick={(e) => { e.stopPropagation(); startRenameNotebook(row.notebook.id, row.notebook.name); openPopoverNotebookId = null; }}
										>
											<Copy class="h-3.5 w-3.5 text-muted-foreground" />
											Rename
										</button>
										<button
											class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
											onclick={(e) => { e.stopPropagation(); duplicateNotebook(row.notebook.id); openPopoverNotebookId = null; }}
										>
											<Copy class="h-3.5 w-3.5 text-muted-foreground" />
											Duplicate
										</button>
										<button
											class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-destructive hover:bg-accent"
											onclick={(e) => { e.stopPropagation(); handleDeleteNotebook(row.notebook.id, row.notebook.name); openPopoverNotebookId = null; }}
										>
											<Trash2 class="h-3.5 w-3.5" />
											Delete
										</button>
									</Popover.Content>
								</Popover.Root>
							</div>
						</ContextMenu.Trigger>
						<ContextMenu.Content class="w-48">
							<ContextMenu.Item onclick={() => openNotebookTab(row.notebook.id)}>
								<NotebookText class="mr-2 h-3.5 w-3.5" />
								Open
							</ContextMenu.Item>
							<ContextMenu.Item onclick={() => createNotebookAt(row.notebook.folderId ?? null)}>
								<Plus class="mr-2 h-3.5 w-3.5" />
								New notebook here
							</ContextMenu.Item>
							<ContextMenu.Separator />
							<ContextMenu.Item onclick={() => startRenameNotebook(row.notebook.id, row.notebook.name)}>
								<Copy class="mr-2 h-3.5 w-3.5" />
								Rename notebook
							</ContextMenu.Item>
							<ContextMenu.Item onclick={() => duplicateNotebook(row.notebook.id)}>
								<Copy class="mr-2 h-3.5 w-3.5" />
								Duplicate notebook
							</ContextMenu.Item>
							<ContextMenu.Item onclick={() => handleDeleteNotebook(row.notebook.id, row.notebook.name)}>
								<Trash2 class="mr-2 h-3.5 w-3.5" />
								Delete notebook
							</ContextMenu.Item>
						</ContextMenu.Content>
					</ContextMenu.Root>
				{/if}
			{/each}
		{/if}
	</div>
</div>
