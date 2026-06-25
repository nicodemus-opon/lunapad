<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import { Plus, Trash2, ArrowUp, ArrowDown, ExternalLink } from '@lucide/svelte';

	interface SiteRecord {
		id: string;
		slug: string;
		name: string;
		requireAuth: boolean;
	}
	interface SitePageRecord {
		id: number;
		pageSlug: string;
		navLabel: string;
		shareToken: string;
	}
	interface ActiveShare {
		notebookId: string;
		notebookName: string;
		token: string;
		slug: string | null;
	}

	let sites = $state<SiteRecord[]>([]);
	let activeShares = $state<ActiveShare[]>([]);
	let selectedSiteId = $state<string | null>(null);
	let pages = $state<SitePageRecord[]>([]);

	let newSiteSlug = $state('');
	let newSiteName = $state('');

	let newPageShareToken = $state('');
	let newPageSlug = $state('');
	let newPageNavLabel = $state('');

	const selectedSite = $derived(sites.find((s) => s.id === selectedSiteId) ?? null);

	async function loadSites(): Promise<void> {
		const res = await fetch('/api/sites');
		const body = await res.json();
		sites = body.sites ?? [];
	}

	async function loadActiveShares(): Promise<void> {
		const res = await fetch('/api/shares');
		const body = await res.json();
		activeShares = body.shares ?? [];
	}

	async function loadPages(siteId: string): Promise<void> {
		const res = await fetch(`/api/sites/${siteId}`);
		const body = await res.json();
		pages = body.pages ?? [];
	}

	function selectSite(id: string): void {
		selectedSiteId = id;
		void loadPages(id);
	}

	async function createSite(): Promise<void> {
		if (!newSiteSlug.trim() || !newSiteName.trim()) return;
		const res = await fetch('/api/sites', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ slug: newSiteSlug.trim(), name: newSiteName.trim() })
		});
		const body = await res.json();
		if (!res.ok) {
			toast.error(body.error ?? 'Failed to create site.');
			return;
		}
		newSiteSlug = '';
		newSiteName = '';
		await loadSites();
		selectSite(body.site.id);
		toast.success('Site created.');
	}

	async function deleteSite(id: string): Promise<void> {
		await fetch(`/api/sites/${id}`, { method: 'DELETE' });
		if (selectedSiteId === id) {
			selectedSiteId = null;
			pages = [];
		}
		await loadSites();
		toast.success('Site deleted.');
	}

	async function toggleRequireAuth(site: SiteRecord): Promise<void> {
		await fetch(`/api/sites/${site.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ requireAuth: !site.requireAuth })
		});
		await loadSites();
	}

	async function addPage(): Promise<void> {
		if (!selectedSiteId || !newPageShareToken || !newPageSlug.trim() || !newPageNavLabel.trim())
			return;
		const res = await fetch(`/api/sites/${selectedSiteId}/pages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				pageSlug: newPageSlug.trim(),
				navLabel: newPageNavLabel.trim(),
				shareToken: newPageShareToken
			})
		});
		const body = await res.json();
		if (!res.ok) {
			toast.error(body.error ?? 'Failed to add page.');
			return;
		}
		newPageSlug = '';
		newPageNavLabel = '';
		newPageShareToken = '';
		await loadPages(selectedSiteId);
		toast.success('Page added.');
	}

	async function removePage(pageId: number): Promise<void> {
		if (!selectedSiteId) return;
		await fetch(`/api/sites/${selectedSiteId}/pages/${pageId}`, { method: 'DELETE' });
		await loadPages(selectedSiteId);
	}

	async function movePage(index: number, direction: -1 | 1): Promise<void> {
		if (!selectedSiteId) return;
		const target = index + direction;
		if (target < 0 || target >= pages.length) return;
		const next = [...pages];
		[next[index], next[target]] = [next[target], next[index]];
		pages = next;
		await fetch(`/api/sites/${selectedSiteId}/pages`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ orderedPageIds: next.map((p) => p.id) })
		});
	}

	void loadSites();
	void loadActiveShares();
</script>

<div class="mx-auto max-w-3xl space-y-6 px-6 py-10">
	<h1 class="text-lg font-semibold">Sites</h1>
	<p class="text-sm text-muted-foreground">
		Group several published reports under one base path with shared navigation.
	</p>

	<div class="flex gap-1.5">
		<Input placeholder="slug (e.g. analytics)" bind:value={newSiteSlug} class="h-8 text-sm" />
		<Input placeholder="Site name" bind:value={newSiteName} class="h-8 text-sm" />
		<Button size="sm" onclick={createSite}><Plus class="h-3.5 w-3.5" /> Create</Button>
	</div>

	<div class="grid grid-cols-[14rem_1fr] gap-6">
		<div class="space-y-1">
			{#each sites as site (site.id)}
				<button
					type="button"
					class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
					class:bg-muted={site.id === selectedSiteId}
					onclick={() => selectSite(site.id)}
				>
					<span>{site.name}</span>
					<a
						href={`/s/${site.slug}`}
						target="_blank"
						rel="noreferrer"
						onclick={(e) => e.stopPropagation()}
					>
						<ExternalLink class="h-3 w-3 text-muted-foreground" />
					</a>
				</button>
			{/each}
		</div>

		{#if selectedSite}
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<span class="text-sm font-medium">/s/{selectedSite.slug}</span>
					<Button
						variant="outline"
						size="sm"
						class="text-destructive"
						onclick={() => deleteSite(selectedSite.id)}
					>
						<Trash2 class="h-3.5 w-3.5" /> Delete site
					</Button>
				</div>
				<label class="flex cursor-pointer items-center gap-1.5">
					<input
						type="checkbox"
						class="h-3.5 w-3.5 accent-primary"
						checked={selectedSite.requireAuth}
						onchange={() => toggleRequireAuth(selectedSite)}
					/>
					<span class="text-xs text-muted-foreground">Require login to view this site</span>
				</label>

				<div class="space-y-1">
					{#each pages as page, i (page.id)}
						<div class="flex items-center gap-1.5 rounded border px-2 py-1 text-sm">
							<div class="flex flex-col">
								<button
									type="button"
									class="disabled:opacity-30"
									disabled={i === 0}
									onclick={() => movePage(i, -1)}
								>
									<ArrowUp class="h-3 w-3" />
								</button>
								<button
									type="button"
									class="disabled:opacity-30"
									disabled={i === pages.length - 1}
									onclick={() => movePage(i, 1)}
								>
									<ArrowDown class="h-3 w-3" />
								</button>
							</div>
							<span class="flex-1"
								>{page.navLabel} <span class="text-muted-foreground">/{page.pageSlug}</span></span
							>
							<Button
								variant="outline"
								size="sm"
								class="h-6 px-1.5 text-destructive"
								onclick={() => removePage(page.id)}
							>
								<Trash2 class="h-3 w-3" />
							</Button>
						</div>
					{/each}
				</div>

				<div class="space-y-1.5 rounded border p-2">
					<select
						bind:value={newPageShareToken}
						class="h-7 w-full rounded border bg-transparent px-2 text-xs"
					>
						<option value="">Select a published report…</option>
						{#each activeShares as share (share.token)}
							<option value={share.token}>{share.notebookName}</option>
						{/each}
					</select>
					<div class="flex gap-1.5">
						<Input placeholder="page slug" bind:value={newPageSlug} class="h-7 text-xs" />
						<Input placeholder="nav label" bind:value={newPageNavLabel} class="h-7 text-xs" />
						<Button size="sm" class="h-7 shrink-0" onclick={addPage}
							><Plus class="h-3 w-3" /> Add page</Button
						>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
