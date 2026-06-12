<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { initDB } from '$lib/services/duckdb';
	import { initPRQL } from '$lib/services/prql';
	import { withTimeout } from '$lib/services/async';
	import Logo from '$lib/assets/logo.svelte';

	import {
		getCells,
		getConnections,
		getTables,
		getTheme,
		getNotebooks,
		getOpenNotebookTabs,
		getOpenResultTabs,
		getOpenExtraTabs,
		getActiveTabId,
		getSidebarSectionsExpanded,
		getCellForResultTab,
		addCellWithLanguage,
		addMarkdownCell,
		addNotebook,
		renameNotebook,
		createFolder,
		setActiveTab,
		setSidebarSectionExpanded,
		closeNotebookTab,
		closeOtherNotebookTabs,
		closeAllNotebookTabs,
		closeResultTab,
		closeOtherResultTabs,
		closeAllResultTabs,
		closeExtraTab,
		closeOtherExtraTabs,
		closeAllExtraTabs,
		openResultTab,
		runAll,
		runAllStale,
		getNotebookStaleCellCount,
		setTheme,
		getAutoRun,
		setAutoRun,
		getLLMConfig,
		setLLMConfig,
		exportJSON,
		importJSON,
		loadFromStorage,
		updateCellCode,
		setEditMode,
		updateGuiStages,
		refreshTablesFromCatalog,
		setNotebookConnection,
		addTable,
		getProjectFolder,
		getIsDbtProject,
		getIsEvidenceProject,
		getStorageMode,
		isNotebookDirty,
		scheduleFileSave,
		openLineageTab,
		getDashboards,
		createDashboard,
		openDashboardTab,
		duplicateNotebook,
		closeProject,
		openProject,
		clearAllResults,
		setNotebookDefaultCellLanguage,
		loadDemoNotebook,
		runCell,
		insertCellBefore,
		insertMarkdownCellBefore,
		reorderCell,
		setAllCellsDisplay,
		setNotebookReportView
	} from '$lib/stores/notebook.svelte';
	import Sortable from 'sortablejs';
	import AddCellDivider from '$lib/components/AddCellDivider.svelte';
	import { isDesktop, platformOS } from '$lib/services/platform.svelte';
	import WindowControls from '$lib/components/WindowControls.svelte';
	import NotebookCell from '$lib/components/NotebookCell.svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Popover from '$lib/components/ui/popover';
	import DatabaseTree from '$lib/components/DatabaseTree.svelte';
	import FileImporter from '$lib/components/FileImporter.svelte';
	import ConnectionManager from '$lib/components/ConnectionManager.svelte';
	import NotebookTree from '$lib/components/NotebookTree.svelte';
	import ProjectSection from '$lib/components/ProjectSection.svelte';
	import DbtPanel from '$lib/components/DbtPanel.svelte';
	import EvidencePanel from '$lib/components/EvidencePanel.svelte';
	import EvidencePreview from '$lib/components/EvidencePreview.svelte';
	import ResultView from '$lib/components/ResultView.svelte';
	import TableView from '$lib/components/TableView.svelte';
	import ProfileView from '$lib/components/ProfileView.svelte';
	import DbtLineageView from '$lib/components/DbtLineageView.svelte';
	import DashboardView from '$lib/components/DashboardView.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { toast } from 'svelte-sonner';
	import { BUILTIN_DUCKDB_CONNECTION_ID } from '$lib/types/connection';
	import type { GUISourceSchema } from '$lib/types/gui-pipeline';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		Play,
		Plus,
		ChevronDown,
		ChevronRight,
		Sun,
		Moon,
		Monitor,
		Database,
		Orbit,
		X,
		Table2,
		BarChart2,
		Network,
		Check,
		FolderPlus,
		Search,
		Info,
		Settings,
		LayoutDashboard,
		RefreshCw,
		PanelLeftClose,
		PanelLeftOpen,
		BookOpen,
		FlaskConical,
		MonitorPlay,
		ExternalLink,
		Upload,
		Copy,
		Trash2,
		FolderOpen,
		Code2,
		FileCode2,
		SidebarClose
	} from '@lucide/svelte';

	// ── Reactive state ──────────────────────────────────────────────────────
	const cells = $derived(getCells());
	const tables = $derived(getTables());
	const connections = $derived(getConnections());
	const theme = $derived(getTheme());
	const autoRun = $derived(getAutoRun());
	const llmConfig = $derived(getLLMConfig());
	const notebooks = $derived(getOpenNotebookTabs());
	const allNotebooks = $derived(getNotebooks());
	const openResultTabs = $derived(getOpenResultTabs());
	const openExtraTabs = $derived(getOpenExtraTabs());
	const activeTabId = $derived(getActiveTabId());
	const sidebarSectionsExpanded = $derived(getSidebarSectionsExpanded());
	const activeExtraTab = $derived(openExtraTabs.find((t) => t.id === activeTabId) ?? null);
	const projectFolder = $derived(getProjectFolder());
	const isDbtProject = $derived(getIsDbtProject());
	const isEvidenceProject = $derived(getIsEvidenceProject());
	const storageMode = $derived(getStorageMode());
	const activeResultTab = $derived(openResultTabs.find((t) => t.id === activeTabId) ?? null);
	const isNotebookTab = $derived(
		allNotebooks.some((n) => n.id === activeTabId) &&
		!openExtraTabs.some((t) => t.id === activeTabId)
	);
	const activeNotebook = $derived(allNotebooks.find((n) => n.id === activeTabId) ?? null);
	const activeNotebookConnectionValue = $derived.by(() => {
		if (!activeNotebook) return BUILTIN_DUCKDB_CONNECTION_ID;
		const queryCells = activeNotebook.cells.filter((cell) => cell.cellType === 'query');
		if (queryCells.length === 0) return BUILTIN_DUCKDB_CONNECTION_ID;
		const first = queryCells[0].connectionId ?? BUILTIN_DUCKDB_CONNECTION_ID;
		return queryCells.every((cell) => (cell.connectionId ?? BUILTIN_DUCKDB_CONNECTION_ID) === first)
			? first
			: '__mixed__';
	});
	const isDark = $derived(
		theme === 'dark' ||
		(theme === 'system' &&
			typeof window !== 'undefined' &&
			window.matchMedia('(prefers-color-scheme: dark)').matches)
	);
	const reportView = $derived(Boolean(activeNotebook?.reportView));

	// ── Cell list: insert dividers + drag reorder ─────────────────────────────
	function focusCellAt(index: number) {
		tick().then(() => {
			const all = document.querySelectorAll<HTMLElement>('.notebook-cell[tabindex]');
			(all[index] ?? all[all.length - 1])?.focus();
		});
	}

	// Divider above the cell at `index`: insert before it.
	function insertBeforeCell(kind: 'default' | 'prql' | 'sql' | 'markdown', index: number) {
		const target = cells[index];
		if (!target) return;
		if (kind === 'markdown') {
			insertMarkdownCellBefore(target.id);
		} else {
			const lang = kind === 'default' ? (activeNotebook?.defaultCellLanguage ?? 'sql') : kind;
			insertCellBefore(target.id, {
				outputName: '',
				code: '',
				guiStages: [{ type: 'from', table: '' }],
				editMode: lang === 'sql' ? 'prql' : 'gui',
				language: lang
			});
		}
		focusCellAt(index);
	}

	function appendCell(kind: 'default' | 'prql' | 'sql' | 'markdown') {
		if (kind === 'markdown') {
			addMarkdownCell();
		} else {
			addCellWithLanguage(kind === 'default' ? (activeNotebook?.defaultCellLanguage ?? 'sql') : kind);
		}
		focusCellAt(cells.length);
	}

	let cellListEl: HTMLElement | undefined = $state();
	$effect(() => {
		if (!cellListEl) return;
		const sortable = Sortable.create(cellListEl, {
			handle: '[data-drag-handle]',
			animation: 150,
			ghostClass: 'cell-sort-ghost',
			onEnd(evt) {
				const id = (evt.item as HTMLElement).dataset.cellId;
				const oldIdx = evt.oldIndex ?? 0;
				const newIdx = evt.newIndex ?? 0;
				if (!id || oldIdx === newIdx) return;
				reorderCell(id, newIdx);
			}
		});
		return () => sortable.destroy();
	});

	// ── Init ─────────────────────────────────────────────────────────────────
	let dbReady = $state(false);
	let dbError = $state<string | null>(null);
	let llmSettingsOpen = $state(false);
	let shortcutsOpen = $state(false);
	let projectOpenDialogOpen = $state(false);
	let projectFolderInput = $state('');
	let projectOpenLoading = $state(false);
	let aboutOpen = $state(false);
	let sidebarSearch = $state('');
	let showNotebookSearch = $state(false);
	let activeSidebarPanel = $state<'notebooks' | 'dashboards' | 'tables' | 'dbt' | 'evidence'>('notebooks');

	const SIDEBAR_WIDTH_KEY = 'lunapad.sidebar.width';
	const SIDEBAR_COLLAPSED_KEY = 'lunapad.sidebar.collapsed';
	let sidebarWidth = $state(260);
	let sidebarCollapsed = $state(false);
	let isDraggingSidebar = $state(false);
	let layoutRoot: HTMLDivElement | null = null;

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	function updateSidebarFromClientX(clientX: number) {
		if (!layoutRoot) return;
		const rect = layoutRoot.getBoundingClientRect();
		if (rect.width <= 0) return;
		sidebarWidth = clamp(clientX - rect.left, 220, 460);
	}

	function toggleSidebarCollapsed() {
		sidebarCollapsed = !sidebarCollapsed;
		localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
	}

	function onSidebarPointerDown(e: PointerEvent) {
		if (sidebarCollapsed) return;
		isDraggingSidebar = true;
		updateSidebarFromClientX(e.clientX);
	}

	function onSidebarPointerMove(e: PointerEvent) {
		if (!isDraggingSidebar) return;
		updateSidebarFromClientX(e.clientX);
	}

	function onSidebarPointerUp() {
		if (!isDraggingSidebar) return;
		isDraggingSidebar = false;
		localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
	}



	function toggleSidebarSection(section: 'notebooks' | 'tables' | 'dashboards') {
		setSidebarSectionExpanded(section, !sidebarSectionsExpanded[section]);
	}

	async function initializeRuntime() {
		dbError = null;
		dbReady = false;
		try {
			await withTimeout(
				Promise.all([initDB(), initPRQL()]),
				'Initializing application runtime',
				70_000
			);
			await refreshTablesFromCatalog();
			dbReady = true;
		} catch (err: unknown) {
			dbError = err instanceof Error ? err.message : String(err);
		}
	}

	onMount(async () => {
		const savedSidebarWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
		if (savedSidebarWidth) {
			const parsed = Number(savedSidebarWidth);
			if (!Number.isNaN(parsed)) {
				sidebarWidth = clamp(parsed, 220, 460);
			}
		}
		sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
		window.addEventListener('pointermove', onSidebarPointerMove);
		window.addEventListener('pointerup', onSidebarPointerUp);
		layoutRoot = document.getElementById('layout-root') as HTMLDivElement | null;
		try {
			loadFromStorage();
		} catch {
			toast.error('Stored workspace state is invalid and was ignored.');
		}

		// Expose test helpers on window for Playwright E2E tests (dev/test only)
		if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
			(window as any).__testHelpers = {
				updateCellCode,
				setEditMode,
				getCells,
				tick,
				addTable,
				refreshTablesFromCatalog
			};
		}

		await initializeRuntime();

		if (new URLSearchParams(window.location.search).get('demo') === '1') {
			loadDemoNotebook();
			await tick();
			for (const cell of getCells()) {
				if (cell.cellType === 'query') await runCell(cell.id);
			}
		}
	});

	onDestroy(() => {
		window.removeEventListener('pointermove', onSidebarPointerMove);
		window.removeEventListener('pointerup', onSidebarPointerUp);
	});

	// ── Run All ──────────────────────────────────────────────────────────────
	let runningAll = $state(false);
	async function handleRunAll() {
		runningAll = true;
		try {
			await runAll();
			toast.success('All cells executed');
		} catch (err: unknown) {
			toast.error((err as Error).message);
		} finally {
			runningAll = false;
		}
	}

	let runningAllStale = $state(false);
	const staleCellCount = $derived(getNotebookStaleCellCount());
	async function handleRunAllStale() {
		runningAllStale = true;
		try {
			await runAllStale();
			toast.success('All stale cells refreshed');
		} catch (err: unknown) {
			toast.error((err as Error).message);
		} finally {
			runningAllStale = false;
		}
	}

	// ── Theme cycle ──────────────────────────────────────────────────────────
	function cycleTheme() {
		const order: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];
		const next = order[(order.indexOf(theme) + 1) % order.length];
		setTheme(next);
	}

	// ── Open project ─────────────────────────────────────────────────────────
	async function handleOpenProject() {
		if (!projectFolderInput.trim()) return;
		projectOpenLoading = true;
		try {
			await openProject(projectFolderInput.trim());
			projectOpenDialogOpen = false;
			projectFolderInput = '';
			toast.success('Project opened');
		} catch (err: unknown) {
			toast.error((err as Error).message ?? 'Failed to open project');
		} finally {
			projectOpenLoading = false;
		}
	}

	// ── Export / Import ───────────────────────────────────────────────────────
	function handleExport() {
		const json = exportJSON();
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'notebook.lunapad.json';
		a.click();
		URL.revokeObjectURL(url);
		toast.success('Notebook exported');
	}

	function handleImport() {
		const input = document.getElementById('import-notebook-input') as HTMLInputElement | null;
		input?.click();
	}
	function onImportFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			try {
				importJSON(ev.target!.result as string);
				toast.success('Notebook imported');
			} catch {
				toast.error('Invalid notebook file');
			}
		};
		reader.readAsText(file);
		(e.target as HTMLInputElement).value = '';
	}

	// ── Prev view name helper ─────────────────────────────────────────────────
	function prevSourcesForCell(idx: number): GUISourceSchema[] {
		// CTE expansion now works for all connection types (DuckDB, Postgres, ClickHouse).
		// Expose all preceding query cells with output names as FROM source options.
		return cells
			.slice(0, idx)
			.filter((c) => c.cellType === 'query' && c.outputName)
			.map((c) => ({
				name: c.outputName || `_cell_${c.id}`,
				columns: c.result?.columns ?? []
			}));
	}



	let pendingRenameFolderId = $state<string | null>(null);

	// ── Tab rename state ──────────────────────────────────────────────────────
	let renamingTabId = $state<string | null>(null);
	let renameValue = $state('');

	function startRename(id: string, currentName: string) {
		renamingTabId = id;
		renameValue = currentName;
	}

	function commitRename() {
		if (renamingTabId && renameValue.trim()) {
			renameNotebook(renamingTabId, renameValue.trim());
		}
		renamingTabId = null;
	}

	function onRenameKeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') commitRename();
		if (e.key === 'Escape') renamingTabId = null;
	}

	// ── Open result tab handler ───────────────────────────────────────────────
	function handleOpenResultTab(
		cellId: string,
		notebookId: string,
		name: string,
		preferredViewMode: 'table' | 'chart' | 'stats' = 'table'
	) {
		openResultTab(cellId, notebookId, name, preferredViewMode);
	}

	// ── Global keyboard shortcuts ─────────────────────────────────────────────
	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName.toLowerCase();
		return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
	}

	// Auto-focus first cell once per notebook tab, but only after dbReady
	let lastAutoFocusedTab = '';
	$effect(() => {
		const tabId = activeTabId;
		const ready = dbReady; // tracked: re-runs when dbReady flips true
		if (!ready || !isNotebookTab) return;
		if (tabId === lastAutoFocusedTab) return; // already handled this tab
		lastAutoFocusedTab = tabId;
		tick().then(() => {
			const ae = document.activeElement;
			if (!ae || ae === document.body || ae === document.documentElement) {
				document.querySelector<HTMLElement>('.notebook-cell[tabindex]')?.focus();
			}
		});
	});

	function onGlobalKeydown(e: KeyboardEvent) {
		const mod = e.metaKey || e.ctrlKey;
		// Cmd+S: immediate save (also works when typing target is focused)
		if (mod && (e.key === 's' || e.key === 'S')) {
			e.preventDefault();
			if (storageMode === 'filesystem' && activeNotebook) {
				activeNotebook.cells.forEach((cell) => scheduleFileSave(activeNotebook!.id, cell.id));
			}
			return;
		}
		if (isTypingTarget(e.target)) return;
		if (e.key === '?') { e.preventDefault(); shortcutsOpen = true; return; }
		// Cmd+1-9: switch to notebook tab by position
		if (mod && !e.shiftKey && /^[1-9]$/.test(e.key)) {
			const idx = parseInt(e.key) - 1;
			if (notebooks[idx]) { e.preventDefault(); setActiveTab(notebooks[idx].id); return; }
		}
		if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); toggleSidebarCollapsed(); return; }
		if (!isNotebookTab) return;
		if (mod && e.shiftKey && e.key === 'Enter') { e.preventDefault(); addCellWithLanguage('prql'); }
		if (mod && e.shiftKey && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); addMarkdownCell(); }
		if (mod && e.shiftKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); void handleRunAll(); }
	}

