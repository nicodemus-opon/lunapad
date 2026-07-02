<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as Popover from '$lib/components/ui/popover';
	import { Clock, XCircle, EyeOff, BrainCircuit } from '@lucide/svelte';
	import { updateCellName, setCellDisplay, type Cell } from '$lib/stores/notebook.svelte';

	let {
		cell,
		isQueryCell,
		collapsed,
		codeHidden,
		revealed,
		hidden = false,
		reportView = false,
		cellNumber,
		showCellNumber = false,
		prevCellNames,
		downstreamCount,
		crossNotebookUsageCount,
		cellMode,
		markdownMode,
		isMarkdownCell = false,
		onModeChange,
		onMarkdownModeChange,
		onOverlayChange,
		onFixWithAI
	}: {
		cell: Cell;
		isQueryCell: boolean;
		collapsed: boolean;
		codeHidden: boolean;
		revealed: boolean;
		/** Markdown preview mode hides the header until the cell is hovered/focused. */
		hidden?: boolean;
		reportView?: boolean;
		/** Query/python cell index, rendered in the gutter via negative margin. */
		cellNumber?: number;
		showCellNumber?: boolean;
		prevCellNames: string[];
		downstreamCount: number;
		crossNotebookUsageCount: number;
		cellMode: 'prql' | 'visual' | 'sql';
		markdownMode?: 'visual' | 'source';
		isMarkdownCell?: boolean;
		onModeChange: (mode: 'prql' | 'visual' | 'sql') => void;
		onMarkdownModeChange?: (mode: 'visual' | 'source') => void;
		onOverlayChange?: (open: boolean) => void;
		onFixWithAI?: (errorMsg: string) => void;
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
	class="flex h-7 w-full items-center gap-2 transition-opacity duration-(--motion-fast) select-none {hidden
		? revealed
			? 'opacity-100'
			: 'opacity-0'
		: ''} {collapsed ? 'cursor-pointer' : ''}"
	onclick={onRowClick}
