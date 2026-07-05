<script lang="ts">
	import { onMount } from 'svelte';
	import { MessageSquare, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { Comment, CommentThread } from '$lib/types/comments';
	import { formatCommentTime } from '$lib/services/comment-utils';
	import {
		createThread,
		fetchThreadDetail,
		fetchThreads,
		replyToThread
	} from '$lib/stores/comments.svelte';

	interface Props {
		shareToken: string;
		cellId?: string | null;
		isAuthenticated: boolean;
	}

	let { shareToken, cellId: initialCellId = null, isAuthenticated }: Props = $props();

	let open = $state(false);
	let activeCellId = $state<string | null>(null);
	let threads = $state<CommentThread[]>([]);
	let selectedThreadId = $state<string | null>(null);
	let comments = $state<Comment[]>([]);
	let composer = $state('');
	let loading = $state(false);

	const selectedThread = $derived(threads.find((t) => t.id === selectedThreadId) ?? null);

	$effect(() => {
		if (open) return;
		activeCellId = initialCellId;
		selectedThreadId = null;
		comments = [];
	});

	export function openForCell(id: string | null): void {
		activeCellId = id;
		open = true;
		void loadThreads();
	}

	async function loadThreads(): Promise<void> {
		if (!isAuthenticated) return;
		loading = true;
		try {
			threads = await fetchThreads({ shareToken, cellId: activeCellId ?? undefined });
			if (selectedThreadId && !threads.some((thread) => thread.id === selectedThreadId)) {
				selectedThreadId = null;
				comments = [];
			}
			if (threads.length && !selectedThreadId) {
				selectedThreadId = threads[0].id;
				await loadComments(threads[0].id);
			}
			if (!threads.length) comments = [];
		} finally {
			loading = false;
		}
	}

	async function loadComments(threadId: string): Promise<void> {
		const detail = await fetchThreadDetail(threadId);
		comments = detail.comments;
	}

	async function submitNewThread(): Promise<void> {
		const text = composer.trim();
		if (!text) return;
		const result = await createThread({
			anchorType: 'share_report',
			anchorKey: { shareToken, cellId: activeCellId ?? undefined },
			body: text,
			title: activeCellId ? `Comment on cell` : 'Report feedback'
		});
		composer = '';
		threads = [result.thread, ...threads];
		selectedThreadId = result.thread.id;
		comments = [result.comment];
	}

	async function submitReply(): Promise<void> {
		if (!selectedThreadId) return;
		const text = composer.trim();
		if (!text) return;
		const comment = await replyToThread(selectedThreadId, text);
		comments = [...comments, comment];
		composer = '';
	}

	onMount(() => {
		if (isAuthenticated) void loadThreads();
	});
</script>

{#if isAuthenticated}
	<Button
		variant="outline"
		size="sm"
		class="share-review-toggle no-print"
		onclick={() => {
			open = !open;
			if (open) void loadThreads();
		}}
	>
		<MessageSquare class="h-3.5 w-3.5" />
		Review
	</Button>

	{#if open}
		<aside class="share-review-sidebar no-print" aria-label="Share review">
			<header class="share-review-header">
				<span>Share review</span>
				<button
					type="button"
					class="share-review-close"
					aria-label="Close share review"
					onclick={() => (open = false)}
				>
					<X class="h-4 w-4" />
				</button>
			</header>
			{#if loading}
				<p class="share-review-muted">Loading…</p>
			{:else}
				<div class="share-review-threads">
					{#each threads as thread (thread.id)}
						<button
							type="button"
							class="share-review-thread"
							class:is-active={thread.id === selectedThreadId}
							onclick={async () => {
								selectedThreadId = thread.id;
								await loadComments(thread.id);
							}}
						>
							<span class="share-review-thread-title">{thread.title ?? 'Thread'}</span>
							<span class="share-review-muted">{formatCommentTime(thread.createdAt)}</span>
						</button>
					{/each}
				</div>
				{#if selectedThread}
					<div class="share-review-messages">
						{#each comments as comment (comment.id)}
							<div class="share-review-message">
								<span class="share-review-author">{comment.authorName ?? 'User'}</span>
								<span class="share-review-muted">{formatCommentTime(comment.createdAt)}</span>
								<p>{comment.body}</p>
							</div>
						{/each}
					</div>
				{/if}
				<div class="share-review-composer">
					<Textarea bind:value={composer} rows={3} placeholder="Leave feedback…" class="text-xs" />
					<Button
						size="sm"
						class="mt-1.5 w-full"
						onclick={() => (selectedThread ? submitReply() : submitNewThread())}
					>
						{selectedThread ? 'Reply' : 'Start thread'}
					</Button>
				</div>
			{/if}
		</aside>
	{/if}
{/if}

<style>
	:global(.share-review-toggle) {
		position: fixed;
		bottom: 1.25rem;
		right: 1.25rem;
		z-index: 40;
		gap: 0.35rem;
	}
	.share-review-sidebar {
		position: fixed;
		top: 0;
		right: 0;
		width: min(22rem, 100vw);
		height: 100vh;
		z-index: 50;
		background: var(--background);
		border-left: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		padding: 1rem;
		gap: 0.75rem;
	}
	.share-review-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.share-review-close {
		color: var(--muted-foreground);
	}
	.share-review-threads {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-height: 8rem;
		overflow-y: auto;
	}
	.share-review-thread {
		text-align: left;
		padding: 0.4rem 0.5rem;
		border-radius: 0.35rem;
		border: 1px solid var(--border);
		font-size: 0.75rem;
	}
	.share-review-thread.is-active {
		border-color: var(--primary);
	}
	.share-review-thread-title {
		display: block;
		font-weight: 500;
	}
	.share-review-messages {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.share-review-message p {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
	}
	.share-review-author {
		font-size: 0.72rem;
		font-weight: 600;
		margin-right: 0.35rem;
	}
	.share-review-muted {
		font-size: 0.7rem;
		color: var(--muted-foreground);
	}
	.share-review-composer {
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
</style>
