<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import {
		Loader2,
		Copy,
		RefreshCw,
		Ban,
		UploadCloud,
		History,
		Undo2,
		ExternalLink,
		LayoutGrid,
		Save,
		ChevronRight
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { buildShareSnapshot } from '$lib/services/share-snapshot';
	import {
		findOrphanedFilterWidgets,
		findUnboundFilterTokens,
		findUncollapsedDataCells,
		findEmptyQueryResults,
		findDuckDBFilterWarnings
	} from '$lib/services/filter-diagnostics';
	import { getCellConnection } from '$lib/stores/notebook.svelte';
	import type { Notebook } from '$lib/stores/notebook.svelte';

	interface ShareVersion {
		version: number;
		notebookName: string;
		createdAt: string;
	}

	interface Props {
		open: boolean;
		notebook: Notebook | null;
		onOpenSites?: () => void;
	}

	let { open = $bindable(), notebook, onOpenSites }: Props = $props();

	let loading = $state(false);
	let publishing = $state(false);
	let savingSettings = $state(false);
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
	let showAdvanced = $state(false);
	let rollingBackVersion = $state<number | null>(null);
	let lastUpdatedAt = $state<string | null>(null);
	let expiresAt = $state<string | null>(null);
	let refreshScheduleHours = $state<string>('0');

	const shareUrl = $derived(
		token && typeof window !== 'undefined'
			? `${window.location.origin}/r/${savedSlug || token}`
			: ''
	);
	const unboundTokens = $derived(notebook ? findUnboundFilterTokens(notebook) : []);
	const orphanedWidgets = $derived(notebook ? findOrphanedFilterWidgets(notebook) : []);
	const uncollapsedData = $derived(notebook ? findUncollapsedDataCells(notebook) : []);
	const emptyResults = $derived(notebook ? findEmptyQueryResults(notebook) : []);
	const duckdbFilterWarn = $derived(notebook ? findDuckDBFilterWarnings(notebook) : false);

	const publishSummary = $derived.by(() => {
		if (!notebook) return null;
		const snapshot = buildShareSnapshot(notebook);
		const live = snapshot.cells.filter((c) => c.isLive).length;
		const frozen = snapshot.cells.filter((c) => c.cellType === 'query' && !c.isLive).length;
		const connections = [
			...new Set(
				notebook.cells
					.filter((c) => c.cellType === 'query')
					.map((c) => getCellConnection(c).name ?? getCellConnection(c).id)
			)
		];
		return { live, frozen, connections, cellCount: snapshot.cells.length };
	});

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
				expiresAt = body.share.expiresAt ?? null;
				savedSlug = body.share.slug ?? null;
				slugInput = savedSlug ?? '';
				lastUpdatedAt = body.share.updatedAt ?? null;
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

	async function saveSettings(): Promise<void> {
		if (!notebook) return;
		savingSettings = true;
		try {
			const res = await fetch('/api/shares', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					notebookId: notebook.id,
					pollIntervalMs: pollIntervalSeconds * 1000,
					requireAuth,
					expiresAt: expiresAt || null
				})
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error ?? 'Failed to save settings.');
				return;
			}
			if (refreshScheduleHours !== '0') {
				await fetch('/api/shares/refresh-schedule', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						notebookId: notebook.id,
						intervalMs: Number(refreshScheduleHours) * 3_600_000
					})
				});
			}
			toast.success('Settings saved.');
		} finally {
			savingSettings = false;
		}
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
			await saveSettings();
			toast.success(wasAlreadyPublished ? 'Report updated.' : 'Report published.');
		} finally {
			publishing = false;
		}
	}

	function previewPublish(): void {
		if (!shareUrl) return;
		window.open(shareUrl, '_blank');
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

	function copyEmbed(): void {
		if (!shareUrl) return;
		const embedUrl = shareUrl.includes('?') ? `${shareUrl}&embed=1` : `${shareUrl}?embed=1`;
		const snippet = `<iframe src="${embedUrl}" width="100%" height="600" frameborder="0" title="Lunapad report"></iframe>`;
		void navigator.clipboard.writeText(snippet);
		toast.success('Embed snippet copied.');
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<Dialog.Title>Share report</Dialog.Title>
		</Dialog.Header>

		<div class="max-h-[75vh] space-y-3 overflow-y-auto px-4 py-3">
			{#if publishSummary}
				<div class="rounded border bg-muted/30 p-2 text-2xs text-muted-foreground">
					<p>
						{publishSummary.cellCount} cells · {publishSummary.live} live · {publishSummary.frozen}
						frozen
					</p>
					{#if publishSummary.connections.length}
						<p>Connections: {publishSummary.connections.join(', ')}</p>
					{/if}
					{#if lastUpdatedAt}
						<p>Last published: {new Date(lastUpdatedAt).toLocaleString()}</p>
					{/if}
				</div>
			{/if}

			{#if !loading && (unboundTokens.length > 0 || orphanedWidgets.length > 0 || uncollapsedData.length > 0 || emptyResults.length > 0 || duckdbFilterWarn)}
				<div
					class="space-y-0.5 rounded border border-warning/30 bg-warning/10 p-2 text-2xs text-warning"
				>
					<p class="font-medium">Pre-publish checklist</p>
					{#if unboundTokens.length > 0}
						<p>No filter widget for: {unboundTokens.join(', ')}</p>
					{/if}
					{#if orphanedWidgets.length > 0}
						<p>Unused filter widgets: {orphanedWidgets.join(', ')}</p>
					{/if}
					{#if uncollapsedData.length > 0}
						<p>
							Data cells shown twice (collapse or auto-hide on publish): {uncollapsedData.join(
								', '
							)}
						</p>
					{/if}
					{#if emptyResults.length > 0}
						<p>Empty query results: {emptyResults.join(', ')}</p>
					{/if}
					{#if duckdbFilterWarn}
						<p>DuckDB + filters: viewers cannot refresh filtered DuckDB cells after publish.</p>
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
					<span class="text-2xs text-muted-foreground">Require login to view</span>
				</label>
				<Button
					variant="outline"
					size="sm"
					class="w-full"
					disabled={!shareUrl}
					onclick={previewPublish}
				>
					<ExternalLink class="h-3.5 w-3.5" /> Preview (after publish)
				</Button>
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
					<Input class="h-7 flex-1 font-mono text-2xs" readonly value={shareUrl} />
					<Button variant="outline" size="sm" class="h-7 w-7 shrink-0 p-0" onclick={copyLink}>
						<Copy class="h-3.5 w-3.5" />
					</Button>
				</div>

				<div class="flex gap-1.5">
					<Button variant="outline" size="sm" class="flex-1 text-2xs" onclick={previewPublish}>
						<ExternalLink class="h-3 w-3" /> Preview
					</Button>
					{#if onOpenSites}
						<Button variant="outline" size="sm" class="flex-1 text-2xs" onclick={onOpenSites}>
							<LayoutGrid class="h-3 w-3" /> Add to site…
						</Button>
					{/if}
					<Button variant="outline" size="sm" class="flex-1 text-2xs" onclick={copyEmbed}>
						Embed
					</Button>
				</div>

				<!-- Advanced settings (progressive disclosure) -->
				<button
					type="button"
					class="flex w-full items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground"
					onclick={() => (showAdvanced = !showAdvanced)}
				>
					<ChevronRight class="h-3 w-3 transition-transform {showAdvanced ? 'rotate-90' : ''}" />
					Advanced settings
				</button>

				{#if showAdvanced}
					<div class="space-y-3">
						<div class="space-y-1">
							<div class="flex items-center gap-1.5">
								<span class="shrink-0 text-2xs text-muted-foreground">/r/</span>
								<Input
									class="h-7 flex-1 font-mono text-2xs"
									placeholder={token ?? ''}
									value={slugInput}
									oninput={(e) => onSlugInput((e.target as HTMLInputElement).value)}
								/>
								<Button
									variant="outline"
									size="sm"
									class="h-7 shrink-0 text-2xs"
									disabled={savingSlug ||
										slugStatus === 'taken' ||
										slugStatus === 'invalid' ||
										slugInput === (savedSlug ?? '')}
									onclick={saveSlug}
								>
									{#if savingSlug}<Loader2 class="h-3 w-3 animate-spin" />{:else}Save{/if}
								</Button>
							</div>
						</div>

						<div class="grid grid-cols-2 gap-2">
							<div>
								<span class="text-2xs text-muted-foreground">Refresh every</span>
								<Select.Root
									type="single"
									value={String(pollIntervalSeconds)}
									onValueChange={(v) => (pollIntervalSeconds = Number(v))}
								>
									<Select.Trigger class="mt-0.5 h-7 text-xs"
										>Poll {pollIntervalSeconds}s</Select.Trigger
									>
									<Select.Content>
										<Select.Item value="60" class="text-xs">1 min</Select.Item>
										<Select.Item value="300" class="text-xs">5 min</Select.Item>
										<Select.Item value="900" class="text-xs">15 min</Select.Item>
										<Select.Item value="3600" class="text-xs">1 hr</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>
							<div>
								<span class="text-2xs text-muted-foreground">Link expires</span>
								<Select.Root
									type="single"
									value={expiresAt ? 'custom' : 'never'}
									onValueChange={(v) => {
										if (v === 'never') expiresAt = null;
										else if (v === '7d') expiresAt = new Date(Date.now() + 7 * 864e5).toISOString();
										else if (v === '30d')
											expiresAt = new Date(Date.now() + 30 * 864e5).toISOString();
									}}
								>
									<Select.Trigger class="mt-0.5 h-7 text-xs">
										{expiresAt ? 'Custom' : 'Never'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="never" class="text-xs">Never</Select.Item>
										<Select.Item value="7d" class="text-xs">7 days</Select.Item>
										<Select.Item value="30d" class="text-xs">30 days</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>
						</div>

						<div>
							<span class="text-2xs text-muted-foreground">Auto-refresh DuckDB snapshot</span>
							<Select.Root
								type="single"
								value={refreshScheduleHours}
								onValueChange={(v) => (refreshScheduleHours = v)}
							>
								<Select.Trigger class="mt-0.5 h-7 text-xs">
									{refreshScheduleHours === '0'
										? 'Off'
										: refreshScheduleHours === '1'
											? 'Hourly'
											: refreshScheduleHours === '24'
												? 'Daily'
												: 'Weekly'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="0" class="text-xs">Off</Select.Item>
									<Select.Item value="1" class="text-xs">Hourly</Select.Item>
									<Select.Item value="24" class="text-xs">Daily</Select.Item>
									<Select.Item value="168" class="text-xs">Weekly</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				{/if}

				<div class="flex gap-1.5">
					<Button
						variant="outline"
						size="sm"
						class="flex-1"
						disabled={savingSettings}
						onclick={saveSettings}
					>
						{#if savingSettings}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<Save
								class="h-3.5 w-3.5"
							/>{/if}
						Save settings
					</Button>
					<Button
						variant="outline"
						size="sm"
						class="flex-1"
						disabled={publishing}
						onclick={publish}
					>
						{#if publishing}<Loader2 class="h-3.5 w-3.5 animate-spin" />{:else}<UploadCloud
								class="h-3.5 w-3.5"
							/>{/if}
						Update snapshot
					</Button>
				</div>

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
						class="flex w-full items-center gap-1.5 text-2xs text-muted-foreground hover:text-foreground"
						onclick={() => (showVersions = !showVersions)}
					>
						<History class="h-3 w-3" />
						{showVersions ? 'Hide' : 'Show'} version history ({versions.length})
					</button>
					{#if showVersions}
						<div class="max-h-40 space-y-1 overflow-y-auto rounded border p-1.5">
							{#each versions as v (v.version)}
								<div class="flex items-center justify-between gap-2 text-2xs">
									<span class="text-muted-foreground"
										>v{v.version} · {new Date(v.createdAt).toLocaleString()}</span
									>
									{#if v.version !== versions[0].version}
										<Button
											variant="outline"
											size="sm"
											class="h-5.5 shrink-0 px-1.5 text-3xs"
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
										<span class="shrink-0 text-3xs text-muted-foreground">current</span>
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
