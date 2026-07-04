<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import {
		GripVertical,
		Code2,
		Eye,
		EyeOff,
		FlaskConical,
		Link,
		Loader2,
		Database,
		ArrowUpToLine,
		Plug,
		ChevronUp,
		ChevronDown,
		Copy,
		ClipboardPaste,
		CopyPlus,
		Trash2,
		FileSpreadsheet,
		Sparkles,
		BrainCircuit,
		ArrowUp,
		ArrowDown,
		Eraser,
		Maximize2,
		ChevronsDownUp,
		ChevronsUpDown
	} from '@lucide/svelte';
	import {
		moveCell,
		removeCell,
		setCellConnection,
		setCellDisplay,
		setCellHideResult,
		setCellHideInReport,
		clearCellResult,
		runCellsAbove,
		runCellsBelow,
		isCellPromotable,
		duplicateCell,
		copyCellToClipboard,
		pasteCellAfter,
		hasClipboardCell,
		type Cell,
		type CellDisplay
	} from '$lib/stores/notebook.svelte';
	import { BUILTIN_DUCKDB_CONNECTION_ID, type Connection } from '$lib/types/connection';

	let {
		cell,
		notebookId = '',
		isQueryCell,
		isPythonCell = false,
		isFirst,
		isLast,
		isDbtProject,
		connections,
		connectionValue,
		sqlExpanded = $bindable(false),
		open = $bindable(false),
		onOpenMaterialize,
		onOpenPromote,
		onOpenPromoteSeed,
		onRunTests,
		onOpenInlinePrompt,
		onOpenWorksheet,
		onShareWithAI,
		isPlotCell = false,
		dragHandle = true,
		onDisplayChange
	}: {
		cell: Cell;
		notebookId?: string;
		isQueryCell: boolean;
		isPythonCell?: boolean;
		isFirst: boolean;
		isLast: boolean;
		isDbtProject: boolean;
		connections: Connection[];
		connectionValue: string;
		sqlExpanded?: boolean;
		open?: boolean;
		onOpenMaterialize: () => void;
		onOpenPromote?: () => void;
		onOpenPromoteSeed?: () => void;
		onRunTests: () => void;
		onOpenInlinePrompt?: () => void;
		onOpenWorksheet?: () => void;
		onShareWithAI?: () => void;
		isPlotCell?: boolean;
		/** When true (classic notebook), the trigger doubles as the SortableJS drag
		 * handle. Disable inside the visual document editor, where dragging is owned
		 * by the ProseMirror drag gutter and a second handle conflicts. */
		dragHandle?: boolean;
		/** Optional hook for inline query blocks (syncs PM attrs like pin state). */
		onDisplayChange?: (display: CellDisplay) => void;
	} = $props();

	function setDisplay(display: CellDisplay) {
		if (onDisplayChange) onDisplayChange(display);
		else setCellDisplay(cell.id, display);
	}

	const codeHidden = $derived(cell.display === 'output');
	const hasOutput = $derived(Boolean(cell.result || cell.pythonOutput));
	const promotable = $derived(onOpenPromote !== undefined && isCellPromotable(cell.id));
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger
		data-drag-handle={dragHandle ? '' : undefined}
		class="flex h-6 w-5 items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 {dragHandle
			? 'cursor-grab active:cursor-grabbing'
			: 'cursor-pointer'}"
		aria-label={dragHandle ? 'Cell actions — drag to reorder' : 'Cell actions'}
		title={dragHandle ? 'Click for actions, drag to reorder' : 'Cell actions'}
	>
		<GripVertical class="h-3.5 w-3.5" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content side="bottom" align="start" class="min-w-48">
		{#if onOpenInlinePrompt}
			<DropdownMenu.Item onclick={onOpenInlinePrompt}>
				<Sparkles class="h-3.5 w-3.5" /> Tell AI what to do
				<DropdownMenu.Shortcut>⌘⇧K</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
		{/if}
		{#if onShareWithAI}
			<DropdownMenu.Item onclick={onShareWithAI}>
				<BrainCircuit class="h-3.5 w-3.5" /> Share with AI
			</DropdownMenu.Item>
		{/if}
		{#if onOpenInlinePrompt || onShareWithAI}
			<DropdownMenu.Separator />
		{/if}
		{#if onOpenWorksheet && (isQueryCell || isPythonCell || isPlotCell)}
			<DropdownMenu.Item onclick={onOpenWorksheet}>
				<Maximize2 class="h-3.5 w-3.5" /> Worksheet view
				<DropdownMenu.Shortcut>⌘E</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
		{/if}
		{#if isQueryCell}
			{#if cell.display === 'collapsed'}
				<DropdownMenu.Item onclick={() => setDisplay('full')}>
					<ChevronsUpDown class="h-3.5 w-3.5" /> Expand cell
				</DropdownMenu.Item>
			{:else}
				<DropdownMenu.Item onclick={() => setDisplay('collapsed')}>
					<ChevronsDownUp class="h-3.5 w-3.5" /> Collapse cell
				</DropdownMenu.Item>
			{/if}
			{#if cell.display !== 'collapsed'}
				<DropdownMenu.Item onclick={() => setDisplay(codeHidden ? 'full' : 'output')}>
					{#if codeHidden}
						<Eye class="h-3.5 w-3.5" /> Show code
					{:else}
						<EyeOff class="h-3.5 w-3.5" /> Hide code
					{/if}
				</DropdownMenu.Item>
			{/if}
			{#if cell.compiledSQL}
				<DropdownMenu.Item onclick={() => (sqlExpanded = !sqlExpanded)}>
					<Code2 class="h-3.5 w-3.5" />
					{sqlExpanded ? 'Hide compiled SQL' : 'Show compiled SQL'}
				</DropdownMenu.Item>
			{/if}
			{#if isDbtProject}
				<DropdownMenu.Item disabled={cell.dbtTestStatus === 'running'} onclick={onRunTests}>
					{#if cell.dbtTestStatus === 'running'}
						<Loader2 class="h-3.5 w-3.5 animate-spin" /> Running tests…
					{:else}
						<FlaskConical class="h-3.5 w-3.5" /> Run dbt tests
					{/if}
				</DropdownMenu.Item>
			{/if}
			{#if connections.length > 0}
				<DropdownMenu.Sub>
					<DropdownMenu.SubTrigger>
						<Plug class="h-3.5 w-3.5" /> Connection
					</DropdownMenu.SubTrigger>
					<DropdownMenu.SubContent>
						<DropdownMenu.RadioGroup
							value={connectionValue}
							onValueChange={(value) =>
								setCellConnection(cell.id, value === BUILTIN_DUCKDB_CONNECTION_ID ? null : value)}
						>
							{#each connections as connection (connection.id)}
								<DropdownMenu.RadioItem value={connection.id} class="font-mono text-xs">
									{connection.name}
								</DropdownMenu.RadioItem>
							{/each}
						</DropdownMenu.RadioGroup>
					</DropdownMenu.SubContent>
				</DropdownMenu.Sub>
			{/if}
		{/if}
		{#if isQueryCell || isPythonCell}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onclick={() => void runCellsAbove(cell.id)}>
				<ArrowUp class="h-3.5 w-3.5" /> Run above
				<DropdownMenu.Shortcut>⌥⇧↑</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			<DropdownMenu.Item onclick={() => void runCellsBelow(cell.id)}>
				<ArrowDown class="h-3.5 w-3.5" /> Run below
				<DropdownMenu.Shortcut>⌥⇧↓</DropdownMenu.Shortcut>
			</DropdownMenu.Item>
			{#if hasOutput}
				<DropdownMenu.Item onclick={() => clearCellResult(cell.id)}>
					<Eraser class="h-3.5 w-3.5" /> Clear output
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => setCellHideResult(cell.id, !cell.hideResult)}>
					{#if cell.hideResult}
						<Eye class="h-3.5 w-3.5" /> Show output
					{:else}
						<EyeOff class="h-3.5 w-3.5" /> Hide output
					{/if}
				</DropdownMenu.Item>
			{/if}
		{/if}
		{#if isQueryCell || isPythonCell}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onclick={onOpenMaterialize}>
				<Database class="h-3.5 w-3.5" /> Materialize & schedule…
			</DropdownMenu.Item>
			{#if promotable}
				<DropdownMenu.Item onclick={onOpenPromote}>
					<ArrowUpToLine class="h-3.5 w-3.5" /> Promote to dbt model…
				</DropdownMenu.Item>
			{/if}
			{#if isPythonCell && onOpenPromoteSeed}
				<DropdownMenu.Item onclick={onOpenPromoteSeed}>
					<FileSpreadsheet class="h-3.5 w-3.5" /> Promote to dbt seed…
				</DropdownMenu.Item>
			{/if}
			<DropdownMenu.Separator />
		{/if}
		<DropdownMenu.Item onclick={() => setCellHideInReport(cell.id, !cell.hideInReport)}>
			{#if cell.hideInReport}
				<Eye class="h-3.5 w-3.5" /> Show in report view
			{:else}
				<EyeOff class="h-3.5 w-3.5" /> Hide from report view
			{/if}
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item disabled={isFirst} onclick={() => moveCell(cell.id, 'up')}>
			<ChevronUp class="h-3.5 w-3.5" /> Move up
			<DropdownMenu.Shortcut>⇧K</DropdownMenu.Shortcut>
		</DropdownMenu.Item>
		<DropdownMenu.Item disabled={isLast} onclick={() => moveCell(cell.id, 'down')}>
			<ChevronDown class="h-3.5 w-3.5" /> Move down
			<DropdownMenu.Shortcut>⇧J</DropdownMenu.Shortcut>
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item onclick={() => duplicateCell(cell.id)}>
			<CopyPlus class="h-3.5 w-3.5" /> Duplicate cell
			<DropdownMenu.Shortcut>⇧⌘D</DropdownMenu.Shortcut>
		</DropdownMenu.Item>
		<DropdownMenu.Item onclick={() => copyCellToClipboard(cell.id)}>
			<Copy class="h-3.5 w-3.5" /> Copy cell
			<DropdownMenu.Shortcut>⌘C</DropdownMenu.Shortcut>
		</DropdownMenu.Item>
		<DropdownMenu.Item disabled={!hasClipboardCell()} onclick={() => void pasteCellAfter(cell.id)}>
			<ClipboardPaste class="h-3.5 w-3.5" /> Paste cell after
			<DropdownMenu.Shortcut>⌘V</DropdownMenu.Shortcut>
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		{#if notebookId}
			<DropdownMenu.Item
				onclick={() => void navigator.clipboard.writeText(`${notebookId}#${cell.id}`)}
			>
				<Link class="h-3.5 w-3.5" /> Copy cell link
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
		{/if}
		<DropdownMenu.Item variant="destructive" onclick={() => removeCell(cell.id)}>
			<Trash2 class="h-3.5 w-3.5" /> Delete cell
			<DropdownMenu.Shortcut>dd</DropdownMenu.Shortcut>
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
