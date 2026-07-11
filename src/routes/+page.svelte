<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { initDB, restoreUploadedTables } from '$lib/services/duckdb';
	import { initPRQL } from '$lib/services/prql';
	import { withTimeout } from '$lib/services/async';
	import { authClient } from '$lib/auth-client';
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
		exportJSON,
		importJSON,
		loadFromStorage,
		initWorkspaceMode,
		getWorkspaceSyncStatus,
		getWorkspaceConflictInfo,
		reloadWorkspaceFromServer,
		forceSaveWorkspace,
		startWorkspacePolling,
		stopWorkspacePolling,
		updateCellCode,
		updateCellMarkdown,
		updatePythonCellCode,
		updateCellName,
		setEditMode,
		updateGuiStages,
		refreshTablesFromCatalog,
		setNotebookConnection,
		setNotebookAutoRefresh,
		addTable,
		getProjectFolder,
		getIsDbtProject,
		getIsEvidenceProject,
		getStorageMode,
		isNotebookDirty,
		scheduleFileSave,
		openLineageTab,
		duplicateNotebook,
		closeProject,
		openProject,
		clearAllResults,
		setNotebookDefaultCellLanguage,
		runCell,
		runPythonCell,
		insertCellBefore,
		insertMarkdownCellBefore,
		addUdfCell,
		insertUdfCellBefore,
		canAddUdfCell,
		addPlotCell,
		insertPlotCellBefore,
		canAddPlotCell,
		addPythonCell,
		injectTestPythonResultCell,
		insertPythonCellBefore,
		canAddPythonCell,
		goBackPageNav,
		goForwardPageNav,
		openNotebookTabAtCell,
		setAllCellsDisplay,
		setNotebookReportView,
		getFocusedCellId,
		getSidebarNotebookView,
		setSidebarNotebookView,
		toggleSidebarNotebookView,
		getRecentNotebookIds,
		getFavoriteNotebookIds,
		runCellsAbove,
		runCellsBelow,
		closeWorksheetView,
		getAllCellsAcrossNotebooks,
		setCellResultViewMode,
		setNotebookFilterValue
	} from '$lib/stores/notebook.svelte';
	import { isDesktop, platformOS } from '$lib/services/platform.svelte';
	import WindowControls from '$lib/components/WindowControls.svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { fade } from 'svelte/transition';
	import DatabaseTree from '$lib/components/DatabaseTree.svelte';
	import FileImporter from '$lib/components/FileImporter.svelte';
	import SettingsDialog from '$lib/components/settings/SettingsDialog.svelte';
	import NotebookTree from '$lib/components/NotebookTree.svelte';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import NotebookOutline from '$lib/components/notebook/NotebookOutline.svelte';
	import NotebookStatusBar from '$lib/components/notebook/NotebookStatusBar.svelte';
	import CellWorksheetView from '$lib/components/notebook/CellWorksheetView.svelte';
	import ReportViewShell from '$lib/components/markdown/ReportViewShell.svelte';
	import NotebookDocumentEditor from '$lib/components/markdown/visual/NotebookDocumentEditor.svelte';
	import MarkdocPreviewProvider from '$lib/components/markdown/MarkdocPreviewProvider.svelte';
	import NotebookBreadcrumbs from '$lib/components/notebook/NotebookBreadcrumbs.svelte';
	import NotebookBacklinks from '$lib/components/notebook/NotebookBacklinks.svelte';
	import ProjectSection from '$lib/components/ProjectSection.svelte';
	import DbtPanel from '$lib/components/DbtPanel.svelte';
	import EvidencePanel from '$lib/components/EvidencePanel.svelte';
	import EvidencePreview from '$lib/components/EvidencePreview.svelte';
	import UploadDialog from '$lib/components/UploadDialog.svelte';
	import ShareDialog from '$lib/components/ShareDialog.svelte';
	import SitesPanel from '$lib/components/sites/SitesPanel.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import ReviewPanel from '$lib/components/comments/ReviewPanel.svelte';
	import {
		closeCommentPanel,
		getInboxUnread,
		getPresence,
		getReviewPanelOpen,
		getReviewPanelWidth,
		openCommentPanel,
		openInbox,
		refreshPresence,
		sendPresence,
		setReviewPanelWidth,
		persistReviewPanelWidth,
		startCommentsPolling,
		stopCommentsPolling
	} from '$lib/stores/comments.svelte';
	import ResultView from '$lib/components/ResultView.svelte';
	import TableView from '$lib/components/TableView.svelte';
	import ProfileView from '$lib/components/ProfileView.svelte';
	import DbtLineageView from '$lib/components/DbtLineageView.svelte';
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
		SidebarClose,
		FileDown,
		FileUp,
		ChevronsDownUp,
		ChevronsUpDown,
		Keyboard,
		Bug,
		Sparkles,
		Share2,
		Globe,
		ListTree,
		ArrowUp,
		ArrowDown,
		MessageSquare,
		LogOut,
		ShieldUser
	} from '@lucide/svelte';
	import AIChatPanel from '$lib/components/ai/AIChatPanel.svelte';
	import {
		getAIChatOpen,
		setAIChatOpen,
		getAIChatPanelWidth,
		setAIChatPanelWidth,
		persistAIChatPanelWidth,
		getGhostCellIds,
		addContextCell,
		setPendingSuggestion,
		initAIChatWidth,
		initWorkspaceStandards
	} from '$lib/stores/ai-chat.svelte';
	import { submitAIMessage } from '$lib/services/ai-chat-client.js';
	import {
		mountKeyboardDispatcher,
		registerPageBridge,
		requestInlinePrompt,
		shortcutsByGroup
	} from '$lib/keyboard';
	import WelcomeDialog from '$lib/components/WelcomeDialog.svelte';
	import TemplateGalleryDialog from '$lib/components/TemplateGalleryDialog.svelte';
	import {
		bootstrapDemoNotebook,
		hasStoredWorkspace,
		isDefaultEmptyNotebook,
		markWelcomeSeen,
		shouldShowWelcome
	} from '$lib/demo/bootstrap';
	import { DEMO_NOTEBOOK_NAME } from '$lib/demo/sales-analytics-demo';
	import type { PageProps } from './$types';

	const SHORTCUT_GROUPS: { key: string; title: string }[] = [
		{ key: 'global', title: 'Notebook — global' },
		{ key: 'command-mode', title: 'Notebook — command mode' },
		{ key: 'cell-editor', title: 'Cell editor' },
		{ key: 'gui-stages', title: 'GUI pipeline stages' },
		{ key: 'markdown-editor', title: 'Markdown editor' }
	];
	const shortcutTables = $derived(shortcutsByGroup());

	let { data }: PageProps = $props();
	const collabEnabled = $derived(!data.demoMode);

	// ── Reactive state ──────────────────────────────────────────────────────
	const tables = $derived(getTables());
	const connections = $derived(getConnections());
	const theme = $derived(getTheme());
	const autoRun = $derived(getAutoRun());
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
	// Bind directly to the active notebook's cells array so new cells render without refresh.
	const cells = $derived(activeNotebook?.cells ?? []);
	const worksheetCell = $derived.by(() => {
		const id = activeNotebook?.worksheetCellId;
		if (!id) return null;
		return cells.find((c) => c.id === id) ?? null;
	});
	const worksheetCellIndex = $derived(
		worksheetCell ? cells.findIndex((c) => c.id === worksheetCell.id) : -1
	);
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
	const reportMarkdowns = $derived(
		cells.filter((c) => c.cellType === 'markdown' && c.markdown?.trim()).map((c) => c.markdown!)
	);

	function handleDrillToCell(outputName: string) {
		const cell = cells.find((c) => c.outputName === outputName && c.cellType === 'query');
		if (cell) openResultTab(cell.id, activeTabId, outputName, 'table');
	}

	function inferMarkdocColumnType(rows: Record<string, unknown>[], column: string): string | undefined {
		for (const row of rows.slice(0, 25)) {
			const value = row[column];
			if (value === null || value === undefined) continue;
			if (typeof value === 'number') return 'number';
			if (typeof value === 'boolean') return 'boolean';
			if (value instanceof Date) return 'datetime';
			if (typeof value === 'string') {
				if (/^-?\d+(\.\d+)?$/.test(value.trim())) return 'number';
				if (/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return 'date';
				return 'text';
			}
			return 'text';
		}
		return undefined;
	}

	const sidebarNotebookView = $derived(getSidebarNotebookView());
	const recentNotebookIds = $derived(getRecentNotebookIds());
	const favoriteNotebookIds = $derived(getFavoriteNotebookIds());
	let favoritesCollapsed = $state(false);
	let recentCollapsed = $state(false);
	const markdownRefEntries = $derived(
		cells
			.filter(
				(c) =>
					c.cellType === 'query' &&
					c.status === 'success' &&
					c.result &&
					c.result.columns.length > 0 &&
					c.result.rows.length > 0
			)
			.map((c) => ({
				cellName: c.outputName,
				rowCount: c.result!.rows.length,
				columns: c.result!.columns.map((name) => ({
					name,
					type: inferMarkdocColumnType(c.result!.rows, name)
				}))
			}))
	);
	let notebookScrollEl: HTMLElement | undefined = $state();
	const showDemoCta = $derived(
		!data.demoMode && isDefaultEmptyNotebook(activeNotebook?.name, cells)
	);
	const aiChatOpen = $derived(getAIChatOpen());
	const aiPanelWidth = $derived(getAIChatPanelWidth());
	const reviewPanelOpen = $derived(getReviewPanelOpen());
	const reviewPanelWidth = $derived(getReviewPanelWidth());
	const inboxUnread = $derived(getInboxUnread());
	const notebookPresence = $derived(getPresence());

	$effect(() => {
		if (!collabEnabled || !isNotebookTab) return;
		void sendPresence(activeTabId, null);
		void refreshPresence(activeTabId);
	});
	const ghostCellIds = $derived(getGhostCellIds());

	// ── Cell list: insert dividers + drag reorder ─────────────────────────────
	// ── Init ─────────────────────────────────────────────────────────────────
	let dbReady = $state(false);
	let dbError = $state<string | null>(null);
	let settingsOpen = $state(false);
	let settingsTab = $state<'general' | 'account' | 'ai' | 'connections' | 'team'>('general');
	let shortcutsOpen = $state(false);

	// ── Auth ─────────────────────────────────────────────────────────────────
	const session = authClient.useSession();

	function userInitials(name: string | undefined, email: string | undefined): string {
		const trimmed = (name ?? '').trim();
		if (trimmed) {
			const parts = trimmed.split(/\s+/);
			return (
				(parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')
			).toUpperCase();
		}
		return (email?.[0] ?? '?').toUpperCase();
	}

	async function handleLogout(): Promise<void> {
		await authClient.signOut();
		await goto('/login');
	}
	let shareDialogOpen = $state(false);
	let sitesDialogOpen = $state(false);
	let reviewPanelResizeStartX = 0;
	let reviewPanelResizeStartWidth = 360;
	let commandPaletteOpen = $state(false);
	let projectOpenDialogOpen = $state(false);
	let welcomeOpen = $state(false);
	let templateGalleryOpen = $state(false);
	let uploadDialogOpen = $state(false);
	let projectFolderInput = $state('');
	let projectOpenLoading = $state(false);
	let aboutOpen = $state(false);
	let sidebarSearch = $state('');
	let showNotebookSearch = $state(false);
	const menuTriggerClass =
		'h-7 rounded-md px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground data-open:bg-muted data-open:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

	type SidebarPanel = 'notebooks' | 'tables' | 'dbt' | 'evidence';
	let activeSidebarPanel = $state<SidebarPanel>('notebooks');

	// Svelte transitions don't honor the prefers-reduced-motion media query, gate manually.
	const reducedMotion =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const panelFadeMs = reducedMotion ? 0 : 130;

	const SIDEBAR_WIDTH_KEY = 'lunapad.sidebar.width';
	const SIDEBAR_COLLAPSED_KEY = 'lunapad.sidebar.collapsed';
	const NOTEBOOK_TABS_COLLAPSED_KEY = 'lunapad.notebookTabs.collapsed';
	let sidebarWidth = $state(260);
	let sidebarCollapsed = $state(false);
	let notebookTabsCollapsed = $state(false);
	let isDraggingSidebar = $state(false);
	let layoutRoot: HTMLDivElement | null = null;

	// AI panel resize. Width updates are rAF-coalesced (pointermove can fire far
	// faster than the frame rate) and persisted to localStorage once on release.
	let isDraggingAIPanel = $state(false);
	let aiPanelResizeStartX = 0;
	let aiPanelResizeStartWidth = 0;
	let aiPanelLatestX = 0;
	let aiPanelRaf = 0;

	function onAIPanelPointerDown(e: PointerEvent) {
		isDraggingAIPanel = true;
		aiPanelResizeStartX = e.clientX;
		aiPanelResizeStartWidth = getAIChatPanelWidth();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onAIPanelPointerMove(e: PointerEvent) {
		if (!isDraggingAIPanel) return;
		aiPanelLatestX = e.clientX;
		if (aiPanelRaf) return;
		aiPanelRaf = requestAnimationFrame(() => {
			aiPanelRaf = 0;
			if (!isDraggingAIPanel) return;
			setAIChatPanelWidth(aiPanelResizeStartWidth + (aiPanelResizeStartX - aiPanelLatestX));
		});
	}

	function onAIPanelPointerUp() {
		if (!isDraggingAIPanel) return;
		isDraggingAIPanel = false;
		persistAIChatPanelWidth();
	}

	let isDraggingReviewPanel = $state(false);
	let reviewPanelLatestX = 0;
	let reviewPanelRaf = 0;

	function onReviewPanelPointerDown(e: PointerEvent) {
		isDraggingReviewPanel = true;
		reviewPanelResizeStartX = e.clientX;
		reviewPanelResizeStartWidth = getReviewPanelWidth();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onReviewPanelPointerMove(e: PointerEvent) {
		if (!isDraggingReviewPanel) return;
		reviewPanelLatestX = e.clientX;
		if (reviewPanelRaf) return;
		reviewPanelRaf = requestAnimationFrame(() => {
			reviewPanelRaf = 0;
			if (!isDraggingReviewPanel) return;
			setReviewPanelWidth(
				reviewPanelResizeStartWidth + (reviewPanelResizeStartX - reviewPanelLatestX)
			);
		});
	}

	function onReviewPanelPointerUp() {
		if (!isDraggingReviewPanel) return;
		isDraggingReviewPanel = false;
		persistReviewPanelWidth();
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.min(max, Math.max(min, value));
	}

	// Layout-root left edge, read once per drag (a getBoundingClientRect inside
	// every pointermove forces a layout pass mid-drag).
	let sidebarDragRectLeft: number | null = null;

	function updateSidebarFromClientX(clientX: number) {
		if (sidebarDragRectLeft === null) {
			if (!layoutRoot) return;
			const rect = layoutRoot.getBoundingClientRect();
			if (rect.width <= 0) return;
			sidebarDragRectLeft = rect.left;
		}
		sidebarWidth = clamp(clientX - sidebarDragRectLeft, 220, 460);
	}

	function toggleSidebarCollapsed() {
		sidebarCollapsed = !sidebarCollapsed;
		localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
	}

	function selectSidebarPanel(panel: SidebarPanel) {
		activeSidebarPanel = panel;
		if (sidebarCollapsed) {
			sidebarCollapsed = false;
			localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
		}
	}

	function showNotebookOutline() {
		activeSidebarPanel = 'notebooks';
		setSidebarNotebookView('outline');
		if (sidebarCollapsed) {
			sidebarCollapsed = false;
			localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
		}
	}

	// Keep the active tab visible when the tab bar overflows horizontally.
	$effect(() => {
		void activeTabId;
		tick().then(() => {
			const tab = document.querySelector('[role="tab"][aria-selected="true"]');
			if (!tab) return;
			// Skip the scroll (and its forced layout) when the tab is already fully
			// visible inside its scroll container.
			const bar = tab.closest('[role="tablist"]') ?? tab.parentElement;
			if (bar) {
				const t = tab.getBoundingClientRect();
				const b = bar.getBoundingClientRect();
				if (t.left >= b.left && t.right <= b.right) return;
			}
			tab.scrollIntoView({ behavior: 'auto', inline: 'nearest', block: 'nearest' });
		});
	});

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
		sidebarDragRectLeft = null;
		localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
	}

	function toggleSidebarSection(section: 'notebooks' | 'tables') {
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
			await restoreUploadedTables();
			await refreshTablesFromCatalog();
			dbReady = true;
		} catch (err: unknown) {
			dbError = err instanceof Error ? err.message : String(err);
		}
	}

	onMount(() => {
		const unmountKeyboard = mountKeyboardDispatcher();
		const unregisterPageBridge = registerPageBridge({
			isCommandPaletteOpen: () => commandPaletteOpen,
			isShortcutsOpen: () => shortcutsOpen,
			toggleCommandPalette: () => {
				commandPaletteOpen = !commandPaletteOpen;
			},
			openShortcuts: () => {
				shortcutsOpen = true;
			},
			toggleSidebar: toggleSidebarCollapsed,
			saveAll: () => {
				if (getStorageMode() !== 'filesystem') return;
				const tabId = getActiveTabId();
				const nb = getNotebooks().find((n) => n.id === tabId);
				if (!nb) return;
				nb.cells.forEach((cell) => scheduleFileSave(nb.id, cell.id));
			},
			switchNotebookTab: (index) => {
				const tab = getOpenNotebookTabs()[index];
				if (tab) setActiveTab(tab.id);
			},
			toggleAIChat: () => setAIChatOpen(!getAIChatOpen()),
			openComments: () => {
				if (!collabEnabled) return;
				const tabId = getActiveTabId();
				openCommentPanel({
					notebookId: tabId,
					cellId: getFocusedCellId() ?? undefined
				});
			},
			addPrqlCell: () => addCellWithLanguage('prql'),
			addMarkdownCell: () => addMarkdownCell(),
			runAll: () => void handleRunAll(),
			isNotebookTab: () => {
				const tabId = getActiveTabId();
				return (
					getNotebooks().some((n) => n.id === tabId) &&
					!getOpenExtraTabs().some((t) => t.id === tabId)
				);
			},
			toggleNotebookOutline: () => {
				if (!getNotebooks().some((n) => n.id === getActiveTabId())) return;
				activeSidebarPanel = 'notebooks';
				toggleSidebarNotebookView();
				if (sidebarCollapsed) {
					sidebarCollapsed = false;
					localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
				}
			},
			isWorksheetView: () => Boolean(activeNotebook?.worksheetCellId),
			closeWorksheetView: handleExitWorksheet,
			goBackPageNav: () => {
				goBackPageNav();
			},
			goForwardPageNav: () => {
				goForwardPageNav();
			}
		});
		return () => {
			unmountKeyboard();
			unregisterPageBridge();
		};
	});

	onMount(async () => {
		const savedSidebarWidth = localStorage.getItem(SIDEBAR_WIDTH_KEY);
		if (savedSidebarWidth) {
			const parsed = Number(savedSidebarWidth);
			if (!Number.isNaN(parsed)) {
				sidebarWidth = clamp(parsed, 220, 460);
			}
		}
		sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
		notebookTabsCollapsed = localStorage.getItem(NOTEBOOK_TABS_COLLAPSED_KEY) === 'true';
		window.addEventListener('pointermove', onSidebarPointerMove);
		window.addEventListener('pointerup', onSidebarPointerUp);
		window.addEventListener('pointercancel', onSidebarPointerUp);
		window.addEventListener('pointermove', onAIPanelPointerMove);
		window.addEventListener('pointerup', onAIPanelPointerUp);
		window.addEventListener('pointercancel', onAIPanelPointerUp);
		window.addEventListener('pointermove', onReviewPanelPointerMove);
		window.addEventListener('pointerup', onReviewPanelPointerUp);
		window.addEventListener('pointercancel', onReviewPanelPointerUp);
		layoutRoot = document.getElementById('layout-root') as HTMLDivElement | null;
		initAIChatWidth();
		initWorkspaceStandards();
		initWorkspaceMode(data.demoMode);
		const hadStoredWorkspace = hasStoredWorkspace();
		const forceDemo = new URLSearchParams(window.location.search).get('demo') === '1';
		try {
			await loadFromStorage(data.defaultProjectFolder);
		} catch {
			toast.error('Stored workspace state is invalid and was ignored.');
		}

		if (collabEnabled) {
			startCommentsPolling(getActiveTabId());
			startWorkspacePolling();
		}

		// Expose test helpers on window for Playwright E2E tests (dev/test only)
		if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
			(window as any).__testHelpers = {
				updateCellCode,
				setEditMode,
				getCells,
				getCellByOutputName: (name: string) =>
					getCells().find((c) => c.outputName === name) ?? null,
				getActiveTabId,
				runCell,
				runAll,
				setNotebookReportView,
				setCellResultViewMode,
				setNotebookFilterValue,
				canAddPythonCell,
				addPythonCell,
				injectTestPythonResultCell,
				runPythonCell,
				updatePythonCellCode,
				updateCellName,
				bootstrapDemoNotebook,
				tick,
				addTable,
				refreshTablesFromCatalog,
				requestInlinePrompt
			};
		}

		await initializeRuntime();

		if (data.demoMode || forceDemo) {
			await bootstrapDemoNotebook({ runCells: true, replaceIfExists: forceDemo });
		} else if (shouldShowWelcome(data.demoMode, hadStoredWorkspace)) {
			welcomeOpen = true;
		}
	});

	onDestroy(() => {
		window.removeEventListener('pointermove', onSidebarPointerMove);
		window.removeEventListener('pointerup', onSidebarPointerUp);
		window.removeEventListener('pointercancel', onSidebarPointerUp);
		window.removeEventListener('pointermove', onAIPanelPointerMove);
		window.removeEventListener('pointerup', onAIPanelPointerUp);
		window.removeEventListener('pointercancel', onAIPanelPointerUp);
		window.removeEventListener('pointermove', onReviewPanelPointerMove);
		window.removeEventListener('pointerup', onReviewPanelPointerUp);
		window.removeEventListener('pointercancel', onReviewPanelPointerUp);
		stopCommentsPolling();
		stopWorkspacePolling();
	});

	// Persistent (non-auto-dismissing) notice when the Postgres-backed workspace load/save
	// is degraded — never a hard fail, edits keep working against the localStorage cache
	// and retry automatically (see scheduleSave/loadFromServer in notebook.svelte.ts).
	let workspaceSyncToastId: string | number | undefined;
	$effect(() => {
		if (data.demoMode || activeNotebook?.name === DEMO_NOTEBOOK_NAME) {
			if (workspaceSyncToastId !== undefined) {
				toast.dismiss(workspaceSyncToastId);
				workspaceSyncToastId = undefined;
			}
			return;
		}
		const status = getWorkspaceSyncStatus();
		if (status === 'offline') {
			workspaceSyncToastId = toast.warning(
				"Showing offline copy — couldn't reach the workspace server.",
				{ id: workspaceSyncToastId, duration: Infinity }
			);
		} else if (status === 'error') {
			workspaceSyncToastId = toast.warning("Couldn't save changes — retrying…", {
				id: workspaceSyncToastId,
				duration: Infinity
			});
		} else if (status === 'conflict') {
			const info = getWorkspaceConflictInfo();
			workspaceSyncToastId = toast.warning(
				`Workspace was updated elsewhere${info.updatedBy ? ` (${info.updatedBy})` : ''}.`,
				{
					id: workspaceSyncToastId,
					duration: Infinity,
					action: {
						label: 'Reload',
						onClick: () => void reloadWorkspaceFromServer()
					},
					cancel: {
						label: 'Keep mine',
						onClick: () => void forceSaveWorkspace()
					}
				}
			);
		} else if (workspaceSyncToastId !== undefined) {
			toast.dismiss(workspaceSyncToastId);
			workspaceSyncToastId = undefined;
		}
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
	let notebookTitleDrafts = $state<Record<string, string>>({});

	function notebookDisplayName(notebookId: string, fallback: string): string {
		return notebookTitleDrafts[notebookId] ?? fallback;
	}

	function updateNotebookTitleDraft(notebookId: string, value: string) {
		notebookTitleDrafts = { ...notebookTitleDrafts, [notebookId]: value };
	}

	function clearNotebookTitleDraft(notebookId: string) {
		const { [notebookId]: _removed, ...rest } = notebookTitleDrafts;
		notebookTitleDrafts = rest;
	}

	function commitNotebookTitle(notebookId: string, currentName: string) {
		const next = (notebookTitleDrafts[notebookId] ?? currentName).trim();
		if (next && next !== currentName) renameNotebook(notebookId, next);
		clearNotebookTitleDraft(notebookId);
	}

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
	function handleExitWorksheet() {
		if (!activeNotebook) return;
		const cellId = closeWorksheetView(activeNotebook.id);
		if (cellId) openNotebookTabAtCell(activeNotebook.id, cellId);
	}

	function handleOpenResultTab(
		cellId: string,
		notebookId: string,
		name: string,
		preferredViewMode: 'table' | 'chart' | 'stats' = 'table'
	) {
		openResultTab(cellId, notebookId, name, preferredViewMode);
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
</script>

<svelte:head>
	<title>Lunapad | Analytics Workspace</title>
</svelte:head>

<!-- Loading screen -->
{#if !dbReady}
	<div class="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background">
		{#if dbError}
			<div class="text-center">
				<p class="mb-2 font-medium text-destructive">Failed to initialize DuckDB</p>
				<p class="max-w-md font-mono text-xs text-muted-foreground">{dbError}</p>
				<div class="mt-4">
					<Button size="sm" onclick={initializeRuntime}>Retry</Button>
				</div>
			</div>
		{:else}
			<div class="flex items-center gap-3">
				<Orbit class="h-6 w-6 animate-pulse text-primary" />
				<span class="text-sm text-muted-foreground">Initializing WASM engines…</span>
			</div>
			<div class="w-64 space-y-2">
				<Skeleton class="h-2 w-full" />
				<Skeleton class="h-2 w-4/5" />
				<Skeleton class="h-2 w-3/5" />
			</div>
		{/if}
	</div>
{:else}
	<div class="flex h-screen flex-col overflow-hidden">
		<header
			class="sticky top-0 z-(--z-sticky) border-b border-border bg-background"
			data-tauri-drag-region={isDesktop ? '' : undefined}
		>
			<div
				class="flex items-center justify-between px-2 py-2"
				style="padding-right: calc(var(--titlebar-inset-right, 0px) + 0.5rem)"
			>
				<div class="flex items-center gap-2">
					<div class="flex shrink-0 items-center gap-2">
						<Logo class="h-5 w-5 text-foreground" />
						<span class="text-sm font-semibold tracking-tight">Lunapad</span>
					</div>
					<div class="mx-1 h-5 w-px bg-border"></div>
					<div class="flex items-center gap-0.5">
						<DropdownMenu.Root>
							<DropdownMenu.Trigger class={menuTriggerClass}>File</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-52">
								<DropdownMenu.Item onclick={() => addNotebook()}>
									<Plus class="h-3.5 w-3.5" /> New notebook
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => (templateGalleryOpen = true)}>
									<FlaskConical class="h-3.5 w-3.5" /> Browse templates
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => addCellWithLanguage('prql')}>
									<Code2 class="h-3.5 w-3.5" /> New PRQL cell
									<DropdownMenu.Shortcut>⇧⌘↵</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => addCellWithLanguage('sql')}>
									<FileCode2 class="h-3.5 w-3.5" /> New SQL cell
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => addMarkdownCell()}>
									<BookOpen class="h-3.5 w-3.5" /> New markdown cell
									<DropdownMenu.Shortcut>⇧⌘M</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								{#if canAddUdfCell()}
									<DropdownMenu.Item onclick={() => addUdfCell()}>
										<FileCode2 class="h-3.5 w-3.5" /> New Python UDF cell
									</DropdownMenu.Item>
								{/if}
								{#if canAddPlotCell()}
									<DropdownMenu.Item onclick={() => addPlotCell()}>
										<BarChart2 class="h-3.5 w-3.5" /> New plot cell
									</DropdownMenu.Item>
								{/if}
								{#if canAddPythonCell()}
									<DropdownMenu.Item onclick={() => addPythonCell()}>
										<FileCode2 class="h-3.5 w-3.5" /> New Python cell
									</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Separator />
								{#if !data.demoMode}
									<DropdownMenu.Item onclick={() => (projectOpenDialogOpen = true)}>
										<FolderOpen class="h-3.5 w-3.5" /> Open project…
									</DropdownMenu.Item>
									<DropdownMenu.Item disabled={!projectFolder} onclick={() => closeProject()}>
										<X class="h-3.5 w-3.5" /> Close project
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									<DropdownMenu.Item
										onclick={() => {
											activeSidebarPanel = 'tables';
											sidebarCollapsed = false;
										}}
									>
										<Upload class="h-3.5 w-3.5" /> Upload data file…
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
								{/if}
								<DropdownMenu.Item onclick={handleImport}>
									<FileDown class="h-3.5 w-3.5" /> Import notebook…
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={handleExport}>
									<FileUp class="h-3.5 w-3.5" /> Export notebook
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger class={menuTriggerClass}>Edit</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-56">
								<DropdownMenu.Sub>
									<DropdownMenu.SubTrigger>
										<Code2 class="h-3.5 w-3.5" /> Default cell type
									</DropdownMenu.SubTrigger>
									<DropdownMenu.SubContent>
										<DropdownMenu.RadioGroup
											value={activeNotebook?.defaultCellLanguage ?? 'sql'}
											onValueChange={(value) => {
												if (activeNotebook && (value === 'prql' || value === 'sql'))
													setNotebookDefaultCellLanguage(activeNotebook.id, value);
											}}
										>
											<DropdownMenu.RadioItem value="prql">PRQL</DropdownMenu.RadioItem>
											<DropdownMenu.RadioItem value="sql">SQL</DropdownMenu.RadioItem>
										</DropdownMenu.RadioGroup>
									</DropdownMenu.SubContent>
								</DropdownMenu.Sub>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									disabled={!activeNotebook}
									onclick={() => {
										if (activeNotebook) duplicateNotebook(activeNotebook.id);
									}}
								>
									<Copy class="h-3.5 w-3.5" /> Duplicate notebook
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									onclick={() => {
										clearAllResults();
										toast.success('All results cleared');
									}}
								>
									<Trash2 class="h-3.5 w-3.5" /> Clear all results
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger class={menuTriggerClass}>Run</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-48">
								<DropdownMenu.Item
									disabled={runningAll || cells.length === 0}
									onclick={() => void handleRunAll()}
								>
									<Play class="h-3.5 w-3.5 fill-current" /> Run all cells
									<DropdownMenu.Shortcut>⇧⌘R</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								{#if staleCellCount > 0}
									<DropdownMenu.Item
										disabled={runningAllStale || runningAll}
										onclick={() => void handleRunAllStale()}
									>
										<RefreshCw class="h-3.5 w-3.5" /> Run stale cells
										<span
											class="ml-auto rounded-full bg-warning/15 px-1.5 py-0.5 text-2xs font-medium text-warning"
											>{staleCellCount}</span
										>
									</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									disabled={!isNotebookTab || !getFocusedCellId()}
									onclick={() => {
										const id = getFocusedCellId();
										if (id) void runCellsAbove(id);
									}}
								>
									<ArrowUp class="h-3.5 w-3.5" /> Run above
									<DropdownMenu.Shortcut>⌥⇧↑</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Item
									disabled={!isNotebookTab || !getFocusedCellId()}
									onclick={() => {
										const id = getFocusedCellId();
										if (id) void runCellsBelow(id);
									}}
								>
									<ArrowDown class="h-3.5 w-3.5" /> Run below
									<DropdownMenu.Shortcut>⌥⇧↓</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.CheckboxItem
									checked={autoRun}
									onCheckedChange={(checked) => setAutoRun(checked)}
								>
									Auto Run
								</DropdownMenu.CheckboxItem>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger class={menuTriggerClass}>View</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-56">
								<DropdownMenu.Item onclick={toggleSidebarCollapsed}>
									<SidebarClose class="h-3.5 w-3.5" /> Toggle sidebar
									<DropdownMenu.Shortcut>⌘B</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => setAIChatOpen(!getAIChatOpen())}>
									<Sparkles class="h-3.5 w-3.5" /> Toggle AI chat
									<DropdownMenu.Shortcut>⌘J</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Item disabled={!isNotebookTab} onclick={showNotebookOutline}>
									<ListTree class="h-3.5 w-3.5" /> Show outline
									<DropdownMenu.Shortcut>⌘⇧O</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									disabled={!isNotebookTab}
									onclick={() => setAllCellsDisplay('collapsed')}
								>
									<ChevronsDownUp class="h-3.5 w-3.5" /> Collapse all cells
								</DropdownMenu.Item>
								<DropdownMenu.Item
									disabled={!isNotebookTab}
									onclick={() => setAllCellsDisplay('full')}
								>
									<ChevronsUpDown class="h-3.5 w-3.5" /> Expand all cells
								</DropdownMenu.Item>
								<DropdownMenu.CheckboxItem
									disabled={!activeNotebook}
									checked={reportView}
									onCheckedChange={(checked) => setNotebookReportView(checked)}
								>
									Report view
								</DropdownMenu.CheckboxItem>
								<DropdownMenu.Item
									disabled={!activeNotebook}
									onclick={() => (shareDialogOpen = true)}
								>
									<Share2 class="h-3.5 w-3.5" /> Share…
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => (sitesDialogOpen = true)}>
									<Globe class="h-3.5 w-3.5" /> Sites…
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									onclick={() => {
										settingsTab = 'general';
										settingsOpen = true;
									}}
								>
									<Settings class="h-3.5 w-3.5" /> Settings…
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger class={menuTriggerClass}>Help</DropdownMenu.Trigger>
							<DropdownMenu.Content align="start" class="w-52">
								<DropdownMenu.Item onclick={() => (shortcutsOpen = true)}>
									<Keyboard class="h-3.5 w-3.5" /> Keyboard shortcuts
									<DropdownMenu.Shortcut>?</DropdownMenu.Shortcut>
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									onclick={() => window.open('https://lunapad.dev/docs', '_blank')}
								>
									<BookOpen class="h-3.5 w-3.5" /> Documentation
									<ExternalLink class="ml-auto h-3.5 w-3.5 text-muted-foreground" />
								</DropdownMenu.Item>
								<DropdownMenu.Item
									onclick={() =>
										window.open('https://github.com/nicodemus-opon/lunapad/issues', '_blank')}
								>
									<Bug class="h-3.5 w-3.5" /> Report an issue
									<ExternalLink class="ml-auto h-3.5 w-3.5 text-muted-foreground" />
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item onclick={() => (aboutOpen = true)}>
									<Info class="h-3.5 w-3.5" /> About Lunapad
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</div>
				</div>

				<div class="flex items-center gap-2">
					{#if isNotebookTab}
						{#if collabEnabled && notebookPresence.length > 0}
							<div class="hidden items-center -space-x-1.5 md:flex" aria-label="Teammates viewing">
								{#each notebookPresence.slice(0, 4) as person (person.userId)}
									<span
										class="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-[9px] font-semibold text-muted-foreground"
										title={person.userName}
									>
										{person.userName
											.split(/\s+/)
											.map((p) => p[0])
											.join('')
											.slice(0, 2)
											.toUpperCase()}
									</span>
								{/each}
							</div>
						{/if}
						{#if collabEnabled}
							<Tooltip.Root>
								<Tooltip.Trigger>
									<button
										class="relative flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 {reviewPanelOpen
											? 'bg-primary/15 text-primary'
											: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
										onclick={() => {
											if (reviewPanelOpen) closeCommentPanel();
											else openInbox();
										}}
										aria-pressed={reviewPanelOpen}
										aria-label="Open review inbox"
									>
										<MessageSquare class="h-3.5 w-3.5" />
										<span class="hidden sm:inline">Review</span>
										{#if inboxUnread > 0}
											<span
												class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
											></span>
										{/if}
									</button>
								</Tooltip.Trigger>
								<Tooltip.Content side="bottom">Review threads & inbox</Tooltip.Content>
							</Tooltip.Root>
						{/if}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<button
									class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 {aiChatOpen
										? 'bg-primary/15 text-primary'
										: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
									onclick={() => setAIChatOpen(!getAIChatOpen())}
									aria-pressed={aiChatOpen}
									aria-label="Toggle AI chat"
									data-testid="ai-toggle"
								>
									<Sparkles class="h-3.5 w-3.5" />
									<span class="hidden sm:inline">AI</span>
								</button>
							</Tooltip.Trigger>
							<Tooltip.Content side="bottom">Toggle AI chat (⌘J)</Tooltip.Content>
						</Tooltip.Root>
					{/if}

					<Tooltip.Root>
						<Tooltip.Trigger aria-label="Upload file" onclick={() => (uploadDialogOpen = true)}>
							<Button variant="outline" size="sm">
								<Upload class="h-3.5 w-3.5" />Upload
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content side="bottom">Upload file</Tooltip.Content>
					</Tooltip.Root>

					{#if $session.data?.user}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-2xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
								aria-label="Account menu"
							>
								{userInitials($session.data.user.name, $session.data.user.email)}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end" class="w-48">
								<div class="px-2 py-1.5">
									<p class="truncate text-xs font-medium text-foreground">
										{$session.data.user.name}
									</p>
									<p class="truncate text-2xs text-muted-foreground">{$session.data.user.email}</p>
								</div>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									onclick={() => {
										settingsTab = 'account';
										settingsOpen = true;
									}}
								>
									<Settings class="h-3.5 w-3.5" /> Settings
								</DropdownMenu.Item>
								{#if $session.data.user.role === 'admin'}
									<DropdownMenu.Item
										onclick={() => {
											settingsTab = 'team';
											settingsOpen = true;
										}}
									>
										<ShieldUser class="h-3.5 w-3.5" /> Admin
									</DropdownMenu.Item>
								{/if}
								<DropdownMenu.Separator />
								<DropdownMenu.Item variant="destructive" onclick={() => void handleLogout()}>
									<LogOut class="h-3.5 w-3.5" /> Log out
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					{/if}

					<input
						id="import-notebook-input"
						type="file"
						accept=".json"
						class="hidden"
						onchange={onImportFile}
					/>
				</div>
			</div>
			{#if isDesktop && (platformOS.value === 'windows' || platformOS.value === 'linux')}
				<div class="pointer-events-auto absolute top-0 right-0 h-full">
					<WindowControls />
				</div>
			{/if}
		</header>

		{#if data.demoMode}
			<div
				class="border-b border-border bg-muted/50 px-4 py-2 text-center text-sm text-muted-foreground"
			>
				<strong class="font-medium text-foreground">Demo mode</strong> — read-only, sample data
				only.
				<a
					href="https://github.com/nicodemus-opon/lunapad/blob/main/docs/guide/11-self-hosting.md"
					target="_blank"
					rel="noopener noreferrer"
					class="ml-1 text-primary underline-offset-2 hover:underline"
				>
					Self-host
				</a>
				for connections, dbt, and team features.
			</div>
		{/if}

		{#snippet railButton(panel: SidebarPanel, Icon: typeof BookOpen, tooltipLabel: string)}
			<Tooltip.Root>
				<Tooltip.Trigger
					class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none {activeSidebarPanel ===
					panel
						? 'border border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground'
						: 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'}"
					onclick={() => selectSidebarPanel(panel)}
					aria-label={tooltipLabel}
					aria-pressed={activeSidebarPanel === panel}
				>
					<Icon class="h-4 w-4 shrink-0 stroke-current" />
				</Tooltip.Trigger>
				<Tooltip.Content side="right">{tooltipLabel}</Tooltip.Content>
			</Tooltip.Root>
		{/snippet}

		{#snippet groupHeader(label: string, collapsed: boolean, onToggle: () => void)}
			<button
				type="button"
				class="sidebar-group-header"
				onclick={onToggle}
				aria-expanded={!collapsed}
			>
				<ChevronRight class="sidebar-group-chevron h-3 w-3 shrink-0" />
				<span class="flex-1 truncate text-left">{label}</span>
			</button>
		{/snippet}

		{#snippet headerAction(
			label: string,
			Icon: typeof Plus,
			onclick: () => void,
			highlighted: boolean = false
		)}
			<Tooltip.Root>
				<Tooltip.Trigger
					class="inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none {highlighted
						? 'text-primary'
						: 'text-muted-foreground'}"
					{onclick}
					aria-label={label}
				>
					<Icon class="h-3.5 w-3.5 shrink-0 stroke-current" />
				</Tooltip.Trigger>
				<Tooltip.Content side="bottom">{label}</Tooltip.Content>
			</Tooltip.Root>
		{/snippet}

		<div id="layout-root" class="flex flex-1 overflow-hidden">
			<div
				class="flex h-full flex-row overflow-hidden border-r border-sidebar-border bg-background text-foreground {isDraggingSidebar
					? 'transition-none'
					: 'transition-[width] duration-(--motion-medium) ease-(--motion-ease-out)'}"
				style={sidebarCollapsed ? 'width: var(--sidebar-rail-width)' : `width: ${sidebarWidth}px`}
			>
				<!-- Icon rail (width tracks --sidebar-rail-width — w-9 disagrees with --spacing scale) -->
				<div
					class="flex shrink-0 flex-col items-center gap-0.5 border-r border-sidebar-border bg-background px-1 pt-1 pb-1.5"
					style="width: var(--sidebar-rail-width)"
				>
					{@render railButton('notebooks', BookOpen, 'Notebooks')}
					{@render railButton('tables', Database, 'Databases & tables')}
					{#if isDbtProject}
						{@render railButton('dbt', FlaskConical, 'dbt models')}
					{/if}
					{#if isEvidenceProject}
						{@render railButton('evidence', MonitorPlay, 'Evidence pages')}
					{/if}
					<div class="mt-auto">
						<Tooltip.Root>
							<Tooltip.Trigger
								class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
								onclick={toggleSidebarCollapsed}
								aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
							>
								{#if sidebarCollapsed}
									<PanelLeftOpen class="h-4 w-4 shrink-0 stroke-current" />
								{:else}
									<PanelLeftClose class="h-4 w-4 shrink-0 stroke-current" />
								{/if}
							</Tooltip.Trigger>
							<Tooltip.Content side="right">
								{sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} · ⌘B
							</Tooltip.Content>
						</Tooltip.Root>
					</div>
				</div>

				<!-- Panel content (width collapses to 0 — avoid opacity transitions that can stick) -->
				<div
					class="flex shrink-0 flex-col overflow-hidden {isDraggingSidebar
						? 'transition-none'
						: 'transition-[width] duration-(--motion-medium) ease-(--motion-ease-out)'}"
					style={sidebarCollapsed
						? 'width: 0'
						: `width: calc(${sidebarWidth}px - var(--sidebar-rail-width))`}
					inert={sidebarCollapsed}
					aria-hidden={sidebarCollapsed}
				>
					<ProjectSection />

					{#key activeSidebarPanel}
						<div
							class="flex min-h-0 flex-1 flex-col overflow-hidden"
							in:fade={{ duration: panelFadeMs }}
						>
							{#if activeSidebarPanel === 'notebooks'}
								<!-- Notebooks panel -->
								<div class="sidebar-notebooks-chrome">
									<div class="sidebar-panel-header sidebar-panel-header--embedded">
										<span class="flex-1 text-2xs font-medium text-muted-foreground">Notebooks</span>
										<div class="flex items-center gap-0.5">
											{@render headerAction(
												'Filter notebooks',
												Search,
												() => {
													showNotebookSearch = !showNotebookSearch;
													if (!showNotebookSearch) sidebarSearch = '';
												},
												Boolean(sidebarSearch)
											)}
											{@render headerAction('New folder', FolderPlus, () => {
												pendingRenameFolderId = createFolder('New Folder', null);
											})}
											{@render headerAction('New notebook', Plus, () => addNotebook())}
										</div>
									</div>

									<div class="sidebar-nav-tabs" role="tablist" aria-label="Notebook sidebar view">
										<button
											type="button"
											role="tab"
											aria-selected={sidebarNotebookView === 'browse'}
											class="sidebar-nav-tab"
											onclick={() => setSidebarNotebookView('browse')}
										>
											Browse
										</button>
										<button
											type="button"
											role="tab"
											aria-selected={sidebarNotebookView === 'outline'}
											class="sidebar-nav-tab"
											onclick={() => setSidebarNotebookView('outline')}
										>
											<ListTree class="h-3 w-3" />
											Outline
										</button>
									</div>
								</div>

								{#if sidebarNotebookView === 'browse'}
									{#if favoriteNotebookIds.length > 0}
										<div class="sidebar-group">
											{@render groupHeader('Favorites', favoritesCollapsed, () => (favoritesCollapsed = !favoritesCollapsed))}
											{#if !favoritesCollapsed}
												{#each favoriteNotebookIds as favId (favId)}
													{@const fav = allNotebooks.find((n) => n.id === favId)}
													{#if fav}
														<TreeRow
															depth={0}
															selected={activeTabId === fav.id}
															onActivate={() => setActiveTab(fav.id)}
														>
															{#snippet icon()}
																<BookOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
															{/snippet}
															{#snippet label()}
																<span class="truncate text-xs">{fav.name}</span>
															{/snippet}
														</TreeRow>
													{/if}
												{/each}
											{/if}
										</div>
									{/if}
									{#if recentNotebookIds.length > 0}
										<div class="sidebar-group">
											{@render groupHeader('Recent', recentCollapsed, () => (recentCollapsed = !recentCollapsed))}
											{#if !recentCollapsed}
												{#each recentNotebookIds.slice(0, 6) as recentId (recentId)}
													{@const recent = allNotebooks.find((n) => n.id === recentId)}
													{#if recent}
														<TreeRow
															depth={0}
															selected={activeTabId === recent.id}
															onActivate={() => setActiveTab(recent.id)}
														>
															{#snippet icon()}
																<BookOpen class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
															{/snippet}
															{#snippet label()}
																<span class="truncate text-xs">{recent.name}</span>
															{/snippet}
														</TreeRow>
													{/if}
												{/each}
											{/if}
										</div>
									{/if}
									{#if (favoriteNotebookIds.length > 0 || recentNotebookIds.length > 0) && !showNotebookSearch && !sidebarSearch}
										<div class="sidebar-tree-divider"></div>
									{/if}
									{#if showNotebookSearch || sidebarSearch}
										<div class="sidebar-inline-search">
											<Search class="h-3 w-3 shrink-0 text-muted-foreground/60" />
											<!-- svelte-ignore a11y_autofocus -->
											<input
												autofocus
												class="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/60"
												placeholder="Filter notebooks…"
												bind:value={sidebarSearch}
												onkeydown={(e) => {
													if (e.key === 'Escape') {
														sidebarSearch = '';
														showNotebookSearch = false;
													}
												}}
											/>
											{#if sidebarSearch}
												<button
													class="rounded-sm text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
													onclick={() => {
														sidebarSearch = '';
														showNotebookSearch = false;
													}}
													aria-label="Clear filter"
												>
													<X class="h-3 w-3" />
												</button>
											{/if}
										</div>
									{/if}

									<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
										<div class="min-h-0 flex-1 overflow-hidden">
											<NotebookTree
											bind:pendingRenameFolderId
											filterQuery={sidebarSearch}
											onBrowseTemplates={() => (templateGalleryOpen = true)}
										/>
										</div>
										{#if isNotebookTab && activeTabId}
											<NotebookBacklinks notebookId={activeTabId} />
										{/if}
									</div>
								{:else if isNotebookTab && activeNotebook}
									<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
										<p
											class="mx-[var(--sidebar-row-inset)] px-[calc(var(--sidebar-panel-x)-var(--sidebar-row-inset))] py-2 text-2xs leading-relaxed text-muted-foreground"
										>
											Expand a notebook in Browse to see its outline here, or use the page chips
											above the document.
										</p>
										<NotebookOutline
											notebookId={activeNotebook.id}
											notebookName={activeNotebook.name}
											cells={activeNotebook.cells}
											scrollContainer={notebookScrollEl ?? null}
											showHeader={false}
										/>
										<NotebookBacklinks notebookId={activeNotebook.id} />
									</div>
								{:else}
									<div class="flex flex-1 items-center justify-center px-4 py-8 text-center">
										<p class="text-xs text-muted-foreground">
											Open a notebook tab to see its outline.
										</p>
									</div>
								{/if}
							{:else if activeSidebarPanel === 'tables'}
								<!-- Databases & tables panel -->
								<div class="sidebar-panel-header">
									<span class="flex-1 text-2xs font-medium text-muted-foreground">Databases</span>
									<Button
										variant="outline"
										size="sm"
										class="h-6 px-2 text-2xs"
										onclick={() => {
											settingsTab = 'connections';
											settingsOpen = true;
										}}
									>
										Manage
									</Button>
								</div>
								<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
									<FileImporter />
									<div class="min-h-0 flex-1 overflow-y-auto">
										<DatabaseTree />
									</div>
								</div>
							{:else if activeSidebarPanel === 'dbt' && isDbtProject}
								<!-- dbt panel -->
								<DbtPanel />
							{:else if activeSidebarPanel === 'evidence' && isEvidenceProject}
								<!-- Evidence panel -->
								<div class="min-h-0 flex-1 overflow-y-auto">
									<EvidencePanel />
								</div>
							{/if}
						</div>
					{/key}
				</div>
			</div>

			<!-- Resize handle -->
			{#if !sidebarCollapsed}
				<div
					class="relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-primary/40 {isDraggingSidebar
						? 'after:bg-primary/50'
						: 'after:bg-transparent'}"
					onpointerdown={onSidebarPointerDown}
					ondblclick={toggleSidebarCollapsed}
					role="separator"
					aria-orientation="vertical"
					aria-valuemin={220}
					aria-valuemax={460}
					aria-valuenow={sidebarWidth}
					title="Drag to resize · Double-click to collapse"
				></div>
			{/if}

			<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
				{#snippet tabMenu(
					onClose: () => void,
					onCloseOthers: () => void,
					onCloseAll: () => void,
					closeDisabled: boolean,
					othersDisabled: boolean
				)}
					<ContextMenu.Item disabled={closeDisabled} onclick={onClose}>Close tab</ContextMenu.Item>
					<ContextMenu.Item disabled={othersDisabled} onclick={onCloseOthers}
						>Close other tabs</ContextMenu.Item
					>
					<ContextMenu.Separator />
					<ContextMenu.Item onclick={onCloseAll}>Close all tabs</ContextMenu.Item>
				{/snippet}

				{#snippet appTab(opts: {
					id: string;
					name: string;
					icon?: typeof Table2;
					dirty?: boolean;
					staleCount?: number;
					renamable?: boolean;
					closable?: boolean;
					closeLabel?: string;
					onClose: () => void;
				})}
					{@const isActive = activeTabId === opts.id}
					{@const Icon = opts.icon}
					<div
						class="group relative flex h-9 shrink-0 cursor-pointer items-center gap-1.5 px-3 text-xs transition-colors select-none after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors {isActive
							? 'font-medium text-foreground after:bg-secondary'
							: 'text-muted-foreground after:bg-transparent hover:bg-muted/40 hover:text-foreground'}"
						role="tab"
						tabindex="0"
						aria-selected={isActive}
						onclick={() => setActiveTab(opts.id)}
						onkeydown={(e) => e.key === 'Enter' && setActiveTab(opts.id)}
						ondblclick={() => {
							if (opts.renamable) startRename(opts.id, opts.name);
						}}
						onauxclick={(e) => {
							if (e.button === 1 && opts.closable !== false) {
								e.preventDefault();
								opts.onClose();
							}
						}}
					>
						{#if Icon}
							<Icon class="h-3 w-3 shrink-0" />
						{/if}
						{#if opts.renamable && renamingTabId === opts.id}
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
							<span class="max-w-32 truncate">{opts.name}</span>
						{/if}
						{#if (opts.staleCount ?? 0) > 0}
							<span
								class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning/15 px-1 text-2xs font-medium text-warning"
								title="{opts.staleCount} stale cell{opts.staleCount === 1 ? '' : 's'}"
								>{opts.staleCount}</span
							>
						{/if}
						{#if opts.closable !== false}
							<span class="relative ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
								{#if opts.dirty}
									<span
										class="absolute h-1.5 w-1.5 rounded-full bg-warning transition-opacity group-hover:opacity-0"
										title="Unsaved changes"
									></span>
								{/if}
								<button
									class="absolute inset-0 flex items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
									onclick={(e) => {
										e.stopPropagation();
										opts.onClose();
									}}
									aria-label={opts.closeLabel ?? 'Close tab'}
								>
									<X class="h-3 w-3" />
								</button>
							</span>
						{:else if opts.dirty}
							<span
								class="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
								title="Unsaved changes"
							></span>
						{/if}
					</div>
				{/snippet}

				<div
					class="flex shrink-0 items-center gap-0.5 overflow-x-auto scroll-smooth border-b border-border bg-background px-2"
					role="tablist"
				>
					<button
						type="button"
						class="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
						title={notebookTabsCollapsed ? 'Show notebook tabs' : 'Hide notebook tabs'}
						aria-label={notebookTabsCollapsed ? 'Show notebook tabs' : 'Hide notebook tabs'}
						aria-expanded={!notebookTabsCollapsed}
						onclick={() => {
							notebookTabsCollapsed = !notebookTabsCollapsed;
							localStorage.setItem(
								NOTEBOOK_TABS_COLLAPSED_KEY,
								notebookTabsCollapsed ? 'true' : 'false'
							);
						}}
					>
						<ChevronDown
							class="h-3.5 w-3.5 transition-transform {notebookTabsCollapsed ? '-rotate-90' : ''}"
						/>
					</button>
					{#if !notebookTabsCollapsed}
						{#each notebooks as nb (nb.id)}
							{@const staleCount = nb.cells.filter(
								(c) => c.cellType === 'query' && c.needsRun
							).length}
							<ContextMenu.Root>
								<ContextMenu.Trigger>
									{@render appTab({
										id: nb.id,
										name: notebookDisplayName(nb.id, nb.name),
										dirty: isNotebookDirty(nb.id),
										staleCount,
										renamable: true,
										closable: notebooks.length > 1,
										closeLabel: 'Close notebook',
										onClose: () => closeNotebookTab(nb.id)
									})}
								</ContextMenu.Trigger>
								<ContextMenu.Content>
									{@render tabMenu(
										() => closeNotebookTab(nb.id),
										() => closeOtherNotebookTabs(nb.id),
										closeAllNotebookTabs,
										notebooks.length <= 1,
										notebooks.length <= 1
									)}
								</ContextMenu.Content>
							</ContextMenu.Root>
						{/each}
					{/if}

					{#each openResultTabs as rt (rt.id)}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								{@render appTab({
									id: rt.id,
									name: rt.name,
									icon: Table2,
									closeLabel: 'Close result tab',
									onClose: () => closeResultTab(rt.id)
								})}
							</ContextMenu.Trigger>
							<ContextMenu.Content>
								{@render tabMenu(
									() => closeResultTab(rt.id),
									() => closeOtherResultTabs(rt.id),
									closeAllResultTabs,
									false,
									openResultTabs.length <= 1
								)}
							</ContextMenu.Content>
						</ContextMenu.Root>
					{/each}

					{#each openExtraTabs as et (et.id)}
						{@const extraIcon =
							et.type === 'profile'
								? BarChart2
								: et.type === 'lineage'
									? Network
									: et.type === 'evidence-preview'
										? MonitorPlay
										: Table2}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								{@render appTab({
									id: et.id,
									name: et.name,
									icon: extraIcon,
									onClose: () => closeExtraTab(et.id)
								})}
							</ContextMenu.Trigger>
							<ContextMenu.Content>
								{@render tabMenu(
									() => closeExtraTab(et.id),
									() => closeOtherExtraTabs(et.id),
									closeAllExtraTabs,
									false,
									openExtraTabs.length <= 1
								)}
							</ContextMenu.Content>
						</ContextMenu.Root>
					{/each}

					<button
						class="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
						onclick={addNotebook}
						title="New notebook"
						aria-label="New notebook"
					>
						<Plus class="h-3.5 w-3.5" />
					</button>
				</div>
				{#if isNotebookTab}
					<div class="flex min-h-0 flex-1 overflow-hidden">
						<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
							{#if worksheetCell && activeNotebook}
								<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
									<CellWorksheetView
										cell={worksheetCell}
										index={worksheetCellIndex}
										notebookId={activeTabId}
										dark={isDark}
										prevCellSources={prevSourcesForCell(worksheetCellIndex)}
										{autoRun}
										{collabEnabled}
										onShareWithAI={() => {
											setAIChatOpen(true);
											addContextCell(worksheetCell.id);
										}}
										onFixWithAI={aiChatOpen
											? (errorMsg) => {
													addContextCell(worksheetCell.id);
													setAIChatOpen(true);
													void submitAIMessage(
														`Fix this SQL error in \`${worksheetCell.outputName}\`: ${errorMsg}`
													);
												}
											: undefined}
										onContinueWithAI={(instruction) => {
											addContextCell(worksheetCell.id);
											setAIChatOpen(true);
											setPendingSuggestion(instruction);
										}}
										onOpenResultTab={handleOpenResultTab}
									/>
								</div>
							{:else}
								<main
									bind:this={notebookScrollEl}
									class="notebook-scroll flex-1 overflow-y-auto bg-background"
								>
									<div
										class="notebook-page mx-auto w-full max-w-[var(--notebook-page-width)] px-[var(--notebook-page-padding)] pt-10 pb-32"
									>
										<div class="mb-6 flex items-center gap-3">
											<input
												class="h-9 min-w-0 flex-1 border-0 bg-transparent p-0 text-xl font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/60"
												placeholder="Untitled notebook"
												value={activeNotebook
													? notebookDisplayName(activeNotebook.id, activeNotebook.name)
													: ''}
												oninput={(e) => {
													if (!activeNotebook) return;
													updateNotebookTitleDraft(
														activeNotebook.id,
														(e.target as HTMLInputElement).value
													);
												}}
												onblur={(e) => {
													if (!activeNotebook) return;
													updateNotebookTitleDraft(
														activeNotebook.id,
														(e.target as HTMLInputElement).value
													);
													commitNotebookTitle(activeNotebook.id, activeNotebook.name);
												}}
												onkeydown={(e) => {
													if (e.key === 'Enter') {
														e.preventDefault();
														(e.target as HTMLInputElement).blur();
													}
												}}
											/>

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
												<Select.Trigger class="h-7 min-w-44 font-mono text-xs">
													{#if activeNotebookConnectionValue === '__mixed__'}
														Mixed connections
													{:else}
														{connections.find(
															(connection) => connection.id === activeNotebookConnectionValue
														)?.name ?? 'DuckDB (built-in)'}
													{/if}
												</Select.Trigger>
												<Select.Content>
													{#if activeNotebookConnectionValue === '__mixed__'}
														<Select.Item value="__mixed__" class="font-mono text-xs"
															>Mixed connections</Select.Item
														>
													{/if}
													{#each connections as connection (connection.id)}
														<Select.Item value={connection.id} class="font-mono text-xs"
															>{connection.name}</Select.Item
														>
													{/each}
												</Select.Content>
											</Select.Root>

											<Select.Root
												type="single"
												value={String(activeNotebook?.autoRefreshIntervalMs ?? 0)}
												onValueChange={(value) => {
													if (!activeNotebook) return;
													setNotebookAutoRefresh(activeNotebook.id, Number(value));
												}}
											>
												<Select.Trigger class="h-7 min-w-24 gap-1.5 text-xs">
													<RefreshCw class="h-3 w-3" />
													{#if !activeNotebook?.autoRefreshIntervalMs}
														Off
													{:else if activeNotebook.autoRefreshIntervalMs === 30000}
														30s
													{:else if activeNotebook.autoRefreshIntervalMs === 60000}
														1m
													{:else if activeNotebook.autoRefreshIntervalMs === 300000}
														5m
													{:else if activeNotebook.autoRefreshIntervalMs === 900000}
														15m
													{:else if activeNotebook.autoRefreshIntervalMs === 1800000}
														30m
													{:else if activeNotebook.autoRefreshIntervalMs === 3600000}
														1h
													{:else}
														{Math.round(activeNotebook.autoRefreshIntervalMs / 60_000)}m
													{/if}
												</Select.Trigger>
												<Select.Content>
													<Select.Item value="0" class="text-xs">Auto-refresh: Off</Select.Item>
													<Select.Item value="30000" class="text-xs">Every 30s</Select.Item>
													<Select.Item value="60000" class="text-xs">Every 1m</Select.Item>
													<Select.Item value="300000" class="text-xs">Every 5m</Select.Item>
													<Select.Item value="900000" class="text-xs">Every 15m</Select.Item>
													<Select.Item value="1800000" class="text-xs">Every 30m</Select.Item>
													<Select.Item value="3600000" class="text-xs">Every 1h</Select.Item>
												</Select.Content>
											</Select.Root>
										</div>

										{#if cells.length === 0}
											<div class="flex flex-col items-center gap-4 py-16 text-center">
												<div class="flex flex-col items-center gap-2">
													<p class="text-sm font-medium text-foreground/70">Empty notebook</p>
													<p class="max-w-xs text-xs text-muted-foreground">
														Add a query cell to start exploring your data. Reference upstream cells
														by name using <code
															class="rounded bg-muted px-1 py-0.5 font-mono text-2xs"
															>from cell_name</code
														>.
													</p>
												</div>
												<div class="flex w-full max-w-xs flex-col gap-2">
													<Button
														variant="default"
														size="sm"
														class="h-8 w-full gap-2 text-xs"
														onclick={() => addCellWithLanguage('prql')}
													>
														<Plus class="h-3.5 w-3.5" />
														Add PRQL Cell
														<span class="ml-auto font-mono text-2xs opacity-60">⌘⇧↵</span>
													</Button>
													<Button
														variant="outline"
														size="sm"
														class="h-8 w-full gap-2 text-xs"
														onclick={() => addCellWithLanguage('sql')}
													>
														<Plus class="h-3.5 w-3.5" />
														Add SQL Cell
													</Button>
													<Button
														variant="outline"
														size="sm"
														class="h-8 w-full gap-2 text-xs"
														onclick={addMarkdownCell}
													>
														<Info class="h-3.5 w-3.5" />
														Add Markdown Cell
														<span class="ml-auto font-mono text-2xs opacity-60">⌘⇧M</span>
													</Button>
												</div>
												<div class="space-y-0.5 text-2xs text-muted-foreground">
													<p>
														Press <kbd class="rounded bg-muted px-1 font-mono">?</kbd> for keyboard shortcuts
													</p>
												</div>
											</div>
										{:else}
											{#if showDemoCta}
												<div
													class="mb-4 flex flex-col gap-3 rounded-lg border border-primary bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
												>
													<div>
														<p class="text-sm font-medium text-foreground">New here?</p>
														<p class="text-xs text-muted-foreground">
															Browse starter templates to see charts, PRQL, and dashboards in about
															30 seconds.
														</p>
													</div>
													<Button
														size="sm"
														class="shrink-0 gap-2"
														onclick={() => (templateGalleryOpen = true)}
													>
														<FlaskConical class="h-3.5 w-3.5" />
														Browse templates
													</Button>
												</div>
											{/if}
											<NotebookBreadcrumbs
												notebookId={activeTabId}
												notebookName={activeNotebook?.name ?? 'Untitled'}
												folderId={activeNotebook?.folderId ?? null}
												{cells}
											/>
											{#if reportView}
												<ReportViewShell
													notebookId={activeTabId}
													markdowns={reportMarkdowns}
													onDrill={handleDrillToCell}
												>
													{#snippet children()}
														<MarkdocPreviewProvider
															notebookId={activeTabId}
															onDrill={handleDrillToCell}
														>
															<NotebookDocumentEditor
																notebookId={activeTabId}
																{cells}
																dark={isDark}
																reportView={true}
																refEntries={markdownRefEntries}
															/>
														</MarkdocPreviewProvider>
													{/snippet}
												</ReportViewShell>
											{:else}
												<MarkdocPreviewProvider
													notebookId={activeTabId}
													onDrill={handleDrillToCell}
												>
													<NotebookDocumentEditor
														notebookId={activeTabId}
														{cells}
														dark={isDark}
														reportView={false}
														refEntries={markdownRefEntries}
													/>
												</MarkdocPreviewProvider>
											{/if}
										{/if}
									</div>
								</main>
							{/if}
							<NotebookStatusBar
								{connections}
								defaultConnectionId={activeNotebook?.cells.find((c) => c.cellType === 'query')
									?.connectionId ?? null}
								{reportView}
							/>
						</div>
						{#if aiChatOpen}
							<AIChatPanel width={aiPanelWidth} onStartResize={onAIPanelPointerDown} />
						{/if}
						{#if collabEnabled && reviewPanelOpen}
							<ReviewPanel width={reviewPanelWidth} onStartResize={onReviewPanelPointerDown} />
						{/if}
					</div>
				{:else if activeExtraTab}
					{#if activeExtraTab.type === 'lineage'}
						<!-- Lineage fills the full remaining height with no scroll/padding -->
						<main class="flex-1 overflow-hidden">
							<DbtLineageView focusedModelName={activeExtraTab.focusedModelName} />
						</main>
					{:else if activeExtraTab.type === 'evidence-preview'}
						<main class="flex-1 overflow-hidden">
							<EvidencePreview pagePath={activeExtraTab.pagePath ?? ''} />
						</main>
					{:else}
						<main class="flex-1 overflow-y-auto">
							<div class="mx-auto max-w-7xl px-4 py-4">
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
					<main class="flex flex-1 flex-col overflow-hidden px-4 py-3">
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
								onAddSort={resultCell.editMode === 'gui'
									? (col, dir) =>
											updateGuiStages(resultCell.id, [
												...resultCell.guiStages,
												{ type: 'sort', keys: [{ column: col, dir }] }
											])
									: undefined}
								onAddFilter={resultCell.editMode === 'gui'
									? (col) =>
											updateGuiStages(resultCell.id, [
												...resultCell.guiStages,
												{
													type: 'filter',
													conditions: [{ column: col, op: '==', value: '' }],
													logic: 'and'
												}
											])
									: undefined}
							/>
						{:else if resultCell && resultCell.status === 'running'}
							<div class="mt-8 flex items-center gap-3 text-sm text-muted-foreground">
								<Database class="h-4 w-4 animate-pulse" />
								Running query…
							</div>
						{:else}
							<div class="mt-16 flex flex-col items-center gap-2 text-muted-foreground">
								<Table2 class="h-8 w-8 opacity-30" />
								<p class="text-sm">No results available. Run the cell first.</p>
							</div>
						{/if}
					</main>
				{/if}
			</div>
		</div>
	</div>
{/if}

<CommandPalette
	bind:open={commandPaletteOpen}
	onClose={() => (commandPaletteOpen = false)}
	onToggleSidebar={toggleSidebarCollapsed}
/>

<SettingsDialog
	bind:open={settingsOpen}
	bind:tab={settingsTab}
	onLogout={() => void handleLogout()}
/>

<Dialog.Root bind:open={shortcutsOpen}>
	<Dialog.Content class="max-h-[85vh] max-w-2xl overflow-y-auto p-6" data-keyboard-scope="modal">
		<h2 class="mb-4 text-sm font-semibold">Keyboard shortcuts</h2>

		<div class="grid grid-cols-2 gap-6 text-xs">
			{#each SHORTCUT_GROUPS as group}
				{@const rows = shortcutTables[group.key] ?? []}
				{#if rows.length > 0}
					<div>
						<p class="mb-2 text-2xs font-semibold text-muted-foreground">{group.title}</p>
						{#if group.key === 'command-mode'}
							<p class="mb-2 text-2xs text-muted-foreground italic">
								Activate: press <code class="rounded bg-muted px-1 font-mono text-2xs">Esc</code> from
								any editor
							</p>
						{/if}
						{#if group.key === 'gui-stages'}
							<p class="mb-2 text-2xs text-muted-foreground italic">
								Activate: click a stage or press <code
									class="rounded bg-muted px-1 font-mono text-2xs">Enter</code
								> in command mode
							</p>
						{/if}
						<table class="w-full">
							<tbody class="divide-y divide-border">
								{#each rows as row}
									<tr>
										<td class="py-1 pr-4 font-mono whitespace-nowrap text-foreground"
											>{row.chord}</td
										>
										<td class="py-1 text-muted-foreground">{row.label}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			{/each}
		</div>
	</Dialog.Content>
</Dialog.Root>

<!-- Open project dialog -->
<Dialog.Root
	bind:open={projectOpenDialogOpen}
	onOpenChange={(v) => {
		if (!v) projectFolderInput = '';
	}}
>
	<Dialog.Content class="relative max-w-105 gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<Dialog.Title>Open project folder</Dialog.Title>
			<Dialog.Description>
				Enter the path to an existing project folder. Supports SQL, PRQL, and project formats
				including dbt.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Close class="absolute top-2.5 right-3" />

		<div class="flex flex-col gap-4 px-4 py-4">
			<div class="flex flex-col gap-1.5">
				<label for="menu-open-folder-path" class="text-xs font-medium text-foreground/70"
					>Folder path</label
				>
				<Input
					id="menu-open-folder-path"
					class="h-8 font-mono text-sm"
					placeholder="/Users/you/my-project"
					bind:value={projectFolderInput}
					onkeydown={(e: KeyboardEvent) => {
						if (e.key === 'Enter') void handleOpenProject();
					}}
				/>
			</div>
		</div>

		<Dialog.Footer>
			<Button
				variant="ghost"
				size="sm"
				class="h-7 text-xs"
				onclick={() => (projectOpenDialogOpen = false)}
			>
				Cancel
			</Button>
			<Button
				size="sm"
				class="h-7 text-xs"
				onclick={() => void handleOpenProject()}
				disabled={!projectFolderInput.trim() || projectOpenLoading}
			>
				{projectOpenLoading ? 'Opening…' : 'Open'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<UploadDialog bind:open={uploadDialogOpen} />
<ShareDialog
	bind:open={shareDialogOpen}
	notebook={activeNotebook}
	onOpenSites={() => {
		shareDialogOpen = false;
		sitesDialogOpen = true;
	}}
/>
<SitesPanel bind:open={sitesDialogOpen} />
<WelcomeDialog
	bind:open={welcomeOpen}
	onBrowseTemplates={() => {
		markWelcomeSeen();
		templateGalleryOpen = true;
	}}
	onStartBlank={() => {
		markWelcomeSeen();
	}}
/>
<TemplateGalleryDialog bind:open={templateGalleryOpen} />

<!-- About dialog -->
<Dialog.Root bind:open={aboutOpen}>
	<Dialog.Content class="max-w-sm gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<div class="flex items-center gap-2">
				<Logo class="h-5 w-5 text-foreground" />
				<Dialog.Title>Lunapad</Dialog.Title>
			</div>
		</Dialog.Header>
		<div class="flex flex-col gap-3 px-4 py-4 text-sm text-muted-foreground">
			<p>
				A notebook-style SQL IDE that runs entirely in the browser. Write SQL, reference other cells
				as CTEs, and query DuckDB or external databases interactively.
			</p>
			<div class="space-y-1 rounded-lg border bg-muted/40 px-3 py-2 font-mono text-xs">
				<div class="flex justify-between">
					<span>Engine</span><span class="text-foreground">DuckDB WASM/ Trino</span>
				</div>
				<div class="flex justify-between">
					<span>Language</span><span class="text-foreground">SQL / PRQL</span>
				</div>
				<div class="flex justify-between">
					<span>Framework</span><span class="text-foreground">SvelteKit</span>
				</div>
			</div>
			<div class="flex gap-2 pt-1">
				<button
					class="flex items-center gap-1.5 text-xs text-primary hover:underline"
					onclick={() => window.open('https://lunapad.dev/docs', '_blank')}
				>
					<ExternalLink class="h-3 w-3" /> lunapad.dev/docs
				</button>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
