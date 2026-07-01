<script lang="ts">
	import { fly } from 'svelte/transition';
	import { CheckCircle2, Inbox, MessageSquare, MoreHorizontal, X } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Button } from '$lib/components/ui/button';
	import type { Comment, CommentThread } from '$lib/types/comments';
	import { commentInitials, formatCommentTime, reasonLabel } from '$lib/services/comment-utils';
	import {
		closeCommentPanel,
		createThread,
		fetchThreadDetail,
		fetchThreads,
		getCommentPanelContext,
		getInboxItems,
		getInboxUnread,
		getReviewMode,
		getReviewPanelOpen,
		getReviewPanelTab,
		getTeamUsers,
		markThreadsRead,
		openCommentPanel,
		replyToThread,
		setReviewMode,
		setReviewPanelTab,
		updateThreadStatus
	} from '$lib/stores/comments.svelte';

	interface Props {
		width: number;
		onStartResize: (e: PointerEvent) => void;
	}

	let { width, onStartResize }: Props = $props();

	const THREAD_TEMPLATES = [
		{ label: 'Logic question', body: 'Can you explain the logic in this cell?' },
		{ label: 'Data check', body: 'This result looks off. Can we investigate?' },
		{ label: 'Ready for review', body: 'Ready for review when you have a moment.' },
		{ label: 'Add a test', body: 'Can we add a dbt test for this output?' }
	];

	let threads = $state<CommentThread[]>([]);
	let selectedThreadId = $state<string | null>(null);
	let comments = $state<Comment[]>([]);
	let composer = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	const panelOpen = $derived(getReviewPanelOpen());
	const panelTab = $derived(getReviewPanelTab());
	const ctx = $derived(getCommentPanelContext());
	const teamUsers = $derived(getTeamUsers());
	const inboxItems = $derived(getInboxItems());
	const inboxUnread = $derived(getInboxUnread());
	const reviewMode = $derived(getReviewMode());
	const selectedThread = $derived(threads.find((t) => t.id === selectedThreadId) ?? null);
	const contextLabel = $derived(
		ctx.cellId ? `Cell · ${ctx.cellId}` : ctx.notebookId ? 'Notebook' : 'Review'
	);

	async function loadThreads(): Promise<void> {
		if (!ctx.notebookId) return;
		loading = true;
		error = null;
		try {
			threads = await fetchThreads({
				notebookId: ctx.notebookId,
				cellId: ctx.cellId ?? undefined
			});
			if (threads.length && !selectedThreadId) {
				selectedThreadId = threads[0].id;
				await loadComments(threads[0].id);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load threads';
		} finally {
			loading = false;
		}
	}

	async function loadComments(threadId: string): Promise<void> {
		const detail = await fetchThreadDetail(threadId);
		comments = detail.comments;
		await markThreadsRead([threadId]);
	}

	async function selectThread(threadId: string): Promise<void> {
		selectedThreadId = threadId;
		await loadComments(threadId);
	}

	async function submitReply(): Promise<void> {
		const text = composer.trim();
		if (!text || !selectedThreadId) return;
		composer = '';
		const comment = await replyToThread(selectedThreadId, text);
		comments = [...comments, comment];
	}

	async function startThread(body: string): Promise<void> {
		if (!ctx.notebookId || !ctx.anchor) return;
		const result = await createThread({
			anchorType: ctx.anchor.type,
			anchorKey: ctx.anchor.key,
			body
		});
		threads = [result.thread, ...threads];
		selectedThreadId = result.thread.id;
		comments = [result.comment];
	}

	async function resolveThread(): Promise<void> {
		if (!selectedThreadId) return;
		const updated = await updateThreadStatus(selectedThreadId, 'resolved');
		threads = threads.map((t) => (t.id === updated.id ? updated : t));
	}

	async function openInboxItem(
		threadId: string,
		notebookId: string | null,
		cellId: string | null
	): Promise<void> {
		if (notebookId) openCommentPanel({ notebookId, cellId });
		selectedThreadId = threadId;
		setReviewPanelTab('thread');
		await loadComments(threadId);
	}

	$effect(() => {
		if (panelOpen && panelTab === 'thread' && ctx.notebookId) {
			selectedThreadId = null;
			comments = [];
			void loadThreads();
		}
	});
</script>

<div
	class="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize"
	onpointerdown={onStartResize}
	role="separator"
	aria-orientation="vertical"
>
	<div
		class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/40 transition-colors group-hover:bg-primary/40 group-active:bg-primary/60"
	></div>
</div>

<div
	class="flex shrink-0 flex-col border-l border-border/40 bg-sidebar"
	style="width: {width}px;"
	data-testid="review-panel"
>
	<div class="flex h-9 shrink-0 items-center justify-between border-b border-border/40 px-2.5">
		<div class="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
			<MessageSquare size={14} class="shrink-0 text-primary" />
			<span>Review</span>
			{#if inboxUnread > 0}
				<span class="rounded-full bg-primary/15 px-1.5 py-px text-2xs font-medium text-primary">
					{inboxUnread}
				</span>
			{/if}
		</div>
		<div class="flex items-center gap-0.5">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							aria-label="Review options"
						>
							<MoreHorizontal size={14} />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-44">
					<DropdownMenu.CheckboxItem
						checked={reviewMode}
						onCheckedChange={(checked) => setReviewMode(!!checked)}
					>
						Highlight open threads
					</DropdownMenu.CheckboxItem>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<button
				class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				aria-label="Close review panel"
				onclick={() => closeCommentPanel()}
			>
				<X size={14} />
			</button>
		</div>
	</div>

	<div class="flex shrink-0 gap-1 border-b border-border/40 px-2 py-1.5">
		<button
			type="button"
			class="flex-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors {panelTab ===
			'thread'
				? 'bg-background text-foreground shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => setReviewPanelTab('thread')}
		>
			Thread
		</button>
		<button
			type="button"
			class="relative flex-1 rounded-md px-2 py-1 text-2xs font-medium transition-colors {panelTab ===
			'inbox'
				? 'bg-background text-foreground shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
			onclick={() => setReviewPanelTab('inbox')}
		>
			Inbox
			{#if inboxUnread > 0}
				<span class="absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true"
				></span>
			{/if}
		</button>
	</div>

	{#if panelTab === 'inbox'}
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{#if !inboxItems.length}
				<div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
					<Inbox size={20} class="text-muted-foreground/50" />
					<p class="text-xs text-muted-foreground">Nothing needs your attention.</p>
				</div>
			{:else}
				{#each inboxItems as item (item.thread.id)}
					<button
						type="button"
						class="flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent/60"
						onclick={() =>
							void openInboxItem(item.thread.id, item.thread.notebookId, item.thread.cellId)}
					>
						<div
							class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xs font-semibold text-primary"
						>
							{commentInitials(item.latestComment?.authorName)}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate text-xs font-medium text-foreground">
									{item.thread.title ?? 'Thread'}
								</span>
								{#if item.thread.unread}
									<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"></span>
								{/if}
							</div>
							<p class="text-2xs text-muted-foreground">{reasonLabel(item.reason)}</p>
							{#if item.latestComment}
								<p class="mt-0.5 line-clamp-2 text-2xs text-muted-foreground/90">
									{item.latestComment.body}
								</p>
							{/if}
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{:else}
		<div class="flex shrink-0 items-center gap-2 border-b border-border/30 px-3 py-2">
			<span class="truncate font-mono text-2xs text-muted-foreground">{contextLabel}</span>
		</div>

		{#if threads.length > 1}
			<div class="flex shrink-0 gap-1 overflow-x-auto border-b border-border/30 px-2 py-1.5">
				{#each threads as thread (thread.id)}
					<button
						type="button"
						class="shrink-0 rounded-md px-2 py-1 text-2xs transition-colors {selectedThreadId ===
						thread.id
							? 'bg-primary/10 text-primary'
							: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
						onclick={() => void selectThread(thread.id)}
					>
						{thread.title ?? 'Thread'}
					</button>
				{/each}
			</div>
		{/if}

		<div class="flex min-h-0 flex-1 flex-col">
			<div class="flex-1 space-y-3 overflow-y-auto px-3 py-3">
				{#if loading}
					<p class="text-2xs text-muted-foreground">Loading…</p>
				{:else if error}
					<p class="text-2xs text-destructive">{error}</p>
				{:else if !threads.length}
					<div class="space-y-3 py-2">
						<p class="text-xs text-muted-foreground">Start a thread on this cell.</p>
						<div class="flex flex-wrap gap-1.5">
							{#each THREAD_TEMPLATES as tpl}
								<button
									type="button"
									class="rounded-full border border-border/50 bg-background/60 px-2.5 py-1 text-2xs text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
									onclick={() => void startThread(tpl.body)}
								>
									{tpl.label}
								</button>
							{/each}
						</div>
					</div>
				{:else}
					{#each comments as comment (comment.id)}
						<div class="flex gap-2.5" in:fly={{ y: 6, duration: 160 }}>
							<div
								class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground"
							>
								{commentInitials(comment.authorName)}
							</div>
							<div class="min-w-0 flex-1">
								<div class="mb-0.5 flex items-baseline gap-2">
									<span class="text-xs font-medium text-foreground">
										{comment.authorName ?? 'Teammate'}
									</span>
									<span class="text-2xs text-muted-foreground">
										{formatCommentTime(comment.createdAt)}
									</span>
								</div>
								<p class="text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
									{comment.body}
								</p>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			{#if selectedThread}
				<div class="shrink-0 border-t border-border/40 bg-background/40 px-3 py-2.5">
					{#if selectedThread.status === 'open'}
						<button
							type="button"
							class="mb-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							onclick={() => void resolveThread()}
						>
							<CheckCircle2 size={12} />
							Mark resolved
						</button>
					{/if}
					<Textarea
						class="min-h-[64px] resize-none border-border/50 bg-background text-xs"
						placeholder="Reply… @{teamUsers[0]?.mention ?? 'name'} to mention"
						bind:value={composer}
						onkeydown={(e) => {
							if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
								e.preventDefault();
								void submitReply();
							}
						}}
					/>
					<div class="mt-2 flex items-center justify-between">
						<span class="text-2xs text-muted-foreground">⌘↵ to send</span>
						<Button
							size="sm"
							class="h-7 px-3 text-xs"
							disabled={!composer.trim()}
							onclick={() => void submitReply()}
						>
							Send
						</Button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
