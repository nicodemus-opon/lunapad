<script lang="ts">
	import { untrack } from 'svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as Popover from '$lib/components/ui/popover';
	import { Clock, ChevronsUpDown, XCircle, Eye, EyeOff } from '@lucide/svelte';
	import { updateCellName, setCellDisplay, type Cell } from '$lib/stores/notebook.svelte';

	let {
		cell,
		isQueryCell,
		collapsed,
		codeHidden,
		revealed,
		hidden = false,
		prevCellNames,
		downstreamCount,
		crossNotebookUsageCount,
		cellMode,
		onModeChange,
		onOverlayChange
	}: {
		cell: Cell;
		isQueryCell: boolean;
		collapsed: boolean;
		codeHidden: boolean;
		revealed: boolean;
		/** Markdown preview mode hides the header until the cell is hovered/focused. */
		hidden?: boolean;
		prevCellNames: string[];
		downstreamCount: number;
		crossNotebookUsageCount: number;
		cellMode: 'prql' | 'visual' | 'sql';
		onModeChange: (mode: 'prql' | 'visual' | 'sql') => void;
		onOverlayChange?: (open: boolean) => void;
	} = $props();

	let nameInputValue = $state(untrack(() => cell.outputName));
	let nameInputFocused = $state(false);
	// Keep nameInputValue in sync with external changes (e.g. file watcher
	// reload) but only when the user isn't actively editing it.
	$effect(() => {
		if (!nameInputFocused) nameInputValue = cell.outputName;
	});

	const downstreamTotal = $derived(downstreamCount + crossNotebookUsageCount);
	const errorCount = $derived(cell.errors.length + (cell.materializeError ? 1 : 0));

	function fmtMs(ms: number): string {
		return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
	}

	// The collapsed summary row expands on click anywhere that isn't an
	// interactive control.
	function onRowClick(e: MouseEvent) {
		if (!collapsed) return;
		const target = e.target as Element;
		if (target.closest('input, button, [role="combobox"], a')) return;
		setCellDisplay(cell.id, 'full');
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
	class="flex h-7 w-full items-center gap-2 transition-opacity duration-150 select-none {hidden
		? revealed
			? 'opacity-100'
			: 'opacity-0'
		: ''} {collapsed ? 'cursor-pointer' : ''}"
	onclick={onRowClick}