</script>

<svelte:head>
  <title>Lunapad | Analytics Workspace</title>
</svelte:head>

<svelte:window onkeydown={onGlobalKeydown} />

<!-- Loading screen -->
{#if !dbReady}
	<div class="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background">
		{#if dbError}
			<div class="text-center">
					<p class="text-destructive font-medium mb-2">Failed to initialize DuckDB</p>
				<p class="text-xs text-muted-foreground font-mono max-w-md">{dbError}</p>
				<div class="mt-4">
					<Button size="sm" onclick={initializeRuntime}>Retry</Button>
				</div>
			</div>
		{:else}
			<div class="flex items-center gap-3">
				<Orbit class="w-6 h-6 text-primary animate-pulse" />
				<span class="text-sm text-muted-foreground">Initializing WASM engines…</span>
			</div>
			<div class="space-y-2 w-64">
				<Skeleton class="h-2 w-full" />
				<Skeleton class="h-2 w-4/5" />
				<Skeleton class="h-2 w-3/5" />
			</div>
		{/if}
	</div>
{:else}
	<div class="flex flex-col h-screen overflow-hidden">
		<header
			class="border-b border-border/60 bg-background sticky top-0 z-(--z-sticky)"
			data-tauri-drag-region={isDesktop ? '' : undefined}
		>
			<div
				class="flex items-center justify-between py-2"
				style="padding-left: max(1rem, var(--titlebar-inset-left)); padding-right: max(1rem, var(--titlebar-inset-right))"
			>
				<div class="flex items-center gap-2">
					<div class="flex items-center gap-2 shrink-0">
						<Logo class="w-6 h-6 text-primary" />
						<span class="text-sm font-semibold tracking-tight">Lunapad</span>
					</div>
					<div class="h-5 w-px bg-border mx-1"></div>
					<div class="flex items-center gap-0.5">
						<DropdownMenu.Root>
							<DropdownMenu.Trigger class="h-7 rounded-md px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground data-open:bg-muted data-open:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">File</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-52">
								<DropdownMenu.Item onclick={() => addNotebook()}>
									<Plus class="w-3.5 h-3.5" /> New notebook
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => loadDemoNotebook()}>
									<FlaskConical class="w-3.5 h-3.5" /> Load demo notebook
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => addCellWithLanguage('prql')}>
									<Code2 class="w-3.5 h-3.5" /> New PRQL cell
									<DropdownMenu.Shortcut>⇧⌘↵</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => addCellWithLanguage('sql')}>
									<FileCode2 class="w-3.5 h-3.5" /> New SQL cell
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => addMarkdownCell()}>
									<BookOpen class="w-3.5 h-3.5" /> New markdown cell
									<DropdownMenu.Shortcut>⇧⌘M</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item onclick={() => (projectOpenDialogOpen = true)}>
									<FolderOpen class="w-3.5 h-3.5" /> Open project…
								</DropdownMenu.Item>
								<DropdownMenu.Item disabled={!projectFolder} onclick={() => closeProject()}>
									<X class="w-3.5 h-3.5" /> Close project
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item onclick={() => { activeSidebarPanel = 'tables'; sidebarCollapsed = false; }}>
									<Upload class="w-3.5 h-3.5" /> Upload data file…
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item onclick={handleImport}>Import notebook…</DropdownMenu.Item>
								<DropdownMenu.Item onclick={handleExport}>Export notebook</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger class="h-7 rounded-md px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground data-open:bg-muted data-open:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Edit</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-56">
								<DropdownMenu.Sub>
									<DropdownMenu.SubTrigger>
										<Code2 class="w-3.5 h-3.5" /> Default cell type
									</DropdownMenu.SubTrigger>
									<DropdownMenu.SubContent>
										<DropdownMenu.RadioGroup
											value={activeNotebook?.defaultCellLanguage ?? 'sql'}
											onValueChange={(value) => { if (activeNotebook && (value === 'prql' || value === 'sql')) setNotebookDefaultCellLanguage(activeNotebook.id, value); }}
										>
											<DropdownMenu.RadioItem value="prql">PRQL</DropdownMenu.RadioItem>
											<DropdownMenu.RadioItem value="sql">SQL</DropdownMenu.RadioItem>
										</DropdownMenu.RadioGroup>
									</DropdownMenu.SubContent>
								</DropdownMenu.Sub>
								<DropdownMenu.Separator />
								<DropdownMenu.Item disabled={!activeNotebook} onclick={() => { if (activeNotebook) duplicateNotebook(activeNotebook.id); }}>
									<Copy class="w-3.5 h-3.5" /> Duplicate notebook
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item onclick={() => { clearAllResults(); toast.success('All results cleared'); }}>
									<Trash2 class="w-3.5 h-3.5" /> Clear all results
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger class="h-7 rounded-md px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground data-open:bg-muted data-open:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Run</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-48">
								<DropdownMenu.Item disabled={runningAll || cells.length === 0} onclick={() => void handleRunAll()}>
									<Play class="w-3.5 h-3.5 fill-current" /> Run all cells
								</DropdownMenu.Item>
								{#if staleCellCount > 0}
									<DropdownMenu.Item disabled={runningAllStale || runningAll} onclick={() => void handleRunAllStale()}>
										<RefreshCw class="w-3.5 h-3.5" /> Run stale cells
										<span class="ml-auto rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs font-medium text-warning">{staleCellCount}</span>
									</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Separator />
								<DropdownMenu.CheckboxItem checked={autoRun} onCheckedChange={(checked) => setAutoRun(checked)}>
									Auto Run
								</DropdownMenu.CheckboxItem>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger class="h-7 rounded-md px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground data-open:bg-muted data-open:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">View</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-56">
								<DropdownMenu.Item onclick={toggleSidebarCollapsed}>
									<SidebarClose class="w-3.5 h-3.5" /> Toggle sidebar
									<DropdownMenu.Shortcut>⌘B</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item disabled={!isNotebookTab} onclick={() => setAllCellsDisplay('collapsed')}>
									Collapse all cells
								</DropdownMenu.Item>
								<DropdownMenu.Item disabled={!isNotebookTab} onclick={() => setAllCellsDisplay('full')}>
									Expand all cells
								</DropdownMenu.Item>
								<DropdownMenu.CheckboxItem
									disabled={!activeNotebook}
									checked={reportView}
									onCheckedChange={(checked) => setNotebookReportView(checked)}
								>
									Report view
								</DropdownMenu.CheckboxItem>
								<DropdownMenu.Separator />
								<DropdownMenu.RadioGroup value={theme} onValueChange={(value) => { if (value === 'system' || value === 'light' || value === 'dark') setTheme(value); }}>
									<DropdownMenu.RadioItem value="system"><Monitor class="w-3.5 h-3.5" /> System theme</DropdownMenu.RadioItem>
									<DropdownMenu.RadioItem value="light"><Sun class="w-3.5 h-3.5" /> Light theme</DropdownMenu.RadioItem>
									<DropdownMenu.RadioItem value="dark"><Moon class="w-3.5 h-3.5" /> Dark theme</DropdownMenu.RadioItem>
								</DropdownMenu.RadioGroup>
								<DropdownMenu.Separator />
								<DropdownMenu.Item onclick={() => (llmSettingsOpen = true)}>
									<Settings class="w-3.5 h-3.5" /> LLM settings…
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger class="h-7 rounded-md px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground data-open:bg-muted data-open:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Help</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-52">
								<DropdownMenu.Item onclick={() => (shortcutsOpen = true)}>
									Keyboard shortcuts
									<DropdownMenu.Shortcut>?</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item onclick={() => window.open('https://prql-lang.org/book/', '_blank')}>
									<BookOpen class="w-3.5 h-3.5" /> PRQL documentation
									<ExternalLink class="w-3.5 h-3.5 ml-auto text-muted-foreground" />
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => window.open('https://github.com/PRQL/prql/issues', '_blank')}>
									<ExternalLink class="w-3.5 h-3.5" /> Report an issue
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item onclick={() => (aboutOpen = true)}>
									<Info class="w-3.5 h-3.5" /> About Lunapad
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				</div>

				<Popover.Root>
					<Popover.Trigger
						class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
						aria-label="Show workspace stats"
					>
						<Info class="h-3.5 w-3.5" />
					</Popover.Trigger>
					<Popover.Content align="end" class="w-60 p-2">
						<p class="px-2 py-1 text-2xs font-semibold text-muted-foreground">Workspace stats</p>
						<div class="space-y-1 px-2 py-1 text-xs text-muted-foreground">
							<div class="flex items-center justify-between">
								<span>Open notebooks</span>
								<span class="font-mono text-foreground">{notebooks.length}</span>
							</div>
							<div class="flex items-center justify-between">
								<span>Relations</span>
								<span class="font-mono text-foreground">{tables.length}</span>
							</div>
							<div class="flex items-center justify-between">
								<span>Result tabs</span>
								<span class="font-mono text-foreground">{openResultTabs.length}</span>
							</div>
							<div class="flex items-center justify-between">
								<span>Extra tabs</span>
								<span class="font-mono text-foreground">{openExtraTabs.length}</span>
							</div>
							<div class="flex items-center justify-between">
								<span>Theme</span>
								<span class="font-mono text-foreground">{theme}</span>
							</div>
							<div class="flex items-center justify-between">
								<span>Auto-run</span>
								<span class="font-mono text-foreground">{autoRun ? 'on' : 'off'}</span>
							</div>
						</div>
					</Popover.Content>
				</Popover.Root>

				<input
					id="import-notebook-input"
					type="file"
					accept=".json"
					class="hidden"
					onchange={onImportFile}
				/>
			</div>
			{#if isDesktop && (platformOS.value === 'windows' || platformOS.value === 'linux')}
				<div class="absolute right-0 top-0 h-full pointer-events-auto">
					<WindowControls />
				</div>
			{/if}
		</header>

		<div id="layout-root" class="flex flex-1 overflow-hidden">
			<div
				class="h-full border-r border-sidebar-border/60 bg-sidebar text-sidebar-foreground flex flex-row overflow-hidden transition-none"
				style={sidebarCollapsed ? 'width: 0; border: none' : `width: ${sidebarWidth}px`}
			>
				<!-- Icon rail -->
				<div class="w-8 shrink-0 border-r border-sidebar-border/40 bg-sidebar flex flex-col items-center pt-1 pb-2 gap-0.5">
					<button
						class="h-7 w-7 flex items-center justify-center rounded transition-colors {activeSidebarPanel === 'notebooks' ? 'bg-primary/15 text-primary' : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/60'}"
						onclick={() => (activeSidebarPanel = 'notebooks')}
						title="Notebooks"
						aria-label="Notebooks"
					>
						<BookOpen class="h-3.5 w-3.5" />
					</button>
					<button
						class="h-7 w-7 flex items-center justify-center rounded transition-colors {activeSidebarPanel === 'dashboards' ? 'bg-primary/15 text-primary' : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/60'}"
						onclick={() => (activeSidebarPanel = 'dashboards')}
						title="Dashboards"
						aria-label="Dashboards"
					>
						<LayoutDashboard class="h-3.5 w-3.5" />
					</button>
					<button
						class="h-7 w-7 flex items-center justify-center rounded transition-colors {activeSidebarPanel === 'tables' ? 'bg-primary/15 text-primary' : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/60'}"
						onclick={() => (activeSidebarPanel = 'tables')}
						title="Databases & tables"
						aria-label="Databases & tables"
					>
						<Database class="h-3.5 w-3.5" />
					</button>
					{#if isDbtProject}
						<button
							class="h-7 w-7 flex items-center justify-center rounded transition-colors {activeSidebarPanel === 'dbt' ? 'bg-primary/15 text-primary' : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/60'}"
							onclick={() => (activeSidebarPanel = 'dbt')}
							title="dbt models"
							aria-label="dbt models"
						>
							<FlaskConical class="h-3.5 w-3.5" />
						</button>
					{/if}
					{#if isEvidenceProject}
						<button
							class="h-7 w-7 flex items-center justify-center rounded transition-colors {activeSidebarPanel === 'evidence' ? 'bg-primary/15 text-primary' : 'text-muted-foreground/60 hover:text-foreground hover:bg-muted/60'}"
							onclick={() => (activeSidebarPanel = 'evidence')}
							title="Evidence pages"
							aria-label="Evidence pages"
						>
							<MonitorPlay class="h-3.5 w-3.5" />
						</button>
					{/if}
				</div>

				<!-- Panel content -->
				<div class="flex-1 min-w-0 flex flex-col overflow-hidden">
					<ProjectSection />

					{#if activeSidebarPanel === 'notebooks'}
						<!-- Notebooks panel -->
						<div class="flex h-9 shrink-0 items-center px-2 border-b border-border/30">
							<span class="text-2xs font-medium text-muted-foreground flex-1">Notebooks</span>
							<div class="flex items-center gap-0.5">
								<button
									class="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors {sidebarSearch ? 'text-primary' : ''}"
									onclick={() => { showNotebookSearch = !showNotebookSearch; if (!showNotebookSearch) sidebarSearch = ''; }}
									title="Filter notebooks"
									aria-label="Filter notebooks"
								>
									<Search class="h-3 w-3" />
								</button>
								<button
									class="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
									onclick={() => { pendingRenameFolderId = createFolder('New Folder', null); }}
									title="New folder"
									aria-label="New folder"
								>
									<FolderPlus class="h-3 w-3" />
								</button>
								<button
									class="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
									onclick={() => addNotebook()}
									title="New notebook"
									aria-label="New notebook"
								>
									<Plus class="h-3 w-3" />
								</button>
							</div>
						</div>

						{#if showNotebookSearch || sidebarSearch}
							<div class="mx-2 my-1 flex h-7 items-center gap-1.5 rounded border border-border/60 bg-muted/30 px-2 shrink-0">
								<Search class="h-3 w-3 shrink-0 text-muted-foreground/50" />
								<!-- svelte-ignore a11y_autofocus -->
								<input
									autofocus
									class="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 outline-none"
									placeholder="Filter notebooks…"
									bind:value={sidebarSearch}
									onkeydown={(e) => { if (e.key === 'Escape') { sidebarSearch = ''; showNotebookSearch = false; } }}
								/>
								{#if sidebarSearch}
									<button
										class="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
										onclick={() => { sidebarSearch = ''; showNotebookSearch = false; }}
										aria-label="Clear filter"
									>
										<X class="h-3 w-3" />
									</button>
								{/if}
							</div>
						{/if}

						<div class="flex-1 overflow-hidden">
							<NotebookTree bind:pendingRenameFolderId filterQuery={sidebarSearch} />
						</div>
					{:else if activeSidebarPanel === 'dashboards'}
						<!-- Dashboards panel -->
						<div class="flex h-9 shrink-0 items-center px-2 border-b border-border/30">
							<span class="text-2xs font-medium text-muted-foreground flex-1">Dashboards</span>
							<button
								class="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
								onclick={() => { const d = createDashboard('New Dashboard'); openDashboardTab(d.id); }}
								title="New dashboard"
								aria-label="New dashboard"
							>
								<Plus class="h-3 w-3" />
							</button>
						</div>
						<div class="flex-1 overflow-y-auto px-2 py-1">
							{#each getDashboards() as dash (dash.id)}
								<button
									class="w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left"
									onclick={() => openDashboardTab(dash.id)}
								>
									<LayoutDashboard class="w-3 h-3 shrink-0" />
									<span class="truncate">{dash.name}</span>
								</button>
							{/each}
							{#if getDashboards().length === 0}
								<p class="text-2xs text-muted-foreground px-1.5 py-2">No dashboards yet.</p>
							{/if}
						</div>
					{:else if activeSidebarPanel === 'tables'}
						<!-- Databases & tables panel -->
						<div class="flex h-9 shrink-0 items-center px-2 border-b border-border/30">
							<span class="text-2xs font-medium text-muted-foreground flex-1">Databases</span>
						</div>
						<div class="min-h-0 flex-1 flex flex-col overflow-hidden">
							<FileImporter />
							<ConnectionManager />
							<div class="flex-1 min-h-0 overflow-y-auto">
								<DatabaseTree />
							</div>
						</div>
					{:else if activeSidebarPanel === 'dbt' && isDbtProject}
						<!-- dbt panel -->
						<DbtPanel />
					{:else if activeSidebarPanel === 'evidence' && isEvidenceProject}
						<!-- Evidence panel -->
						<div class="flex-1 min-h-0 overflow-y-auto">
							<EvidencePanel />
						</div>
					{/if}
				</div>
			</div>

			<!-- Resize handle / sidebar toggle -->
			{#if sidebarCollapsed}
				<div
					class="w-8 shrink-0 flex items-center justify-center bg-muted/20 hover:bg-muted/50 transition-colors cursor-pointer border-r border-border/50"
					onclick={toggleSidebarCollapsed}
					role="button"
					tabindex="0"
					aria-label="Expand sidebar"
					title="Expand sidebar"
					onkeydown={(e) => e.key === 'Enter' && toggleSidebarCollapsed()}
				>
					<PanelLeftOpen class="h-3.5 w-3.5 text-muted-foreground" />
				</div>
			{:else}
				<div
					class="group relative w-px shrink-0 cursor-col-resize bg-border/60 hover:bg-primary/40 transition-colors"
					onpointerdown={onSidebarPointerDown}
					ondblclick={toggleSidebarCollapsed}
					role="separator"
					aria-orientation="vertical"
					aria-valuemin={220}
					aria-valuemax={460}
					aria-valuenow={sidebarWidth}
					title="Drag to resize · Double-click to collapse"
				>
					<button
						class="absolute left-1/2 top-6 -translate-x-1/2 z-10 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground"
						onclick={(e) => { e.stopPropagation(); toggleSidebarCollapsed(); }}
						title="Collapse sidebar"
						aria-label="Collapse sidebar"
					>
						<PanelLeftClose class="h-3 w-3" />
					</button>
				</div>
			{/if}

			<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
				<div class="flex items-center gap-0.5 overflow-x-auto shrink-0 px-2 border-b border-border/60 bg-background">
					{#each notebooks as nb (nb.id)}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
							<div
								class="group relative flex h-9 shrink-0 cursor-pointer select-none items-center gap-1.5 px-3 text-xs transition-colors after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors
									{activeTabId === nb.id
									? 'text-foreground font-medium after:bg-primary'
									: 'text-muted-foreground hover:text-foreground hover:bg-muted/40 after:bg-transparent'}"
								role="tab"
								tabindex="0"
								aria-selected={activeTabId === nb.id}
								onclick={() => setActiveTab(nb.id)}
								onkeydown={(e) => e.key === 'Enter' && setActiveTab(nb.id)}
								ondblclick={() => startRename(nb.id, nb.name)}
							>
								{#if isNotebookDirty(nb.id)}
									<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-400" title="Unsaved changes"></span>
								{/if}
								{#if renamingTabId === nb.id}
									<!-- svelte-ignore a11y_autofocus -->
									<input
										autofocus
										class="h-5 w-40 min-w-0 border-0 border-b border-primary bg-transparent px-0 text-xs text-foreground outline-none"
										bind:value={renameValue}
										onblur={commitRename}
										onkeydown={onRenameKeydown}
										onclick={(e) => e.stopPropagation()}
									/>
								{:else}
									<span class="truncate max-w-32">{nb.name}</span>
								{/if}
								{#if nb.cells.filter(c => c.cellType === 'query' && c.needsRun).length > 0}
									{@const staleCount = nb.cells.filter(c => c.cellType === 'query' && c.needsRun).length}
									<span
										class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/15 px-1 text-2xs font-medium text-warning"
										title="{staleCount} stale cell{staleCount === 1 ? '' : 's'}"
									>{staleCount}</span>
								{/if}
								{#if notebooks.length > 1}
									<button
										class="ml-0.5 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
										onclick={(e) => { e.stopPropagation(); closeNotebookTab(nb.id); }}
										aria-label="Close notebook"
									>
										<X class="w-3 h-3" />
									</button>
								{/if}
							</div>
							</ContextMenu.Trigger>
						<ContextMenu.Content class="z-50">
							<ContextMenu.Item
								disabled={notebooks.length <= 1}
								onclick={() => closeNotebookTab(nb.id)}
							>Close Tab</ContextMenu.Item>
							<ContextMenu.Item
								disabled={notebooks.length <= 1}
								onclick={() => closeOtherNotebookTabs(nb.id)}
							>Close Others</ContextMenu.Item>
							<ContextMenu.Separator />
							<ContextMenu.Item onclick={closeAllNotebookTabs}>Close All</ContextMenu.Item>
						</ContextMenu.Content>
						</ContextMenu.Root>
					{/each}

					{#each openResultTabs as rt (rt.id)}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
							<div
								class="group relative flex h-9 shrink-0 cursor-pointer select-none items-center gap-1.5 px-3 text-xs transition-colors after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors
									{activeTabId === rt.id
								? 'text-foreground font-medium after:bg-primary'
									: 'text-muted-foreground hover:text-foreground hover:bg-muted/40 after:bg-transparent'}"
								role="tab"
								tabindex="0"
								aria-selected={activeTabId === rt.id}
								onclick={() => setActiveTab(rt.id)}
								onkeydown={(e) => e.key === 'Enter' && setActiveTab(rt.id)}
							>
								<Table2 class="w-3 h-3 shrink-0" />
								<span class="truncate max-w-32">{rt.name}</span>
								<button
									class="ml-0.5 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
									onclick={(e) => { e.stopPropagation(); closeResultTab(rt.id); }}
									aria-label="Close result tab"
								>
									<X class="w-3 h-3" />
								</button>
							</div>
							</ContextMenu.Trigger>
						<ContextMenu.Content class="z-50">
							<ContextMenu.Item onclick={() => closeResultTab(rt.id)}>Close Tab</ContextMenu.Item>
							<ContextMenu.Item
								disabled={openResultTabs.length <= 1}
								onclick={() => closeOtherResultTabs(rt.id)}
							>Close Others</ContextMenu.Item>
							<ContextMenu.Separator />
							<ContextMenu.Item onclick={closeAllResultTabs}>Close All</ContextMenu.Item>
						</ContextMenu.Content>
						</ContextMenu.Root>
					{/each}

					{#each openExtraTabs as et (et.id)}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
							<div
								class="group relative flex h-9 shrink-0 cursor-pointer select-none items-center gap-1.5 px-3 text-xs transition-colors after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors
									{activeTabId === et.id
									? 'text-foreground font-medium after:bg-primary'
									: 'text-muted-foreground hover:text-foreground hover:bg-muted/40 after:bg-transparent'}"
								role="tab"
								tabindex="0"
								aria-selected={activeTabId === et.id}
								onclick={() => setActiveTab(et.id)}
								onkeydown={(e) => e.key === 'Enter' && setActiveTab(et.id)}
							>
								{#if et.type === 'profile'}
									<BarChart2 class="w-3 h-3 shrink-0" />
								{:else if et.type === 'lineage'}
									<Network class="w-3 h-3 shrink-0" />
								{:else if et.type === 'dashboard'}
									<LayoutDashboard class="w-3 h-3 shrink-0" />
								{:else if et.type === 'evidence-preview'}
									<MonitorPlay class="w-3 h-3 shrink-0" />
								{:else}
									<Table2 class="w-3 h-3 shrink-0" />
								{/if}
								<span class="truncate max-w-32">{et.name}</span>
								<button
									class="ml-0.5 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
									onclick={(e) => { e.stopPropagation(); closeExtraTab(et.id); }}
									aria-label="Close tab"
								>
									<X class="w-3 h-3" />
								</button>
							</div>
							</ContextMenu.Trigger>
						<ContextMenu.Content class="z-50">
							<ContextMenu.Item onclick={() => closeExtraTab(et.id)}>Close Tab</ContextMenu.Item>
							<ContextMenu.Item
								disabled={openExtraTabs.length <= 1}
								onclick={() => closeOtherExtraTabs(et.id)}
							>Close Others</ContextMenu.Item>
							<ContextMenu.Separator />
							<ContextMenu.Item onclick={closeAllExtraTabs}>Close All</ContextMenu.Item>
						</ContextMenu.Content>
						</ContextMenu.Root>
					{/each}

					<button
						class="flex items-center justify-center h-7 w-7 shrink-0 text-muted-foreground/50 hover:text-muted-foreground transition-colors ml-0.5"
						onclick={addNotebook}
						title="New notebook"
						aria-label="Add notebook"
					>
						<Plus class="w-3.5 h-3.5" />
					</button>
				</div>
				{#if isNotebookTab}
					<main class="flex-1 overflow-y-auto bg-background">
						<div class=" mx-auto pt-8 pb-32 px-10">
							<div class="mb-6 flex items-center gap-3 pl-(--cell-gutter)">
								<input
									class="h-9 min-w-0 flex-1 bg-transparent border-0 outline-none p-0 text-xl font-semibold tracking-tight text-foreground placeholder:text-muted-foreground/60"
									placeholder="Untitled notebook"
									value={activeNotebook?.name ?? ''}
									onblur={(e) => {
										const next = (e.target as HTMLInputElement).value.trim();
										if (activeNotebook && next && next !== activeNotebook.name) renameNotebook(activeNotebook.id, next);
									}}
									onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
								/>
								<Database class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<Select.Root
									type="single"
									disabled={connections.length === 0}
									value={activeNotebookConnectionValue}
									onValueChange={(value) => {
										if (!activeNotebook || value === '__mixed__') return;
										setNotebookConnection(
											activeNotebook.id,
											value === BUILTIN_DUCKDB_CONNECTION_ID ? null : value
										);
									}}
								>
									<Select.Trigger class="h-7 min-w-44 text-xs font-mono">
										{#if activeNotebookConnectionValue === '__mixed__'}
											Mixed connections
										{:else}
											{connections.find((connection) => connection.id === activeNotebookConnectionValue)?.name ?? 'DuckDB (built-in)'}
										{/if}
									</Select.Trigger>
									<Select.Content>
										{#if activeNotebookConnectionValue === '__mixed__'}
											<Select.Item value="__mixed__" class="text-xs font-mono">Mixed connections</Select.Item>
										{/if}
										{#each connections as connection (connection.id)}
											<Select.Item value={connection.id} class="text-xs font-mono">{connection.name}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>

							{#if cells.length === 0}
								<div class="flex flex-col items-center gap-4 py-16 text-center">
									<div class="flex flex-col items-center gap-2">
										<p class="text-sm font-medium text-foreground/70">Empty notebook</p>
										<p class="text-xs text-muted-foreground max-w-xs">Add a query cell to start exploring your data. Reference upstream cells by name using <code class="font-mono bg-muted px-1 py-0.5 rounded text-2xs">from cell_name</code>.</p>
									</div>
									<div class="flex flex-col gap-2 w-full max-w-xs">
										<Button
											variant="default"
											size="sm"
											class="w-full h-8 text-xs gap-2"
											onclick={() => addCellWithLanguage('prql')}
										>
											<Plus class="w-3.5 h-3.5" />
											Add PRQL Cell
											<span class="ml-auto text-2xs opacity-60 font-mono">⌘⇧↵</span>
										</Button>
										<Button
											variant="outline"
											size="sm"
											class="w-full h-8 text-xs gap-2"
											onclick={() => addCellWithLanguage('sql')}
										>
											<Plus class="w-3.5 h-3.5" />
											Add SQL Cell
										</Button>
										<Button
											variant="outline"
											size="sm"
											class="w-full h-8 text-xs gap-2"
											onclick={addMarkdownCell}
										>
											<Info class="w-3.5 h-3.5" />
											Add Markdown Cell
											<span class="ml-auto text-2xs opacity-60 font-mono">⌘⇧M</span>
										</Button>
									</div>
									<div class="text-2xs text-muted-foreground space-y-0.5">
										<p>Press <kbd class="font-mono bg-muted px-1 rounded">?</kbd> for keyboard shortcuts</p>
									</div>
								</div>
							{:else}
								<div bind:this={cellListEl}>
									{#each cells as cell, idx (cell.id)}
										<div data-cell-id={cell.id}>
											{#if !reportView}
												<div class="pl-(--cell-gutter)">
													<AddCellDivider onAdd={(kind) => insertBeforeCell(kind, idx)} />
												</div>
											{/if}
											<NotebookCell
												{cell}
												index={idx}
												isFirst={idx === 0}
												isLast={idx === cells.length - 1}
												dark={isDark}
												prevCellSources={prevSourcesForCell(idx)}
												notebookId={activeTabId}
												{autoRun}
												{reportView}
												onOpenResultTab={handleOpenResultTab}
											/>
										</div>
									{/each}
								</div>

								{#if !reportView}
									<div class="mt-2 pl-(--cell-gutter)">
										<AddCellDivider persistent onAdd={appendCell} />
									</div>
								{/if}
							{/if}
						</div>
					</main>
				{:else if activeExtraTab}
					{#if activeExtraTab.type === 'lineage'}
						<!-- Lineage fills the full remaining height with no scroll/padding -->
						<main class="flex-1 overflow-hidden">
							<DbtLineageView focusedModelName={activeExtraTab.focusedModelName} />
						</main>
					{:else if activeExtraTab.type === 'dashboard'}
						<main class="flex-1 overflow-hidden">
							<DashboardView dashboardId={activeExtraTab.dashboardId ?? ''} />
						</main>
					{:else if activeExtraTab.type === 'evidence-preview'}
						<main class="flex-1 overflow-hidden">
							<EvidencePreview pagePath={activeExtraTab.pagePath ?? ''} />
						</main>
					{:else}
						<main class="flex-1 overflow-y-auto">
							<div class="max-w-7xl mx-auto py-4 px-4">
								{#if activeExtraTab.type === 'table-view'}
									<TableView
										tableName={activeExtraTab.tableName}
										tabId={activeExtraTab.id}
										viewMode={activeExtraTab.viewMode}
										chartConfig={activeExtraTab.chartConfig}
									/>
								{:else}
									<ProfileView tableName={activeExtraTab.tableName} />
								{/if}
							</div>
						</main>
					{/if}
				{:else}
					{@const resultCell = getCellForResultTab(activeResultTab?.id ?? activeTabId)}
					<main class="flex-1 overflow-hidden px-4 py-3 flex flex-col">
						{#if resultCell && resultCell.result && resultCell.status === 'success' && activeResultTab}
							<ResultView
								tabId={activeResultTab.id}
								cellId={resultCell.id}
								notebookId={activeResultTab.notebookId}
								rows={resultCell.result.rows}
								columns={resultCell.result.columns}
								truncated={resultCell.result.truncated ?? false}
								name={resultCell.outputName || 'result'}
								viewMode={activeResultTab.viewMode}
								chartConfig={activeResultTab.chartConfig}
								onAddSort={resultCell.editMode === 'gui' ? (col, dir) => updateGuiStages(resultCell.id, [...resultCell.guiStages, { type: 'sort', keys: [{ column: col, dir }] }]) : undefined}
								onAddFilter={resultCell.editMode === 'gui' ? (col) => updateGuiStages(resultCell.id, [...resultCell.guiStages, { type: 'filter', conditions: [{ column: col, op: '==', value: '' }], logic: 'and' }]) : undefined}
							/>
						{:else if resultCell && resultCell.status === 'running'}
							<div class="flex items-center gap-3 text-sm text-muted-foreground mt-8">
								<Database class="w-4 h-4 animate-pulse" />
								Running query…
							</div>
						{:else}
							<div class="flex flex-col items-center gap-2 mt-16 text-muted-foreground">
								<Table2 class="w-8 h-8 opacity-30" />
								<p class="text-sm">No results available. Run the cell first.</p>
							</div>
						{/if}
					</main>
				{/if}
			</div>
		</div>
	</div>

{/if}

<Dialog.Root bind:open={llmSettingsOpen}>
	<Dialog.Content class="p-6 space-y-4">
		<h2 class="text-sm font-semibold">LLM settings</h2>
		<div class="space-y-3">
			<div class="space-y-1">
				<label for="llm-provider" class="text-xs text-muted-foreground">Provider</label>
				<Select.Root
					type="single"
					value={llmConfig.provider}
					onValueChange={(value) => setLLMConfig({ provider: value as 'openapi-compatible' | 'ollama' })}
				>
					<Select.Trigger id="llm-provider" class="h-8 text-xs font-mono">
						{llmConfig.provider === 'ollama' ? 'Ollama (OpenAI-compatible)' : 'OpenAPI-compatible'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="openapi-compatible" class="text-xs">OpenAPI-compatible</Select.Item>
						<Select.Item value="ollama" class="text-xs">Ollama</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
			<div class="space-y-1">
				<label for="llm-base-url" class="text-xs text-muted-foreground">Base URL</label>
				<Input
					id="llm-base-url"
					class="h-8 text-xs font-mono"
					value={llmConfig.baseUrl}
					oninput={(e: Event) => setLLMConfig({ baseUrl: (e.target as HTMLInputElement).value })}
				/>
			</div>
			<div class="space-y-1">
				<label for="llm-model" class="text-xs text-muted-foreground">Model</label>
				<Input
					id="llm-model"
					class="h-8 text-xs font-mono"
					value={llmConfig.model}
					oninput={(e: Event) => setLLMConfig({ model: (e.target as HTMLInputElement).value })}
				/>
			</div>
			<p class="text-xs text-muted-foreground">Used by AI prompt-to-block generation (slower path).</p>
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={shortcutsOpen}>
	<Dialog.Content class="max-w-2xl max-h-[85vh] overflow-y-auto p-6">
		<h2 class="text-sm font-semibold mb-4">Keyboard shortcuts</h2>

		<div class="grid grid-cols-2 gap-6 text-xs">
			<div>
				<p class="text-2xs font-semibold text-muted-foreground mb-2">Notebook — command mode</p>
				<p class="text-2xs text-muted-foreground mb-2 italic">Activate: press <code class="font-mono bg-muted px-1 rounded text-2xs">Esc</code> from any editor</p>
				<table class="w-full">
					<tbody class="divide-y divide-border/40">
						{#each [
							['Enter', 'Enter edit mode'],
							['↑ / k', 'Focus previous cell'],
							['↓ / j', 'Focus next cell'],
							['a', 'Insert cell above'],
							['b', 'Insert cell below'],
							['d d', 'Delete cell'],
							['⇧K', 'Move cell up'],
							['⇧J', 'Move cell down'],
							['c', 'Collapse / expand cell'],
							['⇧↵ / ⌘↵', 'Run cell'],
						] as [key, desc]}
							<tr>
								<td class="py-1 pr-4 font-mono text-foreground whitespace-nowrap">{key}</td>
								<td class="py-1 text-muted-foreground">{desc}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div>
				<p class="text-2xs font-semibold text-muted-foreground mb-2">Notebook — global</p>
				<table class="w-full mb-4">
					<tbody class="divide-y divide-border/40">
						{#each [
							['⌘⇧↵', 'Add PRQL cell'],
							['⌘⇧M', 'Add markdown cell'],
							['⌘⇧R', 'Run all cells'],
							['⌘B', 'Toggle sidebar'],
							['⌘1–9', 'Switch to notebook tab'],
						] as [key, desc]}
							<tr>
								<td class="py-1 pr-4 font-mono text-foreground whitespace-nowrap">{key}</td>
								<td class="py-1 text-muted-foreground">{desc}</td>
							</tr>
						{/each}
					</tbody>
				</table>

				<p class="text-2xs font-semibold text-muted-foreground mb-2">GUI pipeline stages</p>
				<p class="text-2xs text-muted-foreground mb-2 italic">Activate: click a stage or press <code class="font-mono bg-muted px-1 rounded text-2xs">Enter</code> in command mode</p>
				<table class="w-full">
					<tbody class="divide-y divide-border/40">
						{#each [
							['j / ↓', 'Navigate to next stage'],
							['k / ↑', 'Navigate to prev stage'],
							['⇧J', 'Move stage down'],
							['⇧K', 'Move stage up'],
							['r', 'Run stage preview'],
							['x / Del', 'Remove stage'],
							['⇧D', 'Duplicate stage'],
							['v', 'Toggle stage disabled'],
							['n', 'Add chip to stage'],
							['c', 'Collapse / expand stage'],
							['/', 'Open Add Stage menu'],
							['1–9', 'Pick result from menu'],
							['↵', 'Apply fast plan'],
							['⌘↵', 'Run AI generation'],
							['Esc', 'Exit to cell command mode'],
						] as [key, desc]}
							<tr>
								<td class="py-1 pr-4 font-mono text-foreground whitespace-nowrap">{key}</td>
								<td class="py-1 text-muted-foreground">{desc}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- Open project dialog -->
{#if projectOpenDialogOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onclick={() => { projectOpenDialogOpen = false; projectFolderInput = ''; }}></div>
	<div class="fixed left-1/2 top-[30%] z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl">
		<div class="flex items-center justify-between border-b border-border/60 px-5 py-4">
			<h2 class="text-[15px] font-semibold">Open project folder</h2>
			<button
				class="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
				onclick={() => { projectOpenDialogOpen = false; projectFolderInput = ''; }}
			>
				<X class="h-4 w-4" />
			</button>
		</div>
		<div class="flex flex-col gap-4 p-5">
			<p class="text-[13px] text-muted-foreground leading-relaxed">
				Enter the path to an existing project folder. Supports SQL, PRQL, and project formats including dbt.
			</p>
			<div class="flex flex-col gap-1.5">
				<label for="menu-open-folder-path" class="text-[12px] font-medium text-foreground/70">Folder path</label>
				<input
					id="menu-open-folder-path"
					class="w-full rounded-lg border border-input bg-background px-3 py-2 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/40"
					placeholder="/Users/you/my-project"
					bind:value={projectFolderInput}
					onkeydown={(e) => {
						if (e.key === 'Enter') void handleOpenProject();
						if (e.key === 'Escape') { projectOpenDialogOpen = false; projectFolderInput = ''; }
					}}
				/>
			</div>
			<div class="flex justify-end gap-2 pt-1">
				<button
					class="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-muted transition-colors"
					onclick={() => { projectOpenDialogOpen = false; projectFolderInput = ''; }}
				>
					Cancel
				</button>
				<button
					class="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
					onclick={() => void handleOpenProject()}
					disabled={!projectFolderInput.trim() || projectOpenLoading}
				>
					{projectOpenLoading ? 'Opening…' : 'Open'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- About dialog -->
<Dialog.Root bind:open={aboutOpen}>
	<Dialog.Content class="max-w-sm">
		<div class="flex items-center gap-2 mb-4">
			<Database class="w-4 h-4 text-primary" />
			<h2 class="text-[15px] font-semibold">Lunapad</h2>
		</div>
		<div class="flex flex-col gap-3 text-sm text-muted-foreground">
			<p>A notebook-style SQL IDE that runs entirely in the browser. Write SQL, reference other cells as CTEs, and query DuckDB or external databases interactively.</p>
			<div class="rounded-lg border bg-muted/40 px-3 py-2 text-xs font-mono space-y-1">
				<div class="flex justify-between"><span>Engine</span><span class="text-foreground">DuckDB WASM</span></div>
				<div class="flex justify-between"><span>Language</span><span class="text-foreground">SQL / PRQL</span></div>
				<div class="flex justify-between"><span>Framework</span><span class="text-foreground">SvelteKit</span></div>
			</div>
			<div class="flex gap-2 pt-1">
				<button
					class="flex items-center gap-1.5 text-xs text-primary hover:underline"
					onclick={() => window.open('https://prql-lang.org', '_blank')}
				>
					<ExternalLink class="w-3 h-3" /> prql-lang.org
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
