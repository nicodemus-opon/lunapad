<script lang="ts">
	import {
		BotMessageSquare,
		User,
		SquarePlay,
		Square,
		PencilLine,
		ChartBar,
		Trash2,
		RefreshCw,
		Database,
		ChevronDown,
		ChevronRight,
		ArrowUpDown
	} from '@lucide/svelte';
	import type { ChatMessage } from '$lib/stores/ai-chat.svelte.js';
	import { getCells } from '$lib/stores/notebook.svelte.js';
	import { renderMarkdocCell } from '$lib/services/markdoc-interp.js';
	import MarkdocRenderer from '$lib/components/markdown/MarkdocRenderer.svelte';
	import DiffView from '$lib/components/ai/DiffView.svelte';

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

	let activityExpanded = $state(false);
	let expandedChips = $state<Set<string>>(new Set());

	function toggleActivity(): void {
		activityExpanded = !activityExpanded;
	}

	function toggleChip(id: string): void {
		expandedChips = new Set(
			expandedChips.has(id) ? [...expandedChips].filter((i) => i !== id) : [...expandedChips, id]
		);
	}

	function summarizeEvents(events: ChatMessage['actionEvents']): string {
		const queries = events.filter((e) => DATA_TOOLS.has(e.tool)).length;
		const creates = events.filter((e) => e.tool === 'create_cell').length;
		const runs = events.filter((e) => e.tool === 'run_cells').length;
		const updates = events.filter((e) => e.tool === 'update_cell').length;
		const charts = events.filter((e) => e.tool === 'set_chart' || e.tool === 'pick_chart').length;
		const dashboards = events.filter(
			(e) => e.tool === 'create_dashboard' || e.tool === 'add_dashboard_block'
		).length;
		const parts: string[] = [];
		if (queries) parts.push(`${queries} quer${queries === 1 ? 'y' : 'ies'}`);
		if (creates) parts.push(`${creates} cell${creates === 1 ? '' : 's'} created`);
		if (updates) parts.push(`${updates} updated`);
		if (charts) parts.push(`${charts} chart${charts === 1 ? '' : 's'}`);
		if (dashboards) parts.push(`${dashboards} dashboard block${dashboards === 1 ? '' : 's'}`);
		if (runs) parts.push(`${runs} run${runs === 1 ? '' : 's'}`);
		return parts.join(' · ') || 'Actions taken';
	}

	let latestEventLabel = $derived(
		message.actionEvents.length > 0
			? message.actionEvents[message.actionEvents.length - 1].label
			: null
	);

	// Keep the per-message activity accordion collapsed by default — live progress is
	// surfaced once in the pinned AIChatAgentStatus bar, so don't duplicate it here.
	// Only auto-expand on error so failures stay visible.
	let _wasStreaming = $state(false);
	$effect(() => {
		if (message.isStreaming) {
			_wasStreaming = true;
			return;
		}
		if (_wasStreaming) {
			activityExpanded = message.hasError ?? false;
			_wasStreaming = false;
		}
	});

	const renderedMessage = $derived.by(() => {
		if (message.role !== 'assistant' || !message.text) return null;
		try {
			return renderMarkdocCell(message.text, getCells());
		} catch {
			return null;
		}
	});
</script>

<div
	class="group flex gap-2.5 px-3 py-2.5"
	class:flex-row-reverse={message.role === 'user'}
	data-testid="ai-message"
	data-role={message.role}
