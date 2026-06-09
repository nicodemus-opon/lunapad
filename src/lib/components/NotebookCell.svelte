<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Input } from '$lib/components/ui/input';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { marked } from 'marked';
	import Editor from './Editor.svelte';
	import GUIEditor from './gui/GUIEditor.svelte';
	import InlineResultView from './InlineResultView.svelte';
import MaterializeDialog from './MaterializeDialog.svelte';
	import { prqlToGuiStages, extractLetBindings, mapErrorsToStages, mergeParsedWithHiddenStages } from '$lib/services/gui-prql';
	import { compilePRQL } from '$lib/services/prql';
	import { coerceNumber } from '$lib/utils';
	import type { PRQLStageError } from '$lib/services/gui-prql';
	import {
		runCell,
		cancelCell,
		runCellAndDownstream,
		removeCell,
		moveCell,
		updateCellCode,
		updateCellName,
		updateGuiStages,
		setEditMode,
		setCellLanguage,
		setCellCollapsed,
		setStageResultCollapsed,
		registerInsertCallback,
		insertCellBefore,
		insertCellAfter,
		addCellBefore,
		addCellAfter,
		getTables,
		getExternalSchemaTables,
		runGuiStagePreview,
		getPrecedingCodeForCell,
		getConnections,
		getRunImpact,
		setCellResultViewMode,
		setCellResultChartConfig,
		setCellConnection,
		updateCellMarkdown,
		setCellMarkdownPreview,
		setCellMaterializeMode,
		materializeCell,
		setCellScheduleEnabled,
		setCellScheduleIntervalMinutes,
		setCellScheduleScope,
		processScheduledMaterializations,
		setCellDbtConfig,
		setCellDescription,
		testCell,
		openLineageTab,
		getIsDbtProject,
		getProjectFolder,
		getDbtModels,
		refreshDbtManifest,
		type CellMaterializationMode,
		type CellScheduleScope,
		type CellLanguage,
		type Cell,
		type DbtTestResult,
		getCrossNotebookUsageCount
	} from '$lib/stores/notebook.svelte';
	import { updateProjectSchema } from '$lib/services/project-client';

	import type { GUIPipelineStage, GUISourceSchema } from '$lib/types/gui-pipeline';
	import type { ResultViewMode } from '$lib/types/gui-pipeline';
	import {
		Play,
		Trash2,
		ChevronUp,
		ChevronDown,
		ChevronRight,
		Loader2,
		CheckCircle2,
		XCircle,
		Code2,
		MoreVertical,
		ExternalLink,
		BarChart3,
		Sigma,
		ChevronsUpDown,
		Database,
		FlaskConical,
		X,
		Clock
	} from '@lucide/svelte';
	import { BUILTIN_DUCKDB_CONNECTION_ID, getPRQLTargetForConnection, resolveConnection } from '$lib/types/connection';

	interface Props {
		cell: Cell;
		index: number;
		isFirst: boolean;
		isLast: boolean;
		dark?: boolean;
		prevCellSources?: GUISourceSchema[];
		notebookId?: string;
		autoRun?: boolean;
		onOpenResultTab?: (
			cellId: string,
			notebookId: string,
			name: string,
			preferredViewMode?: ResultViewMode
		) => void;
	}

	let {
		cell,
		index,
		isFirst,
		isLast,
		dark = false,
		prevCellSources = [],
		notebookId = '',
		autoRun = false,
		onOpenResultTab
	}: Props = $props();

	let editorRef: Editor | undefined = $state();
	let sqlExpanded = $state(false);
	let autoRunTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingAutoRun = $state(false);
	let menuOpen = $state(false);
	let menuTop = $state(0);
	let menuRight = $state(0);
	let menuDropdownEl: HTMLDivElement | undefined = $state();
	let materializeDialogOpen = $state(false);
	let nameInputValue = $state(untrack(() => cell.outputName));
	// Keep nameInputValue in sync with external changes (e.g. file watcher reload)
	// but only when the user isn't actively editing it.
	let nameInputFocused = $state(false);
	$effect(() => {
		if (!nameInputFocused) nameInputValue = cell.outputName;
	});
	let testPanelVisible = $state(false);
	let testPanelCollapsed = $state(false);
	let kebabAnchorEl: HTMLDivElement | undefined = $state();
	const EDITOR_COMPLETION_LIMIT = 600;
	const PRQL_KEYWORDS = [
		'from',
		'select',
		'derive',
		'filter',
		'group',
		'aggregate',
		'sort',
		'take',
		'join',
		'let',
		'case'
	] as const;
	const collapsed = $derived(cell.collapsed);
	let running = $derived(cell.status === 'running');
	let materializing = $derived(cell.materializeStatus === 'running');
	let cellFocused = $state(false);
	let cellHovered = $state(false);
	let cellContainerEl: HTMLElement | undefined = $state();
	let ddPending = $state(false);
	let confirmSwitchToGui = $state(false);
	let confirmSwitchToSql = $state<false | 'with-code' | 'without-code'>(false);
	let compiledSqlForSwitch = $state('');
	let confirmSwitchToPrql = $state(false);
	const showResultControls = $derived(cellFocused || cellHovered);
	const showResult = $derived(Boolean(cell.result) && (cell.status === 'success' || cell.status === 'running'));
	const isQueryCell = $derived(cell.cellType === 'query');
	const renderedMarkdown = $derived.by(() => {
		if (isQueryCell) return '';
		const markdown = (cell.markdown || '').trim();
		if (!markdown) return '';
		return marked.parse(markdown, { async: false, breaks: true, gfm: true });
	});
	const safeMarkdown = $derived.by(() => {
		if (!renderedMarkdown) return '';
		return String(renderedMarkdown)
			.replace(/<script[\s\S]*?<\/script>/gi, '')
			.replace(/on[a-z]+="[^"]*"/gi, '');
	});
	const isMarkdownPreviewMode = $derived(!isQueryCell && cell.markdownPreview && !!cell.markdown?.trim());
	const prevCellNames = $derived(prevCellSources.map((source) => source.name));
	const tables = $derived(getTables());
	const externalSchemaTables = $derived(getExternalSchemaTables());
	const connections = $derived(getConnections());
	const connectionValue = $derived(cell.connectionId ?? BUILTIN_DUCKDB_CONNECTION_ID);

	const connectionType = $derived.by(() => {
		const connection = connections.find((entry) => entry.id === connectionValue);
		return connection?.type ?? 'duckdb-wasm';
	});

	// For Trino-backed sources, produce 3-part names (catalogName.schema.table) in completions
	const cellCatalogName = $derived.by(() => {
		if (connectionType === 'duckdb-wasm') return undefined;
		const conn = connections.find((c) => c.id === connectionValue);
		return (conn as { catalogName?: string } | undefined)?.catalogName;
	});

	const guiTables = $derived.by(() => {
		if (connectionValue === BUILTIN_DUCKDB_CONNECTION_ID) {
			return tables;
		}
		const merged: typeof tables = [];
		const seen = new Set<string>();
		for (const table of externalSchemaTables) {
			if (table.connectionId !== connectionValue) continue;
			const qualifiedName = cellCatalogName && table.schema
			? `${cellCatalogName}.${table.schema}.${table.name}`
			: table.schema ? `${table.schema}.${table.name}` : table.name;
			if (seen.has(qualifiedName)) continue;
			seen.add(qualifiedName);
			merged.push({
				name: qualifiedName,
				fileName: qualifiedName,
				rowCount: 0,
				columns: table.columns,
				columnTypes: table.columnTypes
			});
		}
		return merged;
	});
	const cellSqlDialect = $derived(getPRQLTargetForConnection(resolveConnection(connections, cell.connectionId)));
	const isDbtProject = $derived(getIsDbtProject());
	const projectFolder = $derived(getProjectFolder());

	// Column descriptions from the matching dbt model (keyed by column name)
	const columnDescriptions = $derived.by((): Record<string, string> => {
		if (!isDbtProject) return {};
		const model = getDbtModels().find((m) => m.name === cell.outputName);
		if (!model) return {};
		return Object.fromEntries(
			model.columns.filter((c) => c.description).map((c) => [c.name, c.description!])
		);
	});

	function handleColumnDescriptionChange(column: string, description: string) {
		if (!projectFolder || !notebookId) return;
		const relPath = `${notebookId}.prql`;
		updateProjectSchema(projectFolder, relPath, {
			columns: [{ name: column, description }]
		}).catch(() => {});
		// Optimistically update dbt model in store
		const models = getDbtModels();
		const model = models.find((m) => m.name === cell.outputName);
		if (model) {
			const col = model.columns.find((c) => c.name === column);
			if (col) col.description = description;
			else model.columns.push({ name: column, dataType: 'unknown', description, tests: [] });
		}
	}

	const editorCompletions = $derived.by(() => {
		if (!isQueryCell || cell.editMode !== 'prql' || collapsed) return [];

		const values = new Set<string>(PRQL_KEYWORDS);
		for (const table of guiTables) {
			if (values.size >= EDITOR_COMPLETION_LIMIT) break;
			values.add(table.name);
			for (const column of table.columns) {
				if (values.size >= EDITOR_COMPLETION_LIMIT) break;
				values.add(`${table.name}.${column}`);
			}
		}

		for (const source of prevCellSources) {
			if (values.size >= EDITOR_COMPLETION_LIMIT) break;
			values.add(source.name);
			for (const column of source.columns) {
				if (values.size >= EDITOR_COMPLETION_LIMIT) break;
				values.add(column);
			}
		}

		return Array.from(values);
	});
	const runImpact = $derived(getRunImpact(cell.id));
	const runTooltipText = $derived.by(() => {
		if (!isQueryCell) return '';
		if (runImpact.segmentCount <= 1) return 'Run cell (⇧↵ or ⌘↵)';
		return `Run cell (⇧↵ or ⌘↵). Also reruns ${runImpact.downstreamCount} downstream cell${runImpact.downstreamCount === 1 ? '' : 's'}.`;
	});
	const intelligenceSummary = $derived.by(() => {
		if (!cell.intelligence) return null;
		const qualityWarnings = cell.intelligence.dataQuality.filter((check) => check.status === 'warn').length;
		const perfWarnings = cell.intelligence.performance.filter((item) => item.severity === 'warn').length;
		return {
			rowCount: cell.intelligence.rowCount,
			columnCount: cell.intelligence.columnCount,
			connectionId: cell.intelligence.connectionId,
			nextAnalysis: cell.intelligence.nextAnalyses[0] ?? null,
			qualityWarnings,
			perfWarnings,
			joinCount: cell.intelligence.joinSuggestions.length,
			schemaMatchCount: cell.intelligence.semanticMatches.length
		};
	});

	// Map cell compile errors to specific GUI pipeline stages
	const stageErrorMap = $derived(
		cell.editMode === 'gui' && cell.errors.length > 0
			? mapErrorsToStages(
					cell.guiStages,
					cell.errors,
					(() => { const p = getPrecedingCodeForCell(cell.id); return p ? p.split('\n').length : 0; })()
				)
			: new Map<number, PRQLStageError[]>()
	);

	// Auto-run: re-run this cell (and its downstream segment) after content changes
	$effect(() => {
		if (!isQueryCell) return;
		// Track content — code in PRQL mode, stages in GUI mode
		const _content = cell.editMode === 'gui'
			? JSON.stringify(cell.guiStages)
			: cell.code;

		clearTimeout(autoRunTimer);

		if (!autoRun) return;

		autoRunTimer = setTimeout(() => {
			if (cell.status === 'running') {
				pendingAutoRun = true;
			} else {
				runCellAndDownstream(cell.id);
			}
		}, 1500);

		return () => clearTimeout(autoRunTimer);
	});

	// Deferred rerun: if a run completed while pendingAutoRun was set, run now
	$effect(() => {
		if (cell.status !== 'running' && pendingAutoRun) {
			pendingAutoRun = false;
			runCellAndDownstream(cell.id);
		}
	});

	function requestGuiMode() {
		if (cell.editMode !== 'prql') {
			setEditMode(cell.id, 'gui');
			return;
		}

		const trimmed = cell.code.trim();
		if (!trimmed) {
			setEditMode(cell.id, 'gui');
			return;
		}

		// If the PRQL has `let` bindings, split into separate cells
		const { letBindings, mainPrql } = extractLetBindings(cell.code);
		if (letBindings.length > 0) {
			for (const binding of letBindings) {
				const innerStages = prqlToGuiStages(binding.rawCode);
				insertCellBefore(cell.id, {
					outputName: binding.name,
					code: binding.rawCode,
					guiStages: innerStages ?? [{ type: 'from', table: '' }],
					editMode: innerStages ? 'gui' : 'prql'
				});
			}
			const mainStages = prqlToGuiStages(mainPrql);
			if (mainStages) {
				updateGuiStages(cell.id, mergeParsedWithHiddenStages(cell.guiStages, mainStages));
				setEditMode(cell.id, 'gui');
			} else {
				updateCellCode(cell.id, mainPrql);
				// keep prql mode — main pipeline couldn't be parsed
			}
			return;
		}

		const parsedStages = prqlToGuiStages(cell.code);
		if (parsedStages) {
			updateGuiStages(cell.id, mergeParsedWithHiddenStages(cell.guiStages, parsedStages));
			setEditMode(cell.id, 'gui');
			return;
		}

		confirmSwitchToGui = true;
	}

	function doSwitchToGui() {
		confirmSwitchToGui = false;
		// Reset stages to a blank pipeline and switch mode
		updateGuiStages(cell.id, [{ type: 'from', table: '' }]);
		setEditMode(cell.id, 'gui');
	}

	function switchToPrqlMode() {
		if (!isQueryCell) return;
		setEditMode(cell.id, 'prql');
	}

	function onCellFocusIn() {
		cellFocused = true;
	}

	function onCellFocusOut(e: FocusEvent) {
		const el = e.currentTarget as HTMLElement;
		if (!el.contains(e.relatedTarget as Node)) {
			cellFocused = false;
		}
	}

	function onEditorFocus() {
		if (!isQueryCell) return;
		registerInsertCallback((text) => editorRef?.insertAtCursor(text));
	}

	function isEditModeFocus(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		const tag = (target as HTMLElement).tagName.toLowerCase();
		if (tag === 'input' || tag === 'textarea') return true;
		if ((target as HTMLElement).isContentEditable) return true;
		if (target.closest('.cm-content, .cm-editor')) return true;
		return false;
	}

	function focusAdjacentCell(dir: 'prev' | 'next') {
		const all = Array.from(document.querySelectorAll<HTMLElement>('.notebook-cell[tabindex]'));
		const idx = all.indexOf(cellContainerEl!);
		all[dir === 'prev' ? idx - 1 : idx + 1]?.focus();
	}

	function enterEditMode() {
		if (isQueryCell && cell.editMode === 'prql') {
			editorRef?.focus();
		} else if (isQueryCell && cell.editMode === 'gui') {
			cellContainerEl
				?.querySelector<HTMLElement>('.stage-card[tabindex]')
				?.focus();
		} else {
			cellContainerEl
				?.querySelector<HTMLElement>('textarea, input:not([readonly])')
				?.focus();
		}
	}

	function isNativeInputTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		const tag = target.tagName.toLowerCase();
		return tag === 'input' || tag === 'textarea' || tag === 'select';
	}

	function handleKeydown(e: KeyboardEvent) {
		const inCommandMode = e.target === cellContainerEl;
		const inStageEditor = (e.target instanceof Element) && !!(e.target as Element).closest('.stage-editor');

		// Always: run cell — but never when focus is on a plain input like the cell name field.
		// CodeMirror uses div elements so Shift+Enter still works from the PRQL editor.
		if (isQueryCell && e.key === 'Enter' && (e.shiftKey || e.metaKey || e.ctrlKey) && !isNativeInputTarget(e.target)) {
			e.preventDefault();
			runCell(cell.id);
			return;
		}

		// ⌘⇧L: open lineage tab focused on this cell's model
		if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'l' && !isNativeInputTarget(e.target)) {
			e.preventDefault();
			openLineageTab(cell.outputName);
			return;
		}

		// ⌘⇧T: run dbt tests for this cell
		if (isDbtProject && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 't' && !isNativeInputTarget(e.target)) {
			e.preventDefault();
			void testCell(cell.id);
			testPanelVisible = true;
			testPanelCollapsed = false;
			return;
		}

		// Escape: let GUIEditor handle events from inside the stage editor (stage cards, chip inputs)
		// For everything else (PRQL editor, buttons, cell container) → cell command mode
		if (e.key === 'Escape' && !inCommandMode && !inStageEditor) {
			e.preventDefault();
			cellContainerEl?.focus();
			return;
		}

		// / in a GUI cell: enter stage mode then open the Add Stage menu
		// Works from cell command mode, header buttons, or anywhere outside the stage editor
		if (e.key === '/' && isQueryCell && cell.editMode === 'gui' && !inStageEditor && !isEditModeFocus(e.target)) {
			e.preventDefault();
			enterEditMode();
			tick().then(() => {
				const focused = document.activeElement as HTMLElement | null;
				if (focused?.classList.contains('stage-card')) {
					// Dispatch / on the now-focused stage card — bubbles to AddStageMenu's window listener
					focused.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
				}
			});
			return;
		}

		if (!inCommandMode) return;

		switch (e.key) {
			case 'Enter':
				e.preventDefault();
				enterEditMode();
				break;
			case 'ArrowUp':
			case 'k':
				e.preventDefault();
				focusAdjacentCell('prev');
				break;
			case 'ArrowDown':
			case 'j':
				e.preventDefault();
				focusAdjacentCell('next');
				break;
			case 'a':
				e.preventDefault();
				addCellBefore(cell.id);
				tick().then(() => focusAdjacentCell('prev'));
				break;
			case 'b':
				e.preventDefault();
				addCellAfter(cell.id);
				tick().then(() => focusAdjacentCell('next'));
				break;
			case 'd':
				e.preventDefault();
				if (ddPending) {
					const all = Array.from(document.querySelectorAll<HTMLElement>('.notebook-cell[tabindex]'));
					const idx = all.indexOf(cellContainerEl!);
					removeCell(cell.id);
					ddPending = false;
					tick().then(() => {
						const next = Array.from(document.querySelectorAll<HTMLElement>('.notebook-cell[tabindex]'));
						(next[idx] ?? next[idx - 1] ?? next[0])?.focus();
					});
				} else {
					ddPending = true;
					setTimeout(() => (ddPending = false), 500);
				}
				break;
			case 'K':
				if (e.shiftKey) { e.preventDefault(); moveCell(cell.id, 'up'); }
				break;
			case 'J':
				if (e.shiftKey) { e.preventDefault(); moveCell(cell.id, 'down'); }
				break;
			case 'c':
				e.preventDefault();
				setCellCollapsed(cell.id, !cell.collapsed);
				break;
		}
	}

	function onMaterializeModeChange(mode: string) {
		if (mode === 'view' || mode === 'table' || mode === 'incremental') {
			setCellMaterializeMode(cell.id, mode as CellMaterializationMode);
		}
	}

	function intervalMinutesToCronExpression(minutes: number): string {
		if (minutes > 0 && minutes < 60) return `*/${minutes} * * * *`;
		if (minutes >= 60 && minutes % 60 === 0) return `0 */${minutes / 60} * * *`;
		return `*/${minutes} * * * *`;
	}

	$effect(() => {
		if (!menuOpen) return;

		function onWindowPointerDown(event: PointerEvent) {
			const target = event.target as Node | null;
			if (!target) return;
			if (menuOpen && !kebabAnchorEl?.contains(target) && !menuDropdownEl?.contains(target)) {
				menuOpen = false;
			}
		}

		window.addEventListener('pointerdown', onWindowPointerDown, true);
		return () => window.removeEventListener('pointerdown', onWindowPointerDown, true);
	});

	function addSortSuggestion(column: string, dir: 'asc' | 'desc') {
		if (cell.editMode !== 'gui') return;
		updateGuiStages(cell.id, [...cell.guiStages, { type: 'sort', keys: [{ column, dir }] }]);
	}

	function addFilterSuggestion(column: string) {
		if (cell.editMode !== 'gui') return;
		updateGuiStages(cell.id, [...cell.guiStages, { type: 'filter', conditions: [{ column, op: '==', value: '' }], logic: 'and' }]);
	}

	function escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	const statusColor = $derived<string>(
		cell.status === 'success'
			? 'text-[var(--chart-1)]'
			: cell.status === 'error'
					? 'text-destructive'
					: cell.status === 'running'
						? 'text-[var(--chart-3)]'
						: 'text-muted-foreground'
	);

	const crossNotebookUsageCount = $derived(
		isQueryCell && cell.outputName && notebookId
			? getCrossNotebookUsageCount(cell.outputName, notebookId)
			: 0
	);

	// Combined cell mode: collapses language + editMode into a single concept
	const cellMode = $derived<'prql' | 'visual' | 'sql'>(
		cell.language === 'sql' ? 'sql' : cell.editMode === 'gui' ? 'visual' : 'prql'
	);

	function setCellMode(mode: 'prql' | 'visual' | 'sql') {
		if (mode === 'sql') {
			if (cell.editMode === 'gui') switchToPrqlMode();
			if (cell.language !== 'sql' && cell.code.trim()) {
				const result = compilePRQL(cell.code, cellSqlDialect);
				if (result.errors.length === 0 && result.sql) {
					compiledSqlForSwitch = result.sql;
					confirmSwitchToSql = 'with-code';
				} else {
					confirmSwitchToSql = 'without-code';
				}
			} else {
				setCellLanguage(cell.id, 'sql');
			}
		} else if (mode === 'prql') {
			if (cell.editMode === 'gui') switchToPrqlMode();
			if (cell.language === 'sql' && cell.code.trim()) {
				confirmSwitchToPrql = true;
			} else {
				setCellLanguage(cell.id, 'prql');
			}
		} else {
			if (cell.language === 'sql') setCellLanguage(cell.id, 'prql');
			requestGuiMode();
		}
	}

	function doSwitchToSql(useCompiledCode: boolean) {
		confirmSwitchToSql = false;
		setCellLanguage(cell.id, 'sql');
		if (useCompiledCode && compiledSqlForSwitch) {
			updateCellCode(cell.id, compiledSqlForSwitch);
		}
		compiledSqlForSwitch = '';
	}

	function doSwitchToPrql() {
		confirmSwitchToPrql = false;
		setCellLanguage(cell.id, 'prql');
	}

	// True when any downstream cell in this notebook references this cell's output
	const hasDownstreamRefs = $derived(
		isQueryCell && (runImpact.downstreamCount > 0 || crossNotebookUsageCount > 0)
	);
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
<div
	bind:this={cellContainerEl}
	class="notebook-cell group rounded-lg overflow-hidden text-foreground transition-[border-color,box-shadow,background] duration-200 {isMarkdownPreviewMode ? `border ${cellFocused ? 'border-border/30' : 'border-transparent hover:border-border/20'}` : `border bg-accent/20 dark:bg-accent/30 ${cellFocused || running ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary))]' : 'border-border/70 hover:border-primary/60 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.45)]'}`}"
	tabindex="0"
	onkeydown={handleKeydown}
	onfocusin={onCellFocusIn}
	onfocusout={onCellFocusOut}
	onmouseenter={() => (cellHovered = true)}
	onmouseleave={() => (cellHovered = false)}
	role="region"
	aria-label={`Cell ${index + 1}`}
	aria-busy={running}