>
	{#if cellNumber != null}
		<span
			class="pointer-events-none -ml-(--cell-gutter) w-(--cell-gutter) shrink-0 pr-1 text-right font-mono text-xs leading-none font-medium text-muted-foreground/50 tabular-nums transition-opacity duration-(--motion-fast) {showCellNumber
				? 'opacity-100'
				: 'opacity-0'}"
			aria-hidden="true"
		>
			{cellNumber}
		</span>
	{/if}
	<div class="flex min-w-0 flex-1 items-center gap-1.5">
		{#if !codeHidden}
			<Tooltip.Root>
				<Tooltip.Trigger class="min-w-0 {collapsed ? 'flex-none' : 'flex-1'}">
					<input
						class="cell-name-input h-6 min-w-0 text-inherit {collapsed
							? 'w-auto max-w-48'
							: 'w-full'} font-mono text-sm font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground/50"
						placeholder={cell.cellType === 'udf'
							? 'untitled udf…'
							: isQueryCell
								? 'model name…'
								: 'note title…'}
						value={nameInputValue}
						disabled={cell.cellType === 'udf'}
						onfocus={() => {
							nameInputFocused = true;
						}}
						oninput={(e) => {
							nameInputValue = (e.target as HTMLInputElement).value;
						}}
						onblur={() => {
							nameInputFocused = false;
							const result = updateCellName(cell.id, nameInputValue);
							if (!result.ok) {
								toast.error(result.error);
								nameInputValue = cell.outputName;
							}
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
					{#if cell.cellType === 'udf'}
						<p class="text-xs">Name is derived from the function's <code>def</code> line.</p>
					{:else if isQueryCell}
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
		{/if}
		{#if !codeHidden && isQueryCell && downstreamTotal > 0}
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
					class="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-warning/30 bg-warning/10 px-1.5 text-2xs font-semibold text-warning shadow-2xs"
				>
					<Clock class="h-2.5 w-2.5" />
					stale
				</span>
			{/if}
			{#if errorCount > 0}
				<Popover.Root onOpenChange={onOverlayChange}>
					<Popover.Trigger
						class="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-destructive/30 bg-destructive/10 px-1.5 text-2xs font-semibold text-destructive shadow-2xs transition-colors outline-none hover:bg-destructive/20 focus-visible:ring-2 focus-visible:ring-ring/50"
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
						{#if onFixWithAI}
							<button
								class="mt-1 flex w-full items-center justify-center gap-1 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-2xs font-medium text-primary transition-colors hover:bg-primary/20"
								onclick={() =>
									onFixWithAI!(
										cell.errors[0]?.display ??
											cell.errors[0]?.reason ??
											cell.materializeError ??
											'unknown error'
									)}
							>
								<BrainCircuit class="h-3 w-3" />
								Fix with AI
							</button>
						{/if}
					</Popover.Content>
				</Popover.Root>
			{/if}
		{/if}
	</div>

	<div
		class="flex shrink-0 items-center gap-1 transition-opacity duration-(--motion-fast) {revealed
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
			{/if}
			<div
				class="inline-flex items-center gap-px rounded-md border border-border/60 bg-muted/30 p-0.5"
				role="tablist"
			>
				<button
					class="h-5 rounded-sm px-1.5 text-2xs font-semibold transition-[background-color,color] duration-(--motion-fast) {cellMode ===
					'prql'
						? 'bg-secondary text-secondary-foreground  '
						: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
					onclick={() => onModeChange('prql')}
					title="PRQL code mode"
					role="tab"
					aria-selected={cellMode === 'prql'}>PRQL</button
				>
				<button
					class="h-5 rounded-sm px-1.5 text-2xs font-semibold transition-[background-color,color] duration-(--motion-fast) {cellMode ===
					'visual'
						? 'bg-secondary text-secondary-foreground  '
						: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
					onclick={() => onModeChange('visual')}
					title="Visual pipeline editor"
					role="tab"
					aria-selected={cellMode === 'visual'}>Visual</button
				>
				<button
					class="h-5 rounded-sm px-1.5 text-2xs font-semibold transition-[background-color,color] duration-(--motion-fast) {cellMode ===
					'sql'
						? 'bg-secondary text-secondary-foreground  '
						: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
					onclick={() => onModeChange('sql')}
					title="SQL mode"
					role="tab"
					aria-selected={cellMode === 'sql'}>SQL</button
				>
			</div>
		{:else if isMarkdownCell && !collapsed && onMarkdownModeChange}
			{#if codeHidden}
				<button
					class="inline-flex h-5 items-center gap-1 rounded px-1.5 text-2xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
					title="Show editor"
					onclick={() => setCellDisplay(cell.id, 'full')}
				>
					<EyeOff class="h-2.5 w-2.5" />
					editor hidden
				</button>
			{/if}
			<div
				class="inline-flex items-center gap-px rounded-md border border-border/60 bg-muted/30 p-0.5"
				role="tablist"
			>
				<button
					class="h-5 rounded-sm px-1.5 text-2xs font-semibold transition-[background-color,color] duration-(--motion-fast) {(markdownMode ??
						'visual') === 'visual'
						? 'bg-secondary text-secondary-foreground'
						: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
					onclick={() => onMarkdownModeChange?.('visual')}
					title="Visual dashboard editor"
					role="tab"
					aria-selected={(markdownMode ?? 'visual') === 'visual'}>Visual</button
				>
				<button
					class="h-5 rounded-sm px-1.5 text-2xs font-semibold transition-[background-color,color] duration-(--motion-fast) {(markdownMode ??
						'visual') === 'source'
						? 'bg-secondary text-secondary-foreground'
						: 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
					onclick={() => onMarkdownModeChange?.('source')}
					title="Markdoc source"
					role="tab"
					aria-selected={(markdownMode ?? 'visual') === 'source'}>Source</button
				>
			</div>
		{/if}
	</div>
</div>

<style>
	.cell-name-input {
		border: 1px solid transparent;
		background: transparent;
		padding: 0;
		outline: none;
		box-shadow: none;
		transition:
			background var(--motion-fast) var(--motion-ease-out),
			border-color var(--motion-fast) var(--motion-ease-out),
			padding var(--motion-fast) var(--motion-ease-out);
	}
	.cell-name-input:focus {
		background: var(--input);
		border-color: var(--border);
		border-radius: var(--radius-sm);
		padding: 0 0.375rem;
		outline: none;
		box-shadow:
			inset 0 1px 2px oklch(0 0 0 / 0.06),
			0 0 0 2px oklch(from var(--ring) l c h / 0.15);
	}
</style>
