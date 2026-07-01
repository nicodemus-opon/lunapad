<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Loader2, Copy, RefreshCw, Ban, UploadCloud, History, Undo2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { buildShareSnapshot } from '$lib/services/share-snapshot';
	import {
		findOrphanedFilterWidgets,
		findUnboundFilterTokens
	} from '$lib/services/filter-diagnostics';
	import type { Notebook } from '$lib/stores/notebook.svelte';

	interface ShareVersion {
		version: number;
		notebookName: string;
		createdAt: string;
	}

	function formatRelativeTime(iso: string): string {
		const diffMs = Date.now() - new Date(iso).getTime();
		const mins = Math.round(diffMs / 60_000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hours = Math.round(mins / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.round(hours / 24)}d ago`;
	}

	interface Props {
		open: boolean;
		notebook: Notebook | null;
	}

	let { open = $bindable(), notebook }: Props = $props();

	let loading = $state(false);
	let publishing = $state(false);
	let token = $state<string | null>(null);
	let pollIntervalSeconds = $state(300);
	let requireAuth = $state(false);
	let savedSlug = $state<string | null>(null);
	let slugInput = $state('');
	let slugStatus = $state<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
	let savingSlug = $state(false);
	let slugCheckTimer: ReturnType<typeof setTimeout> | null = null;
	let versions = $state<ShareVersion[]>([]);
	let showVersions = $state(false);
	let rollingBackVersion = $state<number | null>(null);

	const shareUrl = $derived(
		token && typeof window !== 'undefined'
			? `${window.location.origin}/r/${savedSlug || token}`
			: ''
	);
	const unboundTokens = $derived(notebook ? findUnboundFilterTokens(notebook) : []);
	const orphanedWidgets = $derived(notebook ? findOrphanedFilterWidgets(notebook) : []);

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
				pollIntervalSeconds = Math.round((body.share.pollIntervalMs ?? 300_000) / 1000);
				requireAuth = body.share.requireAuth ?? false;
				savedSlug = body.share.slug ?? null;
				slugInput = savedSlug ?? '';
				slugStatus = 'idle';
				void loadVersions(body.share.token);
			}
		} finally {
			loading = false;
		}
	}

	async function loadVersions(shareToken: string): Promise<void> {
		const res = await fetch(`/api/shares/${shareToken}/versions`);
		const body = await res.json();
		versions = body.versions ?? [];
	}

	async function rollback(version: number): Promise<void> {
		if (!token) return;
		rollingBackVersion = version;
		try {
			const res = await fetch(`/api/shares/${token}/versions/${version}/rollback`, {
				method: 'POST'
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error ?? 'Failed to roll back.');
				return;
			}
			toast.success(`Rolled back to v${version}.`);
			void loadVersions(token);
		} finally {
			rollingBackVersion = null;
		}
	}

	function onSlugInput(value: string): void {
		slugInput = value.toLowerCase();
		if (slugCheckTimer) clearTimeout(slugCheckTimer);
		if (slugInput === (savedSlug ?? '')) {
			slugStatus = 'idle';
			return;
		}
		if (slugInput === '') {
			slugStatus = 'idle';
			return;
		}
		slugStatus = 'checking';
		slugCheckTimer = setTimeout(async () => {
			const res = await fetch(
				`/api/shares/check-slug?slug=${encodeURIComponent(slugInput)}&notebookId=${encodeURIComponent(notebook?.id ?? '')}`
			);
			const body = await res.json();
			slugStatus = body.available ? 'available' : slugInput.length < 3 ? 'invalid' : 'taken';
		}, 350);
	}

	async function saveSlug(): Promise<void> {
		if (!notebook) return;
		savingSlug = true;
		try {
			const res = await fetch('/api/shares', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notebookId: notebook.id, slug: slugInput || null })
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error ?? 'Failed to update slug.');
				return;
			}
			savedSlug = body.slug ?? null;
			slugStatus = 'idle';
			toast.success(savedSlug ? 'Custom link saved.' : 'Custom link removed.');
		} finally {
			savingSlug = false;
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
					requireAuth,
					connections: snapshot.connections
				})
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error ?? 'Failed to publish share.');
				return;
			}
			token = body.token;
			savedSlug = body.slug ?? null;
			slugInput = savedSlug ?? '';
			void loadVersions(body.token);
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
		savedSlug = null;
		slugInput = '';
		slugStatus = 'idle';
		token = null;
		versions = [];
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
		void loadVersions(body.token);
		toast.success('New link generated — the old link no longer works.');
	}

	function copyLink(): void {
		if (!shareUrl) return;
		void navigator.clipboard.writeText(shareUrl);
		toast.success('Link copied.');
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm gap-0 overflow-hidden p-0">
		<div class="flex items-center justify-between border-b px-4 py-3">
			<p class="text-xs font-semibold">Share report</p>
		</div>

		<div class="space-y-3 px-4 py-3">
			{#if !loading && (unboundTokens.length > 0 || orphanedWidgets.length > 0)}
				<div
					class="space-y-0.5 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400"
				>
					{#if unboundTokens.length > 0}
						<p>No filter widget for: {unboundTokens.join(', ')}</p>
					{/if}
					{#if orphanedWidgets.length > 0}
						<p>
							Unused filter widget{orphanedWidgets.length > 1 ? 's' : ''}: {orphanedWidgets.join(
								', '
							)}
						</p>
					{/if}
				</div>
			{/if}
			{#if loading}
				<div class="flex items-center justify-center py-6 text-muted-foreground">
					<Loader2 class="h-4 w-4 animate-spin" />
				</div>
			{:else if !token}
				<p class="text-xs text-muted-foreground">
					Publishes a read-only link with no app chrome. Live connections re-run on each view; the
					builtin DuckDB results are captured as a snapshot.
				</p>
				<label class="flex cursor-pointer items-center gap-1.5">
					<input
						type="checkbox"
						class="h-3.5 w-3.5 accent-primary"
						checked={requireAuth}
						onchange={(e) => (requireAuth = (e.target as HTMLInputElement).checked)}
					/>
					<span class="text-[11px] text-muted-foreground">Require login to view</span>
				</label>
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
					<Input class="h-7 flex-1 font-mono text-[11px]" readonly value={shareUrl} />
					<Button
						variant="outline"
						size="sm"
						class="h-7 w-7 shrink-0 p-0"
						onclick={copyLink}
						title="Copy link"
					>
						<Copy class="h-3.5 w-3.5" />
					</Button>
				</div>

				<div class="space-y-1">
					<div class="flex items-center gap-1.5">
						<span class="shrink-0 text-[11px] text-muted-foreground">/r/</span>
						<Input
							class="h-7 flex-1 font-mono text-[11px]"
							placeholder={token ?? ''}
							value={slugInput}
							oninput={(e) => onSlugInput((e.target as HTMLInputElement).value)}
						/>
						<Button
							variant="outline"
							size="sm"
							class="h-7 shrink-0 text-[11px]"
							disabled={savingSlug ||
								slugStatus === 'taken' ||
								slugStatus === 'invalid' ||
								slugInput === (savedSlug ?? '')}
							onclick={saveSlug}
						>
							{#if savingSlug}<Loader2 class="h-3 w-3 animate-spin" />{:else}Save{/if}
						</Button>
					</div>
					{#if slugStatus === 'checking'}
						<p class="text-[11px] text-muted-foreground">Checking availability…</p>
					{:else if slugStatus === 'taken'}
						<p class="text-[11px] text-destructive">That slug is already taken.</p>
					{:else if slugStatus === 'invalid'}
						<p class="text-[11px] text-destructive">
							Lowercase letters, numbers, hyphens — 3+ characters.
						</p>
					{:else if slugStatus === 'available'}
						<p class="text-[11px] text-muted-foreground">Available.</p>
					{/if}
				</div>

				<div class="flex items-center gap-2">
					<span class="shrink-0 text-[11px] text-muted-foreground">Refresh every</span>
					<Select.Root
						type="single"
						value={String(pollIntervalSeconds)}
						onValueChange={(v) => (pollIntervalSeconds = Number(v))}
					>
						<Select.Trigger class="h-7 text-xs">
							{#if pollIntervalSeconds === 60}1 min
							{:else if pollIntervalSeconds === 300}5 min
							{:else if pollIntervalSeconds === 900}15 min
							{:else if pollIntervalSeconds === 1800}30 min
							{:else if pollIntervalSeconds === 3600}1 hr
							{:else if pollIntervalSeconds === 21600}6 hr
							{:else if pollIntervalSeconds === 86400}24 hr
							{:else}{pollIntervalSeconds}s{/if}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="60" class="text-xs">Every 1 min</Select.Item>
							<Select.Item value="300" class="text-xs">Every 5 min</Select.Item>
							<Select.Item value="900" class="text-xs">Every 15 min</Select.Item>
							<Select.Item value="1800" class="text-xs">Every 30 min</Select.Item>
							<Select.Item value="3600" class="text-xs">Every 1 hr</Select.Item>
							<Select.Item value="21600" class="text-xs">Every 6 hr</Select.Item>
							<Select.Item value="86400" class="text-xs">Every 24 hr</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>

				<label class="flex cursor-pointer items-center gap-1.5">
					<input
						type="checkbox"
						class="h-3.5 w-3.5 accent-primary"
						checked={requireAuth}
						onchange={(e) => (requireAuth = (e.target as HTMLInputElement).checked)}
					/>
					<span class="text-[11px] text-muted-foreground">Require login to view</span>
				</label>

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

				{#if versions.length > 0}
					<button
						type="button"
						class="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
						onclick={() => (showVersions = !showVersions)}
					>
						<History class="h-3 w-3" />
						{showVersions ? 'Hide' : 'Show'} version history ({versions.length})
					</button>
					{#if showVersions}
						<div class="max-h-40 space-y-1 overflow-y-auto rounded border p-1.5">
							{#each versions as v (v.version)}
								<div class="flex items-center justify-between gap-2 text-[11px]">
									<span class="text-muted-foreground"
										>v{v.version} · {formatRelativeTime(v.createdAt)}</span
									>
									{#if v.version !== versions[0].version}
										<Button
											variant="outline"
											size="sm"
											class="h-5.5 shrink-0 px-1.5 text-[10px]"
											disabled={rollingBackVersion !== null}
											onclick={() => rollback(v.version)}
										>
											{#if rollingBackVersion === v.version}
												<Loader2 class="h-2.5 w-2.5 animate-spin" />
											{:else}
												<Undo2 class="h-2.5 w-2.5" />
											{/if}
											Roll back
										</Button>
									{:else}
										<span class="shrink-0 text-[10px] text-muted-foreground">current</span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				{/if}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
