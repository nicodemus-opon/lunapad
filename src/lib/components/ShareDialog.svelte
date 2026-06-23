<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Loader2, Copy, RefreshCw, Ban, UploadCloud } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { buildShareSnapshot } from '$lib/services/share-snapshot';
	import type { Notebook } from '$lib/stores/notebook.svelte';

	interface Props {
		open: boolean;
		notebook: Notebook | null;
	}

	let { open = $bindable(), notebook }: Props = $props();

	let loading = $state(false);
	let publishing = $state(false);
	let token = $state<string | null>(null);
	let pollIntervalSeconds = $state(30);

	const shareUrl = $derived(token && typeof window !== 'undefined' ? `${window.location.origin}/r/${token}` : '');

	$effect(() => {
		if (open && notebook) void loadShareState(notebook.id);
	});

	async function loadShareState(notebookId: string): Promise<void> {
		loading = true;
		token = null;
		try {
			const res = await fetch(`/api/shares?notebookId=${encodeURIComponent(notebookId)}`);
			const body = await res.json();
			if (body.share) {
				token = body.share.token;
				pollIntervalSeconds = Math.round((body.share.pollIntervalMs ?? 30_000) / 1000);
			}
		} finally {
			loading = false;
		}
	}

	async function publish(): Promise<void> {
		if (!notebook) return;
		const wasAlreadyPublished = token !== null;
		publishing = true;
		try {
			const snapshot = buildShareSnapshot(notebook);
			const res = await fetch('/api/shares', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					notebookId: notebook.id,
					notebookName: notebook.name,
					snapshot: { cells: snapshot.cells, reportView: snapshot.reportView },
					pollIntervalMs: pollIntervalSeconds * 1000,
					connections: snapshot.connections
				})
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error ?? 'Failed to publish share.');
				return;
			}
			token = body.token;
			toast.success(wasAlreadyPublished ? 'Report updated.' : 'Report published.');
		} finally {
			publishing = false;
		}
	}

	async function revoke(): Promise<void> {
		if (!notebook) return;
		await fetch('/api/shares', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ notebookId: notebook.id })
		});
		token = null;
		toast.success('Share link revoked.');
	}

	async function regenerate(): Promise<void> {
		if (!notebook) return;
		const res = await fetch('/api/shares/regenerate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ notebookId: notebook.id })
		});
		const body = await res.json();
		if (!res.ok) {
			toast.error(body.error ?? 'Failed to regenerate link.');
			return;
		}
		token = body.token;
		toast.success('New link generated — the old link no longer works.');
	}

	function copyLink(): void {
		if (!shareUrl) return;
		void navigator.clipboard.writeText(shareUrl);
		toast.success('Link copied.');
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm p-0 gap-0 overflow-hidden">
		<div class="flex items-center justify-between border-b px-4 py-3">
			<p class="text-xs font-semibold">Share report</p>
		</div>

		<div class="space-y-3 px-4 py-3">
			{#if loading}
				<div class="flex items-center justify-center py-6 text-muted-foreground">
					<Loader2 class="h-4 w-4 animate-spin" />
				</div>
			{:else if !token}
				<p class="text-xs text-muted-foreground">
					Publishes a read-only link with no app chrome. Live connections re-run on each
					view; the builtin DuckDB results are captured as a snapshot.
				</p>
				<Button size="sm" class="w-full" disabled={publishing} onclick={publish}>
					{#if publishing}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						<UploadCloud class="h-3.5 w-3.5" />
					{/if}
					Publish
				</Button>
			{:else}
				<div class="flex items-center gap-1.5">
					<Input class="h-7 flex-1 text-[11px] font-mono" readonly value={shareUrl} />
					<Button variant="outline" size="sm" class="h-7 w-7 shrink-0 p-0" onclick={copyLink} title="Copy link">
						<Copy class="h-3.5 w-3.5" />
					</Button>
				</div>

				<div class="flex items-center gap-2">
					<span class="shrink-0 text-[11px] text-muted-foreground">Refresh every</span>
					<Input
						type="number"
						min="5"
						class="h-7 text-xs"
						value={String(pollIntervalSeconds)}
						oninput={(e) => (pollIntervalSeconds = Number((e.target as HTMLInputElement).value) || 30)}
					/>
					<span class="shrink-0 text-[11px] text-muted-foreground">sec</span>
				</div>

				<Button variant="outline" size="sm" class="w-full" disabled={publishing} onclick={publish}>
					{#if publishing}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						<UploadCloud class="h-3.5 w-3.5" />
					{/if}
					Update snapshot
				</Button>

				<div class="flex gap-1.5">
					<Button variant="outline" size="sm" class="flex-1" onclick={regenerate}>
						<RefreshCw class="h-3.5 w-3.5" /> Regenerate link
					</Button>
					<Button variant="outline" size="sm" class="flex-1 text-destructive" onclick={revoke}>
						<Ban class="h-3.5 w-3.5" /> Revoke
					</Button>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
