<script module>
	import { marked } from 'marked';
	marked.setOptions({ breaks: true, gfm: true });
</script>

<script lang="ts">
	import { BotMessageSquare, User, SquarePlay, Square, PencilLine, ChartBar, Trash2, RefreshCw, Database, ChevronDown, ChevronRight, ArrowUpDown } from '@lucide/svelte';
	import DOMPurify from 'dompurify';
	import type { ChatMessage } from '$lib/stores/ai-chat.svelte.js';
	import { getCells } from '$lib/stores/notebook.svelte.js';
	import { interpolateMarkdownRefs } from '$lib/services/markdown-interp.js';

	interface Props {
		message: ChatMessage;
		onSuggestion?: (text: string) => void;
	}

	let { message, onSuggestion }: Props = $props();

	const DATA_TOOLS = new Set(['query_data', 'sample_data', 'profile_column', 'get_cell_result']);

	const toolIcons: Record<string, typeof BotMessageSquare> = {
		create_cell: SquarePlay,
		update_cell: PencilLine,
		set_chart: ChartBar,
		pick_chart: ChartBar,
		set_view_mode: ChartBar,
		delete_cell: Trash2,
		run_cells: RefreshCw,
		move_cell: ArrowUpDown,
		query_data: Database,
		sample_data: Database,
		profile_column: Database,
		get_cell_result: Database
	};

	// Collapsed by default; expand individual data previews. Keyed by the event's stable
	// id (not array index) so an expanded chip stays bound to its row as events stream in.
	let activityExpanded = $state(false);
	let expandedChips = $state<Set<string>>(new Set());

	function toggleActivity(): void {
		activityExpanded = !activityExpanded;
	}

	function toggleChip(id: string): void {
		expandedChips = new Set(
			expandedChips.has(id)
				? [...expandedChips].filter((i) => i !== id)
				: [...expandedChips, id]
		);
	}

	function summarizeEvents(events: ChatMessage['actionEvents']): string {
		const queries = events.filter((e) => DATA_TOOLS.has(e.tool)).length;
		const creates = events.filter((e) => e.tool === 'create_cell').length;
		const runs = events.filter((e) => e.tool === 'run_cells').length;
		const updates = events.filter((e) => e.tool === 'update_cell').length;
		const charts = events.filter((e) => e.tool === 'set_chart' || e.tool === 'pick_chart').length;
		const dashboards = events.filter((e) => e.tool === 'create_dashboard' || e.tool === 'add_dashboard_block').length;
		const parts: string[] = [];
		if (queries) parts.push(`${queries} quer${queries === 1 ? 'y' : 'ies'}`);
		if (creates) parts.push(`${creates} cell${creates === 1 ? '' : 's'} created`);
		if (updates) parts.push(`${updates} updated`);
		if (charts) parts.push(`${charts} chart${charts === 1 ? '' : 's'}`);
		if (dashboards) parts.push(`${dashboards} dashboard block${dashboards === 1 ? '' : 's'}`);
		if (runs) parts.push(`${runs} run${runs === 1 ? '' : 's'}`);
		return parts.join(' · ') || 'Actions taken';
	}

	/** Compute a simple line-level diff between old and new code for display. */
	function buildDiff(oldCode: string, newCode: string): Array<{ kind: 'same' | 'removed' | 'added'; line: string }> {
		const oldLines = oldCode.split('\n');
		const newLines = newCode.split('\n');
		const result: Array<{ kind: 'same' | 'removed' | 'added'; line: string }> = [];
		const maxLen = Math.max(oldLines.length, newLines.length);
		for (let i = 0; i < maxLen; i++) {
			const o = oldLines[i];
			const n = newLines[i];
			if (o === n) {
				result.push({ kind: 'same', line: o ?? '' });
			} else {
				if (o !== undefined) result.push({ kind: 'removed', line: o });
				if (n !== undefined) result.push({ kind: 'added', line: n });
			}
		}
		return result;
	}

	// Auto-expand activity during streaming so user can see live progress
	let _wasStreaming = $state(false);
	$effect(() => {
		if (message.isStreaming && message.actionEvents.length > 0 && !_wasStreaming) {
			activityExpanded = true;
			_wasStreaming = true;
		}
		if (!message.isStreaming && _wasStreaming) {
			// Keep expanded when the AI failed — user needs to see what was attempted
			if (!message.hasError) {
				activityExpanded = false;
			}
			_wasStreaming = false;
		}
	});

	const renderedText = $derived.by(() => {
		if (message.role !== 'assistant' || !message.text) return '';
		try {
			const interpolated = interpolateMarkdownRefs(message.text, getCells());
			return DOMPurify.sanitize(marked.parse(interpolated) as string);
		} catch {
			return DOMPurify.sanitize(message.text);
		}
	});