>
	<div class="mt-0.5 shrink-0">
		{#if message.role === 'user'}
			<div class="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
				<User class="h-3.5 w-3.5" />
			</div>
		{:else if message.role === 'error'}
			<div
				class="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/10 text-destructive"
			>
				<BotMessageSquare class="h-3.5 w-3.5" />
			</div>
		{:else}
			<div
				class="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground"
			>
				<BotMessageSquare class="h-3.5 w-3.5" />
			</div>
		{/if}
	</div>

	<div class="flex min-w-0 flex-1 flex-col gap-1.5" class:items-end={message.role === 'user'}>
		{#if message.contextPills.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each message.contextPills as pill (pill.cellId)}
					<span
						class="inline-flex items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground"
					>
						{pill.cellName}
					</span>
				{/each}
			</div>
		{/if}

		{#if message.isStreaming && !message.text && message.actionEvents.length === 0}
			<div class="ai-shimmer-bar rounded-full"></div>
		{/if}

		{#if message.text}
			{#if message.role === 'user'}
				<div
					class="max-w-full rounded-xl bg-primary px-3 py-2 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-primary-foreground"
					data-testid="ai-message-text"
				>
					{message.text}
				</div>
			{:else if message.role === 'error'}
				<div
					class="max-w-full rounded-xl bg-destructive/10 px-3 py-2 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-destructive"
					data-testid="ai-error"
				>
					{message.text}
				</div>
			{:else}
				<div
					class="ai-prose max-w-full border-l-2 border-border pl-3 text-sm wrap-break-word text-foreground"
					data-testid="ai-message-text"
				>
					{#if renderedMessage}
						<MarkdocRenderer content={renderedMessage.tree} errors={renderedMessage.errors} />
					{:else}
						{message.text}
					{/if}
					{#if message.isStreaming}<span class="ai-text-cursor">▋</span>{/if}
				</div>
			{/if}
		{/if}

		{#if message.stopped}
			<div
				class="flex items-center gap-1 text-xs text-muted-foreground/70"
				data-testid="ai-stopped"
			>
				<Square class="h-3 w-3 shrink-0" />
				<span>Stopped</span>
			</div>
		{/if}

		{#if message.actionEvents.length > 0}
			<div
				class="w-full overflow-hidden rounded-lg border border-border bg-muted/25 text-xs text-muted-foreground"
				data-testid="ai-activity"
			>
				<button
					class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/40"
					onclick={toggleActivity}
				>
					{#if activityExpanded}
						<ChevronDown class="h-3 w-3 shrink-0 opacity-40" />
					{:else}
						<ChevronRight class="h-3 w-3 shrink-0 opacity-40" />
					{/if}
					<span class="flex-1 text-xs text-muted-foreground/80"
						>{message.isStreaming
							? (latestEventLabel ?? 'Working…')
							: summarizeEvents(message.actionEvents)}</span
					>
					{#if message.isStreaming}
						<span class="ai-dot-pulse h-1.5 w-1.5 shrink-0 rounded-full bg-primary"></span>
					{/if}
				</button>

				{#if activityExpanded}
					<div class="flex flex-col border-t border-border">
						{#each message.actionEvents as ev (ev.id)}
							{@const Icon = toolIcons[ev.tool] ?? SquarePlay}
							{@const hasDiff =
								ev.tool === 'update_cell' && ev.oldCode !== undefined && ev.newCode !== undefined}
							{@const hasPreview = DATA_TOOLS.has(ev.tool) && ev.preview}
							{@const isExpandable = hasPreview || hasDiff}
							{@const isExpanded = expandedChips.has(ev.id ?? '')}
							<div class="border-b border-border last:border-b-0">
								{#if isExpandable}
									<button
										class="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
										onclick={() => toggleChip(ev.id ?? '')}
										data-testid="ai-activity-chip"
									>
										<Icon class="h-3 w-3 shrink-0 text-primary/60" />
										<span class="flex-1 truncate font-mono text-xs">{ev.label}</span>
										{#if isExpanded}
											<ChevronDown class="h-3 w-3 shrink-0 opacity-40" />
										{:else}
											<ChevronRight class="h-3 w-3 shrink-0 opacity-40" />
										{/if}
									</button>
								{:else}
									<div
										class="flex items-center gap-1.5 px-2.5 py-1.5"
										data-testid="ai-activity-chip"
									>
										<Icon class="h-3 w-3 shrink-0 text-primary/60" />
										<span class="truncate font-mono text-xs">{ev.label}</span>
									</div>
								{/if}
								{#if isExpandable && isExpanded}
									{#if hasDiff}
										<DiffView
											class="border-t border-border"
											oldCode={ev.oldCode!}
											newCode={ev.newCode!}
										/>
									{:else if hasPreview}
										<div
											class="overflow-x-auto border-t border-border px-2.5 py-1.5 font-mono text-xs whitespace-pre text-foreground/60"
										>
											{ev.preview}
										</div>
									{/if}
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if message.suggestions?.length && !message.isStreaming}
			<div class="flex flex-wrap gap-1.5 pt-0.5">
				{#each message.suggestions as s (s)}
					<button
						onclick={() => onSuggestion?.(s)}
						class="rounded-full border border-primary bg-primary/6 px-2.5 py-1 text-xs text-primary/75 transition-colors hover:bg-primary/12 hover:text-primary/90"
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
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}

	.ai-shimmer-bar {
		width: 60%;
		height: 3px;
		background: linear-gradient(
			90deg,
			color-mix(in oklab, var(--primary) 20%, transparent) 0%,
			color-mix(in oklab, var(--primary) 50%, transparent) 50%,
			color-mix(in oklab, var(--primary) 20%, transparent) 100%
		);
		background-size: 200% 100%;
		animation: ai-shimmer 1.4s ease-in-out infinite;
	}

	@keyframes ai-shimmer {
		0% {
			background-position: 200% center;
		}
		100% {
			background-position: -200% center;
		}
	}

	.ai-dot-pulse {
		animation: ai-dot-pulse 1.2s ease-in-out infinite;
	}

	@keyframes ai-dot-pulse {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.4;
			transform: scale(0.85);
		}
	}

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
	:global(.ai-prose h1) {
		font-size: 1.05em;
	}
	:global(.ai-prose h2) {
		font-size: 1em;
	}
	:global(.ai-prose h3) {
		font-size: 0.95em;
		opacity: 0.9;
	}
	:global(.ai-prose ul, .ai-prose ol) {
		padding-left: 1.25em;
		margin: 0.35em 0;
	}
	:global(.ai-prose li) {
		margin: 0.1em 0;
	}
	:global(.ai-prose code) {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: var(--text-2xs);
		background: color-mix(in oklab, currentColor 10%, transparent);
		padding: 0.15em 0.35em;
		border-radius: var(--radius-sm);
	}
	:global(.ai-prose pre) {
		background: color-mix(in oklab, var(--foreground) 7%, transparent);
		border: 1px solid var(--border);
		border-radius: var(--radius);
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
		border-left: 2px solid var(--primary);
		padding-left: 0.75em;
		margin: 0.35em 0;
		opacity: 0.85;
		font-style: italic;
	}
	:global(.ai-prose hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 0.45em 0;
	}
	:global(.ai-prose a) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
