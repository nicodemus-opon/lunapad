<script lang="ts">
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Button } from '$lib/components/ui/button';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import EmptyState from '$lib/components/sidebar/EmptyState.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import {
		addNotebook,
		addNotebookInFolder,
		createFolder,
		deleteFolderIfEmpty,
		deleteNotebook,
		duplicateNotebook,
		getActiveTabId,
		getExpandedNotebookFolderIds,
		getExpandedNotebookIds,
		getFolders,
		getNotebooks,
		getOpenNotebookTabIds,
		isNotebookDirty,
		isFolderEmpty,
		moveNotebookToFolder,
		openNotebookTab,
		openNotebookTabAtCell,
		toggleNotebookExpanded,
		renameFolder,
		renameNotebook,
		setFolderExpanded,
		navigateToOutlineEntry,
		toggleFavoriteNotebook,
		getFavoriteNotebookIds,
		type Cell,
		type Notebook,
		type NotebookFolder
	} from '$lib/stores/notebook.svelte';
	import { buildNotebookOutline } from '$lib/services/notebook-outline';
	import { toast } from 'svelte-sonner';
	import { fade } from 'svelte/transition';
	import {
		ChevronRight,
		Code2,
		Copy,
		FlaskConical,
		Folder,
		FolderOpen,
		FolderPlus,
		MoreHorizontal,
		NotebookText,
		Pencil,
		Plus,
		Trash2,
		Type,
		Hash,
		Star
	} from '@lucide/svelte';

	let {
		pendingRenameFolderId = $bindable<string | null>(null),
		filterQuery = '',
		onBrowseTemplates
	}: {
		pendingRenameFolderId?: string | null;
		filterQuery?: string;
		onBrowseTemplates?: () => void;
	} = $props();

	type TreeRowItem =
		| { kind: 'folder'; depth: number; folder: NotebookFolder }
		| { kind: 'notebook'; depth: number; notebook: Notebook; folderName?: string }
		| {
				kind: 'outline';
				depth: number;
				entry: import('$lib/services/notebook-outline').OutlineEntry;
				notebook: Notebook;
		  }
		| { kind: 'cell'; depth: number; cell: Cell; notebook: Notebook };

	type MenuAction =
		| { separator: true }
		| {
				separator?: undefined;
				label: string;
				icon: typeof Plus;
				onSelect: () => void;
				destructive?: boolean;
		  };

	// Svelte transitions don't honor the prefers-reduced-motion media query, gate manually.
	const reducedMotion =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const fadeMs = reducedMotion ? 0 : 120;

	const notebooks = $derived(getNotebooks());
	const folders = $derived(getFolders());
	const activeTabId = $derived(getActiveTabId());
	const expandedFolderIds = $derived(getExpandedNotebookFolderIds());
	const expandedNotebookIds = $derived(getExpandedNotebookIds());
	const openTabIds = $derived(getOpenNotebookTabIds());
	const favoriteIds = $derived(getFavoriteNotebookIds());

	let renamingNotebookId = $state<string | null>(null);
	let renamingFolderId = $state<string | null>(null);
	let renameValue = $state('');
	let openMenuId = $state<string | null>(null);
	let draggingNotebookId = $state<string | null>(null);
	let dragOverFolderId = $state<string | null>(null);
	let dragOverRoot = $state(false);

	let confirmOpen = $state(false);
	let confirmTarget = $state<{ kind: 'notebook' | 'folder'; id: string; name: string } | null>(
		null
	);

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
				.map(
					(n): TreeRowItem => ({
						kind: 'notebook',
						depth: 0,
						notebook: n,
						folderName: n.folderId ? folderMap.get(n.folderId) : undefined
					})
				);
		}

		const rows: TreeRowItem[] = [];

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
				if (expandedNotebookIds.includes(notebook.id)) {
					for (const entry of buildNotebookOutline(notebook.cells)) {
						rows.push({ kind: 'outline', depth: depth + 1, entry, notebook });
					}
				}
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

	function requestDeleteNotebook(id: string, name: string) {
		confirmTarget = { kind: 'notebook', id, name };
		confirmOpen = true;
	}

	function requestDeleteFolder(id: string, name: string) {
		if (!isFolderEmpty(id)) {
			toast.error('Folder is not empty. Move or delete items first.');
			return;
		}
		confirmTarget = { kind: 'folder', id, name };
		confirmOpen = true;
	}

	function executeDelete() {
		if (!confirmTarget) return;
		if (confirmTarget.kind === 'notebook') {
			deleteNotebook(confirmTarget.id);
		} else {
			const ok = deleteFolderIfEmpty(confirmTarget.id);
			if (!ok) toast.error('Folder could not be deleted.');
		}
		confirmTarget = null;
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

	function folderActions(folder: NotebookFolder): MenuAction[] {
		return [
			{ label: 'New notebook', icon: Plus, onSelect: () => createNotebookAt(folder.id) },
			{ label: 'New folder', icon: FolderPlus, onSelect: () => createFolderAt(folder.id) },
			{ separator: true },
			{
				label: 'Rename folder',
				icon: Pencil,
				onSelect: () => startRenameFolder(folder.id, folder.name)
			},
			{
				label: 'Delete folder',
				icon: Trash2,
				destructive: true,
				onSelect: () => requestDeleteFolder(folder.id, folder.name)
			}
		];
	}

	function notebookActions(notebook: Notebook): MenuAction[] {
		return [
			{ label: 'Open notebook', icon: NotebookText, onSelect: () => openNotebookTab(notebook.id) },
			{
				label: 'New notebook here',
				icon: Plus,
				onSelect: () => createNotebookAt(notebook.folderId ?? null)
			},
			{ separator: true },
			{
				label: 'Rename notebook',
				icon: Pencil,
				onSelect: () => startRenameNotebook(notebook.id, notebook.name)
			},
			{ label: 'Duplicate notebook', icon: Copy, onSelect: () => duplicateNotebook(notebook.id) },
			{ separator: true },
			{
				label: 'Delete notebook',
				icon: Trash2,
				destructive: true,
				onSelect: () => requestDeleteNotebook(notebook.id, notebook.name)
			}
		];
	}
</script>

{#snippet contextItems(actions: MenuAction[])}
	{#each actions as action, i (i)}
		{#if action.separator}
			<ContextMenu.Separator />
		{:else}
			{@const Icon = action.icon}
			<ContextMenu.Item
				variant={action.destructive ? 'destructive' : 'default'}
				onclick={action.onSelect}
			>
				<Icon />
				{action.label}
			</ContextMenu.Item>
		{/if}
	{/each}
{/snippet}

{#snippet dropdownItems(actions: MenuAction[])}
	{#each actions as action, i (i)}
		{#if action.separator}
			<DropdownMenu.Separator />
		{:else}
			{@const Icon = action.icon}
			<DropdownMenu.Item
				variant={action.destructive ? 'destructive' : 'default'}
				onclick={action.onSelect}
			>
				<Icon />
				{action.label}
			</DropdownMenu.Item>
		{/if}
	{/each}
{/snippet}

{#snippet rowMenu(id: string, actions: MenuAction[], visible: boolean)}
	<DropdownMenu.Root open={openMenuId === id} onOpenChange={(v) => (openMenuId = v ? id : null)}>
		<DropdownMenu.Trigger
			class="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-opacity hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none {visible ||
			openMenuId === id
				? 'opacity-100'
				: 'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100'}"
			onclick={(e: MouseEvent) => e.stopPropagation()}
			aria-label="More actions"
		>
			<MoreHorizontal class="h-3.5 w-3.5" />
		</DropdownMenu.Trigger>
		<DropdownMenu.Content class="w-48" side="right" align="start">
			{@render dropdownItems(actions)}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<div class="flex h-full flex-col overflow-hidden">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="sidebar-tree-scroll {dragOverRoot && draggingNotebookId
			? 'ring-1 ring-primary/30 ring-inset'
			: ''}"
		ondragover={(e) => {
			if (!draggingNotebookId) return;
			e.preventDefault();
			dragOverRoot = true;
		}}
		ondragleave={() => (dragOverRoot = false)}
		ondrop={(e) => {
			if (!draggingNotebookId) return;
			e.preventDefault();
			const id = e.dataTransfer?.getData('text/plain') ?? draggingNotebookId;
			if (id) moveNotebookToFolder(id, null);
			dragOverRoot = false;
			draggingNotebookId = null;
			dragOverFolderId = null;
		}}
	>
		{#if treeRows.length === 0}
			{#if filterQuery.trim()}
				<EmptyState description="No notebooks match your filter." />
			{:else}
				<EmptyState description="Notebooks hold cells that build on each other as models.">
					{#snippet icon()}<NotebookText class="h-4 w-4" />{/snippet}
					{#snippet actions()}
						<Button variant="ghost" size="sm" onclick={() => addNotebook()}>
							<Plus /> New notebook
						</Button>
						<Button variant="ghost" size="sm" onclick={() => onBrowseTemplates?.()}>
							<FlaskConical /> Browse templates
						</Button>
					{/snippet}
				</EmptyState>
			{/if}
		{:else}
			{#each treeRows as row (row.kind === 'folder' ? `f:${row.folder.id}` : row.kind === 'notebook' ? `n:${row.notebook.id}` : row.kind === 'outline' ? `o:${row.notebook.id}:${row.entry.id}` : `c:${row.cell.id}`)}
				{#if row.kind === 'folder'}
					{@const isExpanded = expandedFolderIds.includes(row.folder.id)}
					<div in:fade={{ duration: fadeMs }}>
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								<TreeRow
									depth={row.depth}
									expandable
									expanded={isExpanded}
									dragTarget={dragOverFolderId === row.folder.id}
									onActivate={() => toggleFolder(row.folder.id)}
									ondragover={(e) => {
										e.preventDefault();
										e.stopPropagation();
										dragOverFolderId = row.folder.id;
									}}
									ondragleave={() => {
										if (dragOverFolderId === row.folder.id) dragOverFolderId = null;
									}}
									ondrop={(e) => {
										e.preventDefault();
										e.stopPropagation();
										const id = e.dataTransfer?.getData('text/plain') ?? draggingNotebookId;
										if (id) moveNotebookToFolder(id, row.folder.id);
										dragOverFolderId = null;
										dragOverRoot = false;
										draggingNotebookId = null;
									}}
								>
									{#snippet icon()}
										{#if isExpanded}
											<FolderOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										{:else}
											<Folder class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
										{/if}
									{/snippet}
									{#snippet label()}
										{#if renamingFolderId === row.folder.id}
											<!-- svelte-ignore a11y_autofocus -->
											<input
												autofocus
												class="h-5 min-w-0 flex-1 rounded-sm border border-border bg-input px-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
												bind:value={renameValue}
												onblur={commitRename}
												onkeydown={onRenameKeydown}
												onclick={(e) => e.stopPropagation()}
											/>
										{:else}
											<span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">
												{row.folder.name}
											</span>
										{/if}
									{/snippet}
									{#snippet trailing()}
										<button
											class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
											onclick={(e) => {
												e.stopPropagation();
												createNotebookAt(row.folder.id);
											}}
											aria-label="New notebook in folder"
										>
											<Plus class="h-3.5 w-3.5" />
										</button>
										{@render rowMenu(`folder:${row.folder.id}`, folderActions(row.folder), false)}
									{/snippet}
								</TreeRow>
							</ContextMenu.Trigger>
							<ContextMenu.Content class="w-48">
								{@render contextItems(folderActions(row.folder))}
							</ContextMenu.Content>
						</ContextMenu.Root>
					</div>
				{:else if row.kind === 'notebook'}
					{@const isActive = activeTabId === row.notebook.id}
					{@const isOpen = openTabIds.includes(row.notebook.id)}
					{@const isDragging = draggingNotebookId === row.notebook.id}
					{@const isExpanded = expandedNotebookIds.includes(row.notebook.id)}
					<div in:fade={{ duration: fadeMs }}>
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								<TreeRow
									depth={row.depth}
									selected={isActive}
									class={isDragging ? 'opacity-50' : ''}
									onActivate={() => openNotebookTab(row.notebook.id)}
									draggable={true}
									ondragstart={(e) => {
										draggingNotebookId = row.notebook.id;
										e.dataTransfer?.setData('text/plain', row.notebook.id);
									}}
									ondragend={() => {
										draggingNotebookId = null;
										dragOverFolderId = null;
										dragOverRoot = false;
									}}
								>
									{#snippet icon()}
										<NotebookText
											class="h-3.5 w-3.5 shrink-0 {isActive
												? 'text-foreground'
												: 'text-muted-foreground'}"
										/>
									{/snippet}
									{#snippet label()}
										{#if renamingNotebookId === row.notebook.id}
											<!-- svelte-ignore a11y_autofocus -->
											<input
												autofocus
												class="h-5 min-w-0 flex-1 rounded-sm border border-border bg-input px-1.5 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
												bind:value={renameValue}
												onblur={commitRename}
												onkeydown={onRenameKeydown}
												onclick={(e) => e.stopPropagation()}
											/>
										{:else}
											<span class="flex min-w-0 flex-1 items-baseline gap-1.5">
												<span
													class="truncate text-xs {isActive
														? 'font-medium text-foreground'
														: 'text-foreground/80'}"
												>
													{row.notebook.name}
												</span>
												{#if row.folderName}
													<span class="truncate text-2xs text-muted-foreground/70"
														>{row.folderName}</span
													>
												{/if}
											</span>
										{/if}
									{/snippet}
									{#snippet trailing()}
										{#if isNotebookDirty(row.notebook.id)}
											<span
												class="h-2 w-2 shrink-0 rounded-full bg-warning/90 ring-1 ring-background group-hover/row:hidden"
												title="Unsaved changes"
											></span>
										{:else if isOpen && !isActive}
											<span
												class="h-2 w-2 shrink-0 rounded-full bg-primary/60 ring-1 ring-background group-hover/row:hidden"
												title="Open in a tab"
											></span>
										{/if}
										{#if row.notebook.cells.length > 0}
											<button
												class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-[opacity,transform] group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
												onclick={(e) => {
													e.stopPropagation();
													toggleNotebookExpanded(row.notebook.id);
												}}
												aria-label={isExpanded ? 'Collapse outline' : 'Expand outline'}
											>
												<ChevronRight
													class="h-3 w-3 transition-transform duration-150 {isExpanded
														? 'rotate-90'
														: ''}"
												/>
											</button>
										{/if}
										<button
											type="button"
											class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm transition-opacity hover:bg-sidebar-accent {favoriteIds.includes(
												row.notebook.id
											)
												? 'text-primary opacity-100'
												: 'text-muted-foreground opacity-0 group-hover/row:opacity-100'}"
											title={favoriteIds.includes(row.notebook.id)
												? 'Remove from favorites'
												: 'Add to favorites'}
											aria-label="Toggle favorite"
											onclick={(e) => {
												e.stopPropagation();
												toggleFavoriteNotebook(row.notebook.id);
											}}
										>
											<Star
												class="h-3 w-3 {favoriteIds.includes(row.notebook.id)
													? 'fill-current'
													: ''}"
											/>
										</button>
										{@render rowMenu(
											`notebook:${row.notebook.id}`,
											notebookActions(row.notebook),
											isActive
										)}
									{/snippet}
								</TreeRow>
							</ContextMenu.Trigger>
							<ContextMenu.Content class="w-48">
								{@render contextItems(notebookActions(row.notebook))}
							</ContextMenu.Content>
						</ContextMenu.Root>
					</div>
				{:else if row.kind === 'outline'}
					<div in:fade={{ duration: fadeMs }}>
						<TreeRow
							depth={row.depth}
							selected={activeTabId === row.notebook.id}
							onActivate={() => navigateToOutlineEntry(row.notebook.id, row.entry)}
						>
							{#snippet icon()}
								{#if row.entry.kind === 'heading'}
									<Hash class="h-3 w-3 shrink-0 text-muted-foreground" />
								{:else}
									<Code2 class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								{/if}
							{/snippet}
							{#snippet label()}
								<span class="min-w-0 flex-1 truncate text-xs text-foreground/75">
									{row.entry.label}
								</span>
							{/snippet}
						</TreeRow>
					</div>
				{:else if row.kind === 'cell'}
					<div in:fade={{ duration: fadeMs }}>
						<TreeRow
							depth={row.depth}
							onActivate={() => openNotebookTabAtCell(row.notebook.id, row.cell.id)}
						>
							{#snippet icon()}
								{#if row.cell.cellType === 'query'}
									<Code2 class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								{:else}
									<Type class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								{/if}
							{/snippet}
							{#snippet label()}
								<span class="min-w-0 flex-1 truncate font-mono text-xs text-foreground/70">
									{row.cell.outputName || 'Untitled'}
								</span>
							{/snippet}
						</TreeRow>
					</div>
				{/if}
			{/each}
		{/if}
	</div>
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title={confirmTarget?.kind === 'folder'
		? `Delete folder "${confirmTarget?.name}"?`
		: `Delete "${confirmTarget?.name ?? ''}"?`}
	body={confirmTarget?.kind === 'folder'
		? 'The folder will be removed. This cannot be undone.'
		: 'The notebook and its cells will be removed. This cannot be undone.'}
	confirmLabel={confirmTarget?.kind === 'folder' ? 'Delete folder' : 'Delete notebook'}
	onConfirm={executeDelete}
/>