</script>

<div class="group flex gap-2.5 px-3 py-2.5" class:flex-row-reverse={message.role === 'user'} data-testid="ai-message" data-role={message.role}>
	<!-- Avatar -->
	<div class="mt-0.5 shrink-0">
		{#if message.role === 'user'}
			<div class="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
				<User size={13} />
			</div>
		{:else if message.role === 'error'}
			<div class="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/10 text-destructive">
				<BotMessageSquare size={13} />
			</div>
		{:else}
			<div class="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
				<BotMessageSquare size={13} />
			</div>
		{/if}
	</div>

	<div class="flex min-w-0 flex-1 flex-col gap-1.5" class:items-end={message.role === 'user'}>
		<!-- Context pills (user message) -->
		{#if message.contextPills.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each message.contextPills as pill (pill.cellId)}
					<span class="inline-flex items-center rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-2xs text-muted-foreground">
						{pill.cellName}
					</span>
				{/each}
			</div>
		{/if}

		<!-- Streaming shimmer (when generating, no text or events yet) -->
		{#if message.isStreaming && !message.text && message.actionEvents.length === 0}
			<div class="ai-shimmer-bar rounded-full"></div>
		{/if}

		<!-- Message text -->
		{#if message.text}
			{#if message.role === 'user'}
				<div class="max-w-full rounded-xl bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground whitespace-pre-wrap wrap-break-word" data-testid="ai-message-text">
					{message.text}
				</div>
			{:else if message.role === 'error'}
				<div class="max-w-full rounded-xl bg-destructive/10 px-3 py-2 text-sm leading-relaxed text-destructive whitespace-pre-wrap wrap-break-word" data-testid="ai-error">
					{message.text}
				</div>
			{:else}
				<div class="ai-prose max-w-full wrap-break-word border-l-2 border-border/25 pl-3 text-sm text-foreground" data-testid="ai-message-text">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html renderedText}{#if message.isStreaming}<span class="ai-text-cursor">▋</span>{/if}
				</div>
			{/if}
		{/if}

		<!-- Stopped indicator (generation aborted by the user) -->
		{#if message.stopped}
			<div class="flex items-center gap-1 text-2xs text-muted-foreground/70" data-testid="ai-stopped">
				<Square size={9} class="shrink-0" />
				<span>Stopped</span>
			</div>
		{/if}

		<!-- Collapsible activity bar (action events) -->
		{#if message.actionEvents.length > 0}
			<div class="w-full overflow-hidden rounded-lg border border-border/35 bg-muted/25 text-xs text-muted-foreground" data-testid="ai-activity">
				<!-- Summary bar / toggle -->
				<button
					class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40"
					onclick={toggleActivity}
				>
					{#if activityExpanded}
						<ChevronDown size={10} class="shrink-0 opacity-40" />
					{:else}
						<ChevronRight size={10} class="shrink-0 opacity-40" />
					{/if}
					<span class="flex-1 text-2xs text-muted-foreground/80">{summarizeEvents(message.actionEvents)}</span>
				</button>

				<!-- Expanded detail list -->
				{#if activityExpanded}
					<div class="flex flex-col border-t border-border/25">
						{#each message.actionEvents as ev (ev.id)}
							{@const Icon = toolIcons[ev.tool] ?? SquarePlay}
							{@const isDataTool = DATA_TOOLS.has(ev.tool)}
							{@const hasDiff = ev.tool === 'update_cell' && ev.oldCode !== undefined && ev.newCode !== undefined}
							{@const isExpandable = (isDataTool && ev.preview) || hasDiff}
							{@const isExpanded = expandedChips.has(ev.id ?? '')}
							{#if isExpandable}
								<div class="border-b border-border/20 last:border-b-0">
									<button
										class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
										onclick={() => toggleChip(ev.id ?? '')}
										data-testid="ai-activity-chip"
									>
										<Icon size={10} class="shrink-0 text-primary/60" />
										<span class="flex-1 truncate font-mono text-2xs">{ev.label}</span>
										{#if isExpanded}
											<ChevronDown size={9} class="shrink-0 opacity-40" />
										{:else}
											<ChevronRight size={9} class="shrink-0 opacity-40" />
										{/if}
									</button>
									{#if isExpanded}
										{#if hasDiff}
											<div class="border-t border-border/20 font-mono text-2xs overflow-x-auto">
												{#each buildDiff(ev.oldCode!, ev.newCode!) as line}
													{#if line.kind === 'same'}
														<div class="px-2.5 py-px text-foreground/40 whitespace-pre">{line.line}</div>
													{:else if line.kind === 'removed'}
														<div class="bg-destructive/8 px-2.5 py-px text-destructive/70 whitespace-pre">- {line.line}</div>
													{:else}
														<div class="bg-success/8 px-2.5 py-px text-success/80 whitespace-pre">+ {line.line}</div>
													{/if}
												{/each}
											</div>
										{:else}
											<div class="border-t border-border/20 px-2.5 py-1.5 font-mono text-2xs overflow-x-auto whitespace-pre text-foreground/60">
												{ev.preview}
											</div>
										{/if}
									{/if}
								</div>
							{:else}
								<div class="flex items-center gap-1.5 border-b border-border/20 px-2.5 py-1.5 last:border-b-0" data-testid="ai-activity-chip">
									<Icon size={10} class="shrink-0 text-primary/60" />
									<span class="truncate font-mono text-2xs">{ev.label}</span>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Suggestion chips (after AI finishes) -->
		{#if message.suggestions?.length && !message.isStreaming}
			<div class="flex flex-wrap gap-1.5 pt-0.5">
				{#each message.suggestions as s (s)}
					<button
						onclick={() => onSuggestion?.(s)}
						class="rounded-full border border-primary/25 bg-primary/6 px-2.5 py-1 text-xs text-primary/75 transition-colors hover:bg-primary/12 hover:text-primary/90"
						data-testid="ai-suggestion"
					>
						{s}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.ai-text-cursor {
		display: inline-block;
		animation: ai-cursor-blink 0.9s steps(1) infinite;
		margin-left: 1px;
	}

	@keyframes ai-cursor-blink {
		0%, 100% { opacity: 1; }
		50% { opacity: 0; }
	}

	.ai-shimmer-bar {
		width: 60%;
		height: 3px;
		background: linear-gradient(
			90deg,
			color-mix(in oklab, var(--color-primary, #6366f1) 20%, transparent) 0%,
			color-mix(in oklab, var(--color-primary, #6366f1) 50%, transparent) 50%,
			color-mix(in oklab, var(--color-primary, #6366f1) 20%, transparent) 100%
		);
		background-size: 200% 100%;
		animation: ai-shimmer 1.4s ease-in-out infinite;
	}

	@keyframes ai-shimmer {
		0% { background-position: 200% center; }
		100% { background-position: -200% center; }
	}

	/* Prose styles scoped to AI assistant messages */
	:global(.ai-prose) {
		line-height: 1.5;
	}
	:global(.ai-prose p) {
		margin: 0 0 0.45em;
	}
	:global(.ai-prose p:last-child) {
		margin-bottom: 0;
	}
	:global(.ai-prose h1, .ai-prose h2, .ai-prose h3) {
		font-weight: 600;
		line-height: 1.3;
		margin: 0.6em 0 0.25em;
	}
	:global(.ai-prose h1) { font-size: 1.05em; }
	:global(.ai-prose h2) { font-size: 1em; }
	:global(.ai-prose h3) { font-size: 0.95em; opacity: 0.9; }
	:global(.ai-prose ul, .ai-prose ol) {
		padding-left: 1.25em;
		margin: 0.35em 0;
	}
	:global(.ai-prose li) {
		margin: 0.1em 0;
	}
	:global(.ai-prose code) {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.82em;
		background: color-mix(in oklab, currentColor 10%, transparent);
		padding: 0.15em 0.35em;
		border-radius: 0.25em;
	}
	:global(.ai-prose pre) {
		background: color-mix(in oklab, var(--color-foreground, #000) 7%, transparent);
		border: 1px solid color-mix(in oklab, var(--color-border, #888) 50%, transparent);
		border-radius: 0.5em;
		padding: 0.65em 0.85em;
		overflow-x: auto;
		margin: 0.45em 0;
	}
	:global(.ai-prose pre code) {
		background: none;
		padding: 0;
		font-size: 0.8em;
		border-radius: 0;
	}
	:global(.ai-prose strong) {
		font-weight: 600;
	}
	:global(.ai-prose em) {
		font-style: italic;
	}
	:global(.ai-prose blockquote) {
		border-left: 2px solid color-mix(in oklab, var(--color-primary, #6366f1) 60%, transparent);
		padding-left: 0.75em;
		margin: 0.35em 0;
		opacity: 0.85;
		font-style: italic;
	}
	:global(.ai-prose hr) {
		border: none;
		border-top: 1px solid color-mix(in oklab, currentColor 15%, transparent);
		margin: 0.45em 0;
	}
	:global(.ai-prose a) {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	:global(.ai-prose .md-live-ref) {
		border-bottom: 1px dashed color-mix(in oklch, currentColor 35%, transparent);
		padding-bottom: 1px;
	}
	:global(.ai-prose .md-live-ref--missing) {
		color: color-mix(in oklch, currentColor 45%, transparent);
		font-style: italic;
		border-bottom-style: dotted;
	}
</style>