>
	<div class="flex min-w-0 flex-1 items-center gap-1.5">
		<Tooltip.Root>
			<Tooltip.Trigger class="min-w-0 {collapsed ? 'flex-none' : 'flex-1'}">
				<input
					class="h-6 min-w-0 {collapsed
						? 'w-auto max-w-48'
						: 'w-full'} border-0 bg-transparent p-0 font-mono text-[13px] font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
					placeholder={isQueryCell ? 'model name…' : 'note title…'}
					value={nameInputValue}
					onfocus={() => {
						nameInputFocused = true;
					}}
					oninput={(e) => {
						nameInputValue = (e.target as HTMLInputElement).value;
					}}
					onblur={() => {
						nameInputFocused = false;
						updateCellName(cell.id, nameInputValue);
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							(e.target as HTMLInputElement).blur();
						}
					}}
				/>
			</Tooltip.Trigger>
			<Tooltip.Content>
				{#if isQueryCell}
					<p class="text-xs">
						Name this cell's output. Reference it from other cells with <code
							>from {cell.outputName || 'name'}</code
						>.
					</p>
				{:else}
					<p class="text-xs">Optional heading for this markdown note.</p>
				{/if}
				{#if isQueryCell && prevCellNames.length > 0}
					<p class="mt-1 text-xs text-muted-foreground">
						← available: <code>{prevCellNames.join(', ')}</code>
					</p>
				{/if}
			</Tooltip.Content>
		</Tooltip.Root>

		{#if isQueryCell && downstreamTotal > 0}
			<Popover.Root onOpenChange={onOverlayChange}>
				<Popover.Trigger
					class="inline-flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-2xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					aria-label="Show referencing cells"
				>
					↳ {downstreamTotal}
				</Popover.Trigger>
				<Popover.Content class="w-auto max-w-72 space-y-1 p-3 text-xs">
					{#if downstreamCount > 0}
						<p>
							{downstreamCount} cell{downstreamCount === 1 ? '' : 's'} in this notebook reference{downstreamCount ===
							1
								? 's'
								: ''} <code class="font-mono">{cell.outputName}</code>.
						</p>
					{/if}
					{#if crossNotebookUsageCount > 0}
						<p>
							{crossNotebookUsageCount} cell{crossNotebookUsageCount === 1 ? '' : 's'} in other notebooks
							reference{crossNotebookUsageCount === 1 ? 's' : ''} it.
						</p>
					{/if}
					<p class="text-muted-foreground">Renaming this output will break those references.</p>
				</Popover.Content>
			</Popover.Root>
		{/if}

		<!-- Collapsed summary: rows · time, stale chip, error chip -->
		{#if collapsed && isQueryCell}
			{#if cell.result && cell.status !== 'idle'}
				<span class="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
					{cell.result.rows.length.toLocaleString()} rows{cell.executionMs != null
						? ` · ${fmtMs(cell.executionMs)}`
						: ''}
				</span>
			{/if}
			{#if cell.needsRun && cell.status !== 'running'}
				<span
					class="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-warning/50 bg-warning/10 px-1.5 text-2xs font-medium text-warning"
				>
					<Clock class="h-2.5 w-2.5" />
					stale
				</span>
			{/if}
			{#if errorCount > 0}
				<Popover.Root onOpenChange={onOverlayChange}>
					<Popover.Trigger
						class="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 text-2xs font-medium text-destructive transition-colors outline-none hover:bg-destructive/20 focus-visible:ring-2 focus-visible:ring-ring/50"
						aria-label="Show errors"
					>
						<XCircle class="h-2.5 w-2.5" />
						{errorCount === 1 ? 'error' : `${errorCount} errors`}
					</Popover.Trigger>
					<Popover.Content class="w-auto max-w-96 space-y-2 p-3">
						{#each cell.errors as error (error.display ?? error.reason)}
							<pre class="font-mono text-xs whitespace-pre-wrap text-destructive">{error.display ??
									error.reason}</pre>
						{/each}
						{#if cell.materializeError}
							<pre
								class="font-mono text-xs whitespace-pre-wrap text-destructive">{cell.materializeError}</pre>
						{/if}
					</Popover.Content>
				</Popover.Root>
			{/if}
		{/if}
	</div>

	<div
		class="flex shrink-0 items-center gap-1 transition-opacity duration-150 {revealed
			? 'opacity-100'
			: 'pointer-events-none opacity-0'}"
	>
		{#if isQueryCell && !collapsed}
			{#if codeHidden}
				<button
					class="inline-flex h-5 items-center gap-1 rounded px-1.5 text-2xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					title="Show code (⇧C in command mode)"
					onclick={() => setCellDisplay(cell.id, 'full')}
				>
					<EyeOff class="h-2.5 w-2.5" />
					code hidden
				</button>
			{:else}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<button
							class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
							onclick={() => setCellDisplay(cell.id, 'output')}
							aria-label="Hide code — show result only"
						>
							<Eye class="h-3.5 w-3.5" />
						</button>
					</Tooltip.Trigger>
					<Tooltip.Content
						><p class="text-xs">Hide code — show result only (⇧C in command mode)</p></Tooltip.Content
					>
				</Tooltip.Root>
			{/if}
			<div class="inline-flex items-center rounded border border-border/60 bg-muted/20 p-0.5">
				<button
					class="h-5 rounded-sm px-1.5 font-mono text-2xs font-semibold transition-colors {cellMode ===
					'prql'
						? 'bg-foreground text-background shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => onModeChange('prql')}
					title="PRQL code mode">PRQL</button
				>
				<button
					class="h-5 rounded-sm px-1.5 font-mono text-2xs font-semibold transition-colors {cellMode ===
					'visual'
						? 'bg-foreground text-background shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => onModeChange('visual')}
					title="Visual pipeline editor">Visual</button
				>
				<button
					class="h-5 rounded-sm px-1.5 font-mono text-2xs font-semibold transition-colors {cellMode ===
					'sql'
						? 'bg-foreground text-background shadow-sm'
						: 'text-muted-foreground hover:text-foreground'}"
					onclick={() => onModeChange('sql')}
					title="SQL mode">SQL</button
				>
			</div>
		{/if}

		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					onclick={() => setCellDisplay(cell.id, collapsed ? 'full' : 'collapsed')}
					aria-label={collapsed ? 'Expand cell' : 'Collapse cell'}
				>
					<ChevronsUpDown class="h-3.5 w-3.5" />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content
				><p class="text-xs">
					{collapsed ? 'Expand cell' : 'Collapse cell'} (c in command mode)
				</p></Tooltip.Content
			>
		</Tooltip.Root>
	</div>
</div>
