<script lang="ts">
	import { BotMessageSquare, User, Loader2, SquarePlay, PencilLine, ChartBar, Trash2, RefreshCw } from '@lucide/svelte';
	import { marked } from 'marked';
	import type { ChatMessage } from '$lib/stores/ai-chat.svelte.js';

	interface Props {
		message: ChatMessage;
	}

	let { message }: Props = $props();

	const toolIcons: Record<string, typeof BotMessageSquare> = {
		create_cell: SquarePlay,
		update_cell: PencilLine,
		set_chart: ChartBar,
		set_view_mode: ChartBar,
		delete_cell: Trash2,
		run_cells: RefreshCw
	};

	// Configure marked with safe defaults
	marked.setOptions({ breaks: true, gfm: true });

	function renderMarkdown(text: string): string {
		try {
			return marked.parse(text) as string;
		} catch {
			return text;
		}
	}
</script>

<div class="group flex gap-2.5 px-3 py-2.5" class:flex-row-reverse={message.role === 'user'}>
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
				{#each message.contextPills as pill}
					<span class="inline-flex items-center rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-2xs text-muted-foreground">
						{pill.cellName}
					</span>
				{/each}
			</div>
		{/if}

		<!-- Message text -->
		{#if message.text || message.isStreaming}
			{#if message.role === 'user'}
				<div class="max-w-full rounded-xl bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground whitespace-pre-wrap wrap-break-word">
					{message.text}
				</div>
			{:else if message.role === 'error'}
				<div class="max-w-full rounded-xl bg-destructive/10 px-3 py-2 text-sm leading-relaxed text-destructive whitespace-pre-wrap wrap-break-word">
					{message.text}
				</div>
			{:else}
				<div class="ai-prose max-w-full rounded-xl bg-muted/60 px-3 py-2 text-sm text-foreground">
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html renderMarkdown(message.text)}{#if message.isStreaming}<span class="ai-text-cursor">▋</span>{/if}
				</div>
			{/if}
		{/if}

		<!-- Action events -->
		{#if message.actionEvents.length > 0}
			<div class="flex w-full flex-col gap-1">
				{#each message.actionEvents as ev}
					{@const Icon = toolIcons[ev.tool] ?? SquarePlay}
					<div class="flex items-center gap-1.5 rounded-lg border border-border/40 bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
						<Icon size={11} class="shrink-0 text-primary/70" />
						<span class="truncate font-mono">{ev.label}</span>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Streaming indicator (when no text yet) -->
		{#if message.isStreaming && !message.text && message.actionEvents.length === 0}
			<div class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Loader2 size={12} class="animate-spin" />
				<span>Thinking…</span>
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

	/* Prose styles scoped to AI assistant messages */
	:global(.ai-prose) {
		line-height: 1.6;
	}
	:global(.ai-prose p) {
		margin: 0 0 0.5em;
	}
	:global(.ai-prose p:last-child) {
		margin-bottom: 0;
	}
	:global(.ai-prose h1, .ai-prose h2, .ai-prose h3) {
		font-weight: 600;
		line-height: 1.3;
		margin: 0.75em 0 0.3em;
	}
	:global(.ai-prose h1) { font-size: 1.05em; }
	:global(.ai-prose h2) { font-size: 1em; }
	:global(.ai-prose h3) { font-size: 0.95em; opacity: 0.9; }
	:global(.ai-prose ul, .ai-prose ol) {
		padding-left: 1.25em;
		margin: 0.4em 0;
	}
	:global(.ai-prose li) {
		margin: 0.15em 0;
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
		margin: 0.5em 0;
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
		margin: 0.4em 0;
		opacity: 0.85;
		font-style: italic;
	}
	:global(.ai-prose hr) {
		border: none;
		border-top: 1px solid color-mix(in oklab, currentColor 15%, transparent);
		margin: 0.5em 0;
	}
	:global(.ai-prose a) {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
