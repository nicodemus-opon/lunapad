<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { toast } from 'svelte-sonner';
	import { Plus, Trash2, ArrowUp, ArrowDown, ExternalLink, GripVertical } from '@lucide/svelte';

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
		notebookId: string | null;
	}
	interface ActiveShare {
		notebookId: string;
		notebookName: string;
		token: string;
		slug: string | null;
		updatedAt?: string;
	}

	interface Props {
		open: boolean;
	}

	let { open = $bindable() }: Props = $props();

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

	$effect(() => {
		if (open) {
			void loadSites();
			void loadActiveShares();
		}
	});

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

	async function addPage(): Promise<void> {
		if (!selectedSiteId || !newPageShareToken || !newPageSlug || !newPageNavLabel) return;
		const share = activeShares.find((s) => s.token === newPageShareToken);
		const res = await fetch(`/api/sites/${selectedSiteId}/pages`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				pageSlug: newPageSlug.trim(),
				navLabel: newPageNavLabel.trim(),
				shareToken: newPageShareToken,
				notebookId: share?.notebookId
			})
		});
		const body = await res.json();
		if (!res.ok) {
			toast.error(body.error ?? 'Failed to add page.');
			return;
		}
		newPageShareToken = '';
		newPageSlug = '';
		newPageNavLabel = '';
		await loadPages(selectedSiteId);
		toast.success('Page added.');
	}

	async function removePage(pageId: number): Promise<void> {
		if (!selectedSiteId) return;
		await fetch(`/api/sites/${selectedSiteId}/pages/${pageId}`, { method: 'DELETE' });
		await loadPages(selectedSiteId);
	}

	async function movePage(pageId: number, direction: -1 | 1): Promise<void> {
		const idx = pages.findIndex((p) => p.id === pageId);
		const swapIdx = idx + direction;
		if (idx < 0 || swapIdx < 0 || swapIdx >= pages.length || !selectedSiteId) return;
		const ordered = [...pages];
		[ordered[idx], ordered[swapIdx]] = [ordered[swapIdx], ordered[idx]];
		await fetch(`/api/sites/${selectedSiteId}/pages`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ orderedPageIds: ordered.map((p) => p.id) })
		});
		await loadPages(selectedSiteId);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] max-w-2xl gap-0 overflow-hidden p-0">
		<div class="border-b px-4 py-3">
			<p class="text-sm font-semibold">Sites</p>
			<p class="text-xs text-muted-foreground">Bundle published reports into multi-page sites.</p>
		</div>
		<div class="grid max-h-[70vh] grid-cols-2 gap-0 overflow-hidden">
			<div class="space-y-3 overflow-y-auto border-r p-3">
				<p class="text-xs font-medium">Your sites</p>
				{#each sites as site (site.id)}
					<button
						type="button"
						class="flex w-full items-center justify-between rounded border px-2 py-1.5 text-left text-xs"
						class:border-primary={selectedSiteId === site.id}
						onclick={() => selectSite(site.id)}
					>
						<span>{site.name}</span>
						<Button
							variant="ghost"
							size="sm"
							class="h-6 w-6 p-0"
							onclick={(e) => {
								e.stopPropagation();
								void deleteSite(site.id);
							}}
						>
							<Trash2 class="h-3 w-3" />
						</Button>
					</button>
				{/each}
				<div class="space-y-1.5 border-t pt-2">
					<Input bind:value={newSiteSlug} placeholder="site-slug" class="h-7 text-xs" />
					<Input bind:value={newSiteName} placeholder="Display name" class="h-7 text-xs" />
					<Button size="sm" class="w-full" onclick={createSite}>
						<Plus class="h-3.5 w-3.5" /> New site
					</Button>
				</div>
			</div>
			<div class="space-y-3 overflow-y-auto p-3">
				{#if selectedSite}
					<div class="flex items-center justify-between gap-2">
						<p class="text-xs font-medium">{selectedSite.name}</p>
						<a
							href="/s/{selectedSite.slug}"
							target="_blank"
							class="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
						>
							Open site <ExternalLink class="h-3 w-3" />
						</a>
					</div>
					<div class="space-y-1">
						{#each pages as page (page.id)}
							<div class="flex items-center gap-1 rounded border px-2 py-1 text-2xs">
								<GripVertical class="h-3 w-3 text-muted-foreground" />
								<span class="flex-1">{page.navLabel}</span>
								<Button
									variant="ghost"
									size="sm"
									class="h-6 w-6 p-0"
									onclick={() => movePage(page.id, -1)}
								>
									<ArrowUp class="h-3 w-3" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									class="h-6 w-6 p-0"
									onclick={() => movePage(page.id, 1)}
								>
									<ArrowDown class="h-3 w-3" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									class="h-6 w-6 p-0"
									onclick={() => removePage(page.id)}
								>
									<Trash2 class="h-3 w-3" />
								</Button>
							</div>
						{/each}
					</div>
					<div class="space-y-1.5 border-t pt-2">
						<Select.Root type="single" bind:value={newPageShareToken}>
							<Select.Trigger class="h-7 text-xs">
								{activeShares.find((s) => s.token === newPageShareToken)?.notebookName ??
									'Pick published report'}
							</Select.Trigger>
							<Select.Content>
								{#each activeShares as share (share.token)}
									<Select.Item value={share.token} class="text-xs">{share.notebookName}</Select.Item
									>
								{/each}
							</Select.Content>
						</Select.Root>
						<Input bind:value={newPageSlug} placeholder="page-slug" class="h-7 text-xs" />
						<Input bind:value={newPageNavLabel} placeholder="Nav label" class="h-7 text-xs" />
						<Button size="sm" class="w-full" onclick={addPage}>Add page</Button>
					</div>
				{:else}
					<p class="text-xs text-muted-foreground">Select a site to manage pages.</p>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