>
	<!-- Header bar -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="w-full flex items-center gap-2 px-3 py-1.5 bg-transparent border-b border-border/0 select-none transition-opacity duration-150 {isMarkdownPreviewMode ? 'opacity-0 group-hover:opacity-100' : ''}"
		onpointerdown={(e) => {
			if ((e.target as Element) === e.currentTarget) {
				e.preventDefault();
				cellContainerEl?.focus();
			}
		}}
	>
		<div class="min-w-0 flex flex-1 items-center gap-2">
			<!-- Index — click to enter command mode -->
			<span
				class="text-xs font-mono text-muted-foreground w-5 shrink-0 cursor-default"
				onclick={() => cellContainerEl?.focus()}
				role="presentation"
			>
				{index + 1}
			</span>

			<!-- Output name input -->
			<div class="min-w-0 {collapsed ? 'flex-none' : 'flex-1'} flex items-center gap-1">
				<Tooltip.Root>
					<Tooltip.Trigger>
						<input
							class="h-6 min-w-0 {collapsed ? 'w-auto max-w-48' : 'w-full'} text-xs font-mono bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground/50 p-0"
							placeholder={isQueryCell ? 'result name…' : 'note title…'}
							value={nameInputValue}
							onfocus={() => { nameInputFocused = true; }}
							oninput={(e) => { nameInputValue = (e.target as HTMLInputElement).value; }}
							onblur={() => { nameInputFocused = false; updateCellName(cell.id, nameInputValue); }}
							onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
						/>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{#if isQueryCell}
							<p class="text-xs">Name this cell's output. Reference it from other cells with <code>from {cell.outputName || 'name'}</code>.</p>
							{#if hasDownstreamRefs}
								<p class="text-xs mt-1 text-amber-500">Renaming will break {runImpact.downstreamCount + crossNotebookUsageCount} referencing cell{(runImpact.downstreamCount + crossNotebookUsageCount) === 1 ? '' : 's'}.</p>
							{/if}
						{:else}
							<p class="text-xs">Optional heading for this markdown note.</p>
						{/if}
						{#if isQueryCell && prevCellNames.length > 0}
							<p class="text-xs mt-1 text-muted-foreground">← available: <code>{prevCellNames.join(', ')}</code></p>
						{/if}
					</Tooltip.Content>
				</Tooltip.Root>
				{#if isQueryCell && hasDownstreamRefs}
					<span class="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400 shrink-0 select-none" title="Referenced by {runImpact.downstreamCount + crossNotebookUsageCount} cell(s) — rename carefully">
						↳ {runImpact.downstreamCount + crossNotebookUsageCount}
					</span>
				{/if}
			</div>

			<!-- Collapsed summary: row count + exec time -->
			{#if collapsed && isQueryCell && cell.result && cell.status !== 'idle'}
				<span class="text-[10px] font-mono text-muted-foreground shrink-0">
					{cell.result.rows.length.toLocaleString()} rows
					{#if cell.executionMs != null}
						· {cell.executionMs < 1000 ? `${cell.executionMs.toFixed(0)}ms` : `${(cell.executionMs / 1000).toFixed(2)}s`}
					{/if}
				</span>
			{/if}

			<!-- Collapsed stale indicator -->
			{#if collapsed && isQueryCell && cell.needsRun && cell.status !== 'running'}
				<span class="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 shrink-0">
					<Clock class="h-2.5 w-2.5" />
					stale
				</span>
			{/if}

		</div>

		<!-- Always-visible connection badge when using a non-default connection -->
		{#if isQueryCell && connectionValue !== BUILTIN_DUCKDB_CONNECTION_ID}
			{@const connName = connections.find(c => c.id === connectionValue)?.name ?? 'External'}
			<span class="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground shrink-0 max-w-28 truncate" title={connName}>
				<Database class="h-2.5 w-2.5 shrink-0" />
				<span class="truncate">{connName}</span>
			</span>
		{/if}

		<div class="flex items-center gap-1 transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto" class:opacity-0={!running} class:pointer-events-none={!running}>
			<!-- Connection selector -->
			{#if isQueryCell}
			<Select.Root
				type="single"
				disabled={connections.length === 0}
				value={connectionValue}
				onValueChange={(value) => setCellConnection(cell.id, value === BUILTIN_DUCKDB_CONNECTION_ID ? null : value)}
			>
				<Select.Trigger class="h-6 min-w-32 text-[11px] font-mono">
					{connections.find((connection) => connection.id === connectionValue)?.name ?? 'DuckDB (built-in)'}
				</Select.Trigger>
				<Select.Content>
					{#each connections as connection (connection.id)}
						<Select.Item value={connection.id} class="text-xs font-mono">{connection.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{/if}

			<!-- Cell type selector: PRQL | Visual | SQL -->
			{#if isQueryCell}
				<div class="inline-flex items-center rounded border border-border/60 bg-muted/20 p-0.5">
					<button
						class="h-5 px-1.5 text-[10px] font-mono font-semibold rounded-sm transition-colors {cellMode === 'prql' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
						onclick={() => setCellMode('prql')}
						title="PRQL code mode"
					>PRQL</button>
					<button
						class="h-5 px-1.5 text-[10px] font-mono font-semibold rounded-sm transition-colors {cellMode === 'visual' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
						onclick={() => setCellMode('visual')}
						title="Visual pipeline editor"
					>Visual</button>
					<button
						class="h-5 px-1.5 text-[10px] font-mono font-semibold rounded-sm transition-colors {cellMode === 'sql' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
						onclick={() => setCellMode('sql')}
						title="SQL mode"
					>SQL</button>
				</div>
			{/if}

			<!-- Collapse button -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="ghost"
						size="sm"
						class="h-6 w-6 p-0 text-muted-foreground"
						onclick={() => setCellCollapsed(cell.id, !cell.collapsed)}
						aria-label={collapsed ? 'Expand cell' : 'Collapse cell'}
					>
						<ChevronsUpDown class="w-3.5 h-3.5" />
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content><p class="text-xs">{collapsed ? 'Expand cell' : 'Collapse cell'} (c in command mode)</p></Tooltip.Content>
			</Tooltip.Root>

			<!-- Run / Cancel button -->
			{#if isQueryCell}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						size="sm"
						class="h-6 w-6 p-0"
						disabled={!running && materializing}
						onclick={() => running ? cancelCell(cell.id) : runCell(cell.id)}
						aria-label={running ? 'Cancel run' : 'Run cell'}
					>
						{#if running}
							<X class="w-3 h-3" />
						{:else}
							<Play class="w-3 h-3 fill-current" />
						{/if}
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					<p class="text-xs">{running ? 'Cancel' : runTooltipText}</p>
				</Tooltip.Content>
			</Tooltip.Root>
			{/if}

			<!-- Materialize / schedule button -->
			{#if isQueryCell}
			<Button
				variant="ghost"
				size="sm"
				class="h-6 w-6 p-0"
				title="Materialize and schedule options"
				onclick={() => (materializeDialogOpen = true)}
				aria-label="Materialize and schedule options"
			>
				<Database class="w-3.5 h-3.5" />
			</Button>
			{/if}

			<!-- Kebab menu (includes SQL preview, dbt tests, move, delete) -->
			<div class="relative" bind:this={kebabAnchorEl}>
				<Button
					variant="ghost"
					size="sm"
					class="h-6 w-6 p-0"
					onclick={() => {
						if (!menuOpen) {
							const r = kebabAnchorEl!.getBoundingClientRect();
							menuTop = r.bottom + 4;
							menuRight = window.innerWidth - r.right;
						}
						menuOpen = !menuOpen;
					}}
					aria-label="Cell options"
				>
					<MoreVertical class="w-3.5 h-3.5" />
				</Button>
				{#if menuOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						bind:this={menuDropdownEl}
						style="position: fixed; top: {menuTop}px; right: {menuRight}px; z-index: 200;"
						class="min-w-44 rounded-md border bg-popover shadow-md py-1"
						onmouseleave={() => (menuOpen = false)}
					>
						{#if isQueryCell && cell.compiledSQL}
							<button
								class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent {sqlExpanded ? 'text-primary' : ''}"
								onclick={() => { sqlExpanded = !sqlExpanded; menuOpen = false; }}
							>
								<Code2 class="w-3 h-3 shrink-0" />
								{sqlExpanded ? 'Hide SQL preview' : 'Show SQL preview'}
							</button>
						{/if}

						{#if isQueryCell && isDbtProject}
							<button
								class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent {cell.dbtTestStatus === 'fail' ? 'text-destructive' : cell.dbtTestStatus === 'pass' ? 'text-[--chart-1]' : ''}"
								disabled={cell.dbtTestStatus === 'running'}
								onclick={() => { void testCell(cell.id); testPanelVisible = true; testPanelCollapsed = false; menuOpen = false; }}
							>
								{#if cell.dbtTestStatus === 'running'}
									<Loader2 class="w-3 h-3 animate-spin shrink-0" />
								{:else}
									<FlaskConical class="w-3 h-3 shrink-0" />
								{/if}
								{cell.dbtTestStatus === 'idle' ? 'Run dbt tests' : cell.dbtTestStatus === 'running' ? 'Running tests…' : cell.dbtTestStatus === 'pass' ? `Tests passing (${cell.dbtTestResults.length})` : `Tests failed (${cell.dbtTestResults.filter(r => r.status === 'fail').length})`}
							</button>
						{/if}

						<div class="my-1 border-t"></div>

						<button
							class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
							disabled={isFirst}
							onclick={() => { moveCell(cell.id, 'up'); menuOpen = false; }}
						>
							<span class="flex items-center gap-2"><ChevronUp class="w-3 h-3" /> Move up</span>
							<span class="text-muted-foreground font-mono">⇧K</span>
						</button>
						<button
							class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
							disabled={isLast}
							onclick={() => { moveCell(cell.id, 'down'); menuOpen = false; }}
						>
							<span class="flex items-center gap-2"><ChevronDown class="w-3 h-3" /> Move down</span>
							<span class="text-muted-foreground font-mono">⇧J</span>
						</button>

						<div class="my-1 border-t"></div>
						<button
							class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-xs text-destructive hover:bg-accent"
							onclick={() => { removeCell(cell.id); menuOpen = false; }}
						>
							<span class="flex items-center gap-2"><Trash2 class="w-3 h-3" /> Delete cell</span>
							<span class="text-muted-foreground font-mono">dd</span>
						</button>
					</div>
				{/if}
			</div>

			{#if isQueryCell}
				<MaterializeDialog bind:open={materializeDialogOpen} {cell} {isDbtProject} />
			{/if}
		</div>
	</div>

	<!-- Editor (GUI or PRQL mode) -->
	{#if !collapsed}
		<div class="{isMarkdownPreviewMode ? 'px-3 pb-3 pt-0' : 'p-3'}" onfocusin={onEditorFocus}>
			{#if !isQueryCell}
				<div class="group/markdown relative">
					{#if isMarkdownPreviewMode}
						<!-- Preview mode: seamless {#html}, double-click to edit -->
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="markdown-body cursor-text"
							ondblclick={() => setCellMarkdownPreview(cell.id, false)}
						>
							{@html safeMarkdown}
						</div>
						<button
							class="absolute right-0 top-0 hidden rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground group-hover/markdown:block"
							onclick={() => setCellMarkdownPreview(cell.id, false)}
						>
							Edit
						</button>
					{:else}
						<!-- Edit mode: minimal textarea, blur → preview -->
						<Textarea
							value={cell.markdown}
							placeholder="Write markdown here..."
							class="min-h-24! rounded-none! border-0! bg-transparent! px-0! py-0.5! text-sm! leading-6! shadow-none! ring-0! resize-none! focus-visible:border-transparent! focus-visible:ring-0! focus-visible:outline-none!"
							oninput={(e: Event) => updateCellMarkdown(cell.id, (e.target as HTMLTextAreaElement).value)}
							onblur={() => { if (cell.markdown?.trim()) setCellMarkdownPreview(cell.id, true); }}
						/>
					{/if}
				</div>
			{:else if cell.editMode === 'gui'}
				<GUIEditor
					stages={cell.guiStages}
					tables={guiTables}
					{prevCellSources}
					{dark}
					connectionId={connectionValue}
					{connectionType}
					stageResultsCollapsed={cell.stageResultsCollapsed}
					{stageErrorMap}
					onStagesChange={(stages) => updateGuiStages(cell.id, stages)}
					onRunStage={(upToStageIdx) => runGuiStagePreview(cell.id, upToStageIdx)}
					onStageResultCollapsedChange={(stageIdx, c) => setStageResultCollapsed(cell.id, stageIdx, c)}
					onEscapeEditor={() => cellContainerEl?.focus()}
				/>
			{:else}
				<Editor
					bind:this={editorRef}
					code={cell.code}
					errors={cell.errors}
					completions={editorCompletions}
					language={cell.language}
					sqlDialect={cellSqlDialect}
					{dark}
					onchange={(c) => updateCellCode(cell.id, c)}
				/>
			{/if}
		</div>
	{/if}

	<!-- Confirm: switch PRQL → GUI (will discard manual code) -->
	{#if confirmSwitchToGui}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div class="bg-card border rounded-lg shadow-xl p-5 max-w-sm w-full mx-4 space-y-3">
				<p class="font-semibold text-sm">Switch to GUI mode?</p>
				<p class="text-xs text-muted-foreground">
					This PRQL cannot be parsed into GUI stages. Switching now will discard it and replace it
					with a blank pipeline.
					This cannot be undone.
				</p>
				<div class="flex justify-end gap-2">
					<Button variant="outline" size="sm" onclick={() => (confirmSwitchToGui = false)}>Cancel</Button>
					<Button size="sm" onclick={doSwitchToGui}>Switch to GUI</Button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Confirm: switch PRQL → SQL -->
	{#if confirmSwitchToSql}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div class="bg-card border rounded-lg shadow-xl p-5 max-w-sm w-full mx-4 space-y-3">
				{#if confirmSwitchToSql === 'with-code'}
					<p class="font-semibold text-sm">Convert PRQL to SQL?</p>
					<p class="text-xs text-muted-foreground">
						PRQL compiled successfully. Use the generated SQL as this cell's code, or switch to SQL mode keeping the current code as-is.
					</p>
					<div class="flex justify-end gap-2">
						<Button variant="outline" size="sm" onclick={() => (confirmSwitchToSql = false)}>Cancel</Button>
						<Button variant="outline" size="sm" onclick={() => doSwitchToSql(false)}>Keep PRQL code</Button>
						<Button size="sm" onclick={() => doSwitchToSql(true)}>Use compiled SQL</Button>
					</div>
				{:else}
					<p class="font-semibold text-sm">Switch to SQL?</p>
					<p class="text-xs text-muted-foreground">
						This PRQL couldn't be compiled — it may use features that don't translate directly. Switch to SQL anyway? The code will be kept as-is.
					</p>
					<div class="flex justify-end gap-2">
						<Button variant="outline" size="sm" onclick={() => (confirmSwitchToSql = false)}>Cancel</Button>
						<Button size="sm" onclick={() => doSwitchToSql(false)}>Switch to SQL</Button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Confirm: switch SQL → PRQL -->
	{#if confirmSwitchToPrql}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div class="bg-card border rounded-lg shadow-xl p-5 max-w-sm w-full mx-4 space-y-3">
				<p class="font-semibold text-sm">Switch to PRQL?</p>
				<p class="text-xs text-muted-foreground">
					SQL cannot be automatically converted to PRQL. The existing code will be kept as-is and may have syntax errors in PRQL mode.
				</p>
				<div class="flex justify-end gap-2">
					<Button variant="outline" size="sm" onclick={() => (confirmSwitchToPrql = false)}>Cancel</Button>
					<Button size="sm" onclick={doSwitchToPrql}>Switch to PRQL</Button>
				</div>
			</div>
		</div>
	{/if}

	<!-- SQL preview -->
	{#if !collapsed && sqlExpanded && cell.compiledSQL}
		<div class="px-3 pb-3">
			<div class="rounded-md bg-muted/50 border p-3">
				<p class="text-xs text-muted-foreground mb-1.5 font-medium">Generated SQL</p>
				<pre class="text-xs font-mono overflow-x-auto whitespace-pre-wrap text-foreground/80">{cell.compiledSQL}</pre>
			</div>
		</div>
	{/if}

	<!-- Errors -->
	{#if !collapsed && cell.errors.length > 0}
		<div class="px-3 pb-3 space-y-2">
			{#each cell.errors as error (error.display ?? error.reason)}
				<Alert variant="destructive" class="py-2">
					<AlertDescription class="font-mono text-xs whitespace-pre-wrap">
						{error.display ?? error.reason}
					</AlertDescription>
				</Alert>
			{/each}
		</div>
	{/if}

	{#if !collapsed && cell.materializeError}
		<div class="px-3 pb-3">
			<Alert variant="destructive" class="py-2">
				<AlertDescription class="font-mono text-xs whitespace-pre-wrap">
					{cell.materializeError}
				</AlertDescription>
			</Alert>
		</div>
	{/if}

	<!-- Test panel -->
	{#if !collapsed && isDbtProject && testPanelVisible && cell.dbtTestStatus !== 'idle'}
		<div class="border-t border-border/40 bg-muted/20">
			<div class="flex items-center gap-2 px-3 py-1.5">
				<FlaskConical class="w-3 h-3 shrink-0 {cell.dbtTestStatus === 'pass' ? 'text-[--chart-1]' : cell.dbtTestStatus === 'fail' ? 'text-destructive' : 'text-muted-foreground'}" />
				<span class="text-[11px] font-medium">Tests</span>
				{#if cell.dbtTestStatus !== 'running'}
					<span class="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium {cell.dbtTestStatus === 'pass' ? 'border-[--chart-1]/30 bg-[--chart-1]/10 text-[--chart-1]' : 'border-destructive/30 bg-destructive/10 text-destructive'}">
						{#if cell.dbtTestStatus === 'pass'}{cell.dbtTestResults.length} passing
						{:else}{cell.dbtTestResults.filter(r => r.status === 'fail').length} failed{/if}
					</span>
				{/if}
				<div class="ml-auto flex items-center gap-1">
					<button class="text-muted-foreground hover:text-foreground" onclick={() => (testPanelCollapsed = !testPanelCollapsed)}>
						<ChevronRight class="w-3 h-3 transition-transform {testPanelCollapsed ? '' : 'rotate-90'}" />
					</button>
					<button class="text-muted-foreground hover:text-foreground" onclick={() => (testPanelVisible = false)}>
						<X class="w-3 h-3" />
					</button>
				</div>
			</div>
			{#if !testPanelCollapsed}
				{#if cell.dbtTestStatus === 'running'}
					<div class="px-3 pb-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
						<Loader2 class="w-3 h-3 animate-spin" /> Running tests…
					</div>
				{:else if cell.dbtTestResults.length === 0}
					<p class="px-3 pb-2 text-[11px] text-muted-foreground italic">No tests found for this model. Add tests to _models.yml.</p>
				{:else}
					<div class="px-3 pb-2 flex flex-col gap-0.5">
						{#each cell.dbtTestResults as result (result.testName)}
							<div class="flex items-center gap-2 text-[11px]">
								{#if result.status === 'pass'}
									<CheckCircle2 class="w-3 h-3 shrink-0 text-[--chart-1]" />
								{:else}
									<XCircle class="w-3 h-3 shrink-0 text-destructive" />
								{/if}
								<span class="font-mono">{result.testName}</span>
								{#if result.column}
									<span class="text-muted-foreground">({result.column})</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Results -->
	{#if showResult && cell.result && cell.result.rows.length >= 0}
		<div class="relative px-3 pb-3 transition-opacity duration-200 {running ? 'opacity-80' : 'opacity-100'}">
			{#if running}
				<div class="pointer-events-none absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/90 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-[2px]">
					<Loader2 class="w-3 h-3 animate-spin" />
					<span>Updating</span>
				</div>
			{/if}
			{#if cell.result.rows.length === 0}
				<p class="text-xs text-muted-foreground italic">Query returned 0 rows.</p>
			{:else}
				<InlineResultView
					rows={cell.result.rows}
					columns={cell.result.columns}
					name={cell.outputName || `result${index + 1}`}
					initialViewMode={cell.resultViewMode}
					initialChartConfig={cell.resultChartConfig}
					controlsVisible={showResultControls}
					executionMs={cell.executionMs}
					onViewModeChange={(mode) => setCellResultViewMode(cell.id, mode)}
					onChartConfigChange={(config) => setCellResultChartConfig(cell.id, config)}
					onAddSort={cell.editMode === 'gui' ? addSortSuggestion : undefined}
					onAddFilter={cell.editMode === 'gui' ? addFilterSuggestion : undefined}
					columnDescriptions={isDbtProject ? columnDescriptions : undefined}
					onColumnDescriptionChange={isDbtProject ? handleColumnDescriptionChange : undefined}
				>
					{#snippet toolbarActions()}
						{#if onOpenResultTab}
							<div
								class="flex items-center gap-1 transition-opacity duration-150 ease-(--motion-ease-out) {showResultControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}"
								aria-hidden={!showResultControls}
							>
								<Tooltip.Root>
									<Tooltip.Trigger>
										<Button
											variant="ghost" size="sm" class="h-6 w-6 p-0"
											onclick={() => onOpenResultTab!(cell.id, notebookId, cell.outputName || `result${index + 1}`, 'table')}
										><ExternalLink class="w-3 h-3" /></Button>
									</Tooltip.Trigger>
									<Tooltip.Content><p class="text-xs">Open table in full tab</p></Tooltip.Content>
								</Tooltip.Root>
								<Tooltip.Root>
									<Tooltip.Trigger>
										<Button
											variant="ghost" size="sm" class="h-6 w-6 p-0"
											onclick={() => onOpenResultTab!(cell.id, notebookId, cell.outputName || `result${index + 1}`, 'chart')}
										><BarChart3 class="w-3 h-3" /></Button>
									</Tooltip.Trigger>
									<Tooltip.Content><p class="text-xs">Open chart in full tab</p></Tooltip.Content>
								</Tooltip.Root>
								<Tooltip.Root>
									<Tooltip.Trigger>
										<Button
											variant="ghost" size="sm" class="h-6 w-6 p-0"
											onclick={() => onOpenResultTab!(cell.id, notebookId, cell.outputName || `result${index + 1}`, 'stats')}
										><Sigma class="w-3 h-3" /></Button>
									</Tooltip.Trigger>
									<Tooltip.Content><p class="text-xs">Open stats in full tab</p></Tooltip.Content>
								</Tooltip.Root>
							</div>
						{/if}
					{/snippet}
				</InlineResultView>
			{/if}

			<!-- Persistent "open full" affordance when result is large -->
			{#if onOpenResultTab && cell.result && cell.result.rows.length > 50}
				<div class="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground/60">
					<span>Showing preview · {cell.result.rows.length.toLocaleString()} rows total</span>
					<button
						class="hover:text-foreground transition-colors underline underline-offset-2"
						onclick={() => onOpenResultTab!(cell.id, notebookId, cell.outputName || `result${index + 1}`, 'table')}
					>
						Open full results →
					</button>
				</div>
			{/if}
		</div>
	{/if}

	{#if isQueryCell && (cell.needsRun || crossNotebookUsageCount > 0 || intelligenceSummary || (showResult && cell.result) || cell.scheduleEnabled || cell.status !== 'idle' || cell.materializeStatus !== 'idle' || cell.scheduleStatus !== 'idle')}
		<div class="flex flex-wrap items-center gap-2 border-t border-border/40 px-3 py-1">
			<div class="flex items-center gap-1 {statusColor}">
				{#if cell.status === 'running'}
					<Loader2 class="w-3.5 h-3.5 animate-spin" />
				{:else if cell.status === 'success'}
					<CheckCircle2 class="w-3.5 h-3.5" />
				{:else if cell.status === 'error'}
					<XCircle class="w-3.5 h-3.5" />
				{/if}
			</div>

			{#if cell.needsRun && cell.status !== 'running'}
				<div class="inline-flex items-center gap-1">
					<Tooltip.Root>
						<Tooltip.Trigger>
							<span class="inline-flex items-center gap-1 rounded-l border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
								<Clock class="h-2.5 w-2.5" />
								{#if cell.staleReason === 'code-changed'}code changed{:else}upstream changed{/if}
							</span>
						</Tooltip.Trigger>
						<Tooltip.Content>
							<p class="text-xs">
								{#if cell.staleReason === 'code-changed'}
									Code changed — rerun to see updated results
								{:else if cell.staleSources.length > 0}
									{cell.staleSources.slice(0, 3).join(', ')}{cell.staleSources.length > 3 ? ` +${cell.staleSources.length - 3} more` : ''} changed — rerun to see updated results
								{:else}
									An upstream cell changed — rerun to see updated results
								{/if}
							</p>
						</Tooltip.Content>
					</Tooltip.Root>
					<button
						class="inline-flex items-center gap-0.5 rounded-r border border-l-0 border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 hover:bg-amber-500/20 dark:text-amber-400 transition-colors"
						onclick={() => runCell(cell.id)}
						aria-label="Re-run stale cell"
					>
						<Play class="h-2 w-2 fill-current" />
						Re-run
					</button>
				</div>
			{/if}

			{#if crossNotebookUsageCount > 0}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<span class="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
							<ExternalLink class="h-2.5 w-2.5" />
							used by {crossNotebookUsageCount} cell{crossNotebookUsageCount === 1 ? '' : 's'} across notebooks
						</span>
					</Tooltip.Trigger>
					<Tooltip.Content>
						<p class="text-xs">
							This output is referenced by {crossNotebookUsageCount} cell{crossNotebookUsageCount === 1 ? '' : 's'} in other notebooks
						</p>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}

			{#if cell.materializeStatus === 'running'}
				<span class="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
					<Loader2 class="h-2.5 w-2.5 animate-spin" />
					materializing ({cell.materializeMode})
				</span>
			{:else if cell.materializeStatus === 'success'}
				<span class="inline-flex items-center gap-1 rounded border border-chart-1/40 bg-chart-1/10 px-1.5 py-0.5 text-[10px] font-medium text-chart-1">
					<CheckCircle2 class="h-2.5 w-2.5" />
					materialized {cell.materializedRelationType ?? 'relation'}
				</span>
			{:else if cell.materializeStatus === 'error'}
				<span class="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
					<XCircle class="h-2.5 w-2.5" />
					materialize failed
				</span>
			{/if}

			{#if cell.scheduleEnabled}
				<span class="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
					<Database class="h-2.5 w-2.5" />
					every {cell.scheduleIntervalMinutes}m ({cell.scheduleScope === 'segment' ? 'segment' : 'cell'})
				</span>
			{/if}

			{#if cell.scheduleStatus === 'running'}
				<span class="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
					<Loader2 class="h-2.5 w-2.5 animate-spin" />
					schedule running
				</span>
			{:else if cell.scheduleStatus === 'error'}
				<span class="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
					<XCircle class="h-2.5 w-2.5" />
					schedule failed
				</span>
			{/if}

			{#if cell.scheduleEnabled}
				<span class="text-[10px] font-mono text-muted-foreground">{intervalMinutesToCronExpression(cell.scheduleIntervalMinutes)}</span>
			{/if}

			{#if intelligenceSummary}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<span class="inline-flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
							<Database class="h-2.5 w-2.5" />
							insights
						</span>
					</Tooltip.Trigger>
					<Tooltip.Content>
						<div class="max-w-64 space-y-1 text-xs">
							<p>Connection: {intelligenceSummary.connectionId}</p>
							<p>{intelligenceSummary.rowCount.toLocaleString()} rows, {intelligenceSummary.columnCount} columns</p>
							{#if intelligenceSummary.nextAnalysis}
								<p>Next: {intelligenceSummary.nextAnalysis}</p>
							{/if}
							<p>{intelligenceSummary.perfWarnings} performance warning{intelligenceSummary.perfWarnings === 1 ? '' : 's'}, {intelligenceSummary.qualityWarnings} quality warning{intelligenceSummary.qualityWarnings === 1 ? '' : 's'}</p>
							<p>{intelligenceSummary.joinCount} join suggestion{intelligenceSummary.joinCount === 1 ? '' : 's'}, {intelligenceSummary.schemaMatchCount} schema match{intelligenceSummary.schemaMatchCount === 1 ? '' : 'es'}</p>
						</div>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}

			{#if showResult && cell.result}
				<span class="text-xs text-muted-foreground font-mono">
					{cell.result.rows.length.toLocaleString()} rows · {cell.result.columns.length} cols
					{#if running}
						· updating...
					{:else if cell.executionMs != null}
						· {cell.executionMs < 1000
							? `${cell.executionMs.toFixed(0)}ms`
							: `${(cell.executionMs / 1000).toFixed(2)}s`}
					{/if}
				</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.markdown-body {
		font-size: 0.875rem;
		line-height: 1.7;
	}
	.markdown-body :global(h1) { font-size: 1.3rem; font-weight: 700; margin: 0 0 0.6rem; line-height: 1.3; }
	.markdown-body :global(h2) { font-size: 1.1rem; font-weight: 600; margin: 0.75rem 0 0.4rem; line-height: 1.35; }
	.markdown-body :global(h3),
	.markdown-body :global(h4),
	.markdown-body :global(h5),
	.markdown-body :global(h6) { font-size: 0.9rem; font-weight: 600; margin: 0.6rem 0 0.3rem; }
	.markdown-body :global(p) { margin: 0 0 0.5rem; }
	.markdown-body :global(*:last-child) { margin-bottom: 0; }
	.markdown-body :global(ul),
	.markdown-body :global(ol) { padding-left: 1.25rem; margin: 0 0 0.5rem; }
	.markdown-body :global(li) { margin-bottom: 0.125rem; }
	.markdown-body :global(pre) {
		background: color-mix(in oklch, currentColor 6%, transparent);
		border-radius: 0.3rem;
		padding: 0.5rem 0.75rem;
		margin: 0 0 0.5rem;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.markdown-body :global(code) {
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.85em;
		background: color-mix(in oklch, currentColor 8%, transparent);
		border-radius: 0.2rem;
		padding: 0.1em 0.3em;
	}
	.markdown-body :global(pre code) { background: none; padding: 0; }
	.markdown-body :global(blockquote) {
		border-left: 2px solid color-mix(in oklch, currentColor 30%, transparent);
		margin: 0 0 0.5rem;
		padding-left: 0.75rem;
		opacity: 0.8;
	}
	.markdown-body :global(hr) {
		border: none;
		border-top: 1px solid color-mix(in oklch, currentColor 15%, transparent);
		margin: 0.75rem 0;
	}
	.markdown-body :global(a) { text-decoration: underline; text-underline-offset: 2px; }
	.markdown-body :global(img) { max-width: 100%; border-radius: 0.25rem; }
	.markdown-body :global(table) { width: 100%; border-collapse: collapse; font-size: 0.85em; margin: 0 0 0.5rem; }
	.markdown-body :global(th),
	.markdown-body :global(td) { padding: 0.3rem 0.6rem; border: 1px solid color-mix(in oklch, currentColor 15%, transparent); text-align: left; }
	.markdown-body :global(th) { font-weight: 600; background: color-mix(in oklch, currentColor 4%, transparent); }
</style>
