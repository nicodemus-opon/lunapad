<script lang="ts">
	import { ChevronRight, ChevronLeft } from '@lucide/svelte';
	import { buildNotebookOutline } from '$lib/services/notebook-outline';
	import { extractPagesFromPmDocument } from '$lib/services/notebook-pm';
	import { cellsToPmDocument } from '$lib/services/notebook-pm';
	import {
		getFolders,
		navigateToOutlineEntry,
		canGoBackPageNav,
		canGoForwardPageNav,
		goBackPageNav,
		goForwardPageNav,
		type Cell
	} from '$lib/stores/notebook.svelte';

	interface Props {
		notebookId: string;
		notebookName: string;
		folderId: string | null;
		cells: Cell[];
	}

	const { notebookId, notebookName, folderId, cells }: Props = $props();

	const folders = $derived(getFolders());
	const folderName = $derived(folders.find((f) => f.id === folderId)?.name ?? null);

	const pages = $derived.by(() => {
		const fromDoc = extractPagesFromPmDocument(cellsToPmDocument(cells));
		if (fromDoc.length) return fromDoc;
		return buildNotebookOutline(cells)
			.filter((e) => e.kind === 'heading' && e.level === 1)
			.map((e) => ({ id: e.id, title: e.label }));
	});

	let activePageId = $state<string | null>(null);

	const crumbs = $derived.by(() => {
		const items: { label: string; onclick?: () => void }[] = [];
		if (folderName) items.push({ label: folderName });
		items.push({ label: notebookName });
		if (activePageId) {
			const page = pages.find((p) => p.id === activePageId);
			if (page) items.push({ label: page.title });
		}
		return items;
	});

	$effect(() => {
		const root = document.querySelector('.notebook-scroll');
		const outline = buildNotebookOutline(cells);
		if (!root || !outline.length) {
			activePageId = null;
			return;
		}

		let observer: IntersectionObserver | null = null;
		const mapped: { id: string; el: Element }[] = [];
		for (const entry of outline) {
			const el = entry.anchorId
				? root.querySelector(`#${CSS.escape(entry.anchorId)}`)
				: root.querySelector(`[data-cell-id="${entry.cellId}"]`);
			if (el) mapped.push({ id: entry.id, el });
		}
		if (!mapped.length) return;

		observer = new IntersectionObserver(
			(observed) => {
				const visible = observed
					.filter((e) => e.isIntersecting)
					.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
				if (!visible.length) return;
				const match = mapped.find((m) => m.el === visible[0].target);
				if (match) activePageId = match.id;
			},
			{ root: root as Element, rootMargin: '-10% 0px -80% 0px', threshold: [0, 0.25] }
		);
		for (const { el } of mapped) observer.observe(el);
		return () => observer?.disconnect();
	});
</script>

{#if crumbs.length > 1}
	<nav
		class="notebook-breadcrumbs mb-4 flex flex-wrap items-center gap-1 text-2xs text-muted-foreground"
		aria-label="Document location"
	>
		<div class="mr-1 flex items-center gap-0.5">
			<button
				type="button"
				class="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted disabled:opacity-30"
				disabled={!canGoBackPageNav()}
				title="Back (⌘[)"
				aria-label="Back in page history"
				onclick={() => goBackPageNav()}
			>
				<ChevronLeft class="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				class="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted disabled:opacity-30"
				disabled={!canGoForwardPageNav()}
				title="Forward (⌘])"
				aria-label="Forward in page history"
				onclick={() => goForwardPageNav()}
			>
				<ChevronRight class="h-3.5 w-3.5" />
			</button>
		</div>
		{#each crumbs as crumb, i (crumb.label + i)}
			{#if i > 0}
				<ChevronRight class="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
			{/if}
			{#if crumb.onclick}
				<button
					type="button"
					class="max-w-[12rem] truncate rounded px-0.5 hover:text-foreground"
					onclick={crumb.onclick}
				>
					{crumb.label}
				</button>
			{:else}
				<span class="max-w-[12rem] truncate {i === crumbs.length - 1 ? 'text-foreground' : ''}">
					{crumb.label}
				</span>
			{/if}
		{/each}
	</nav>
{/if}

{#if pages.length > 0}
	<div class="mb-3 flex flex-wrap gap-1" role="list" aria-label="Pages in this notebook">
		{#each pages as page (page.id)}
			<button
				type="button"
				role="listitem"
				class="rounded-full border px-2 py-0.5 text-2xs transition-colors {activePageId === page.id
					? 'border-primary/40 bg-primary/10 text-foreground'
					: 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground'}"
				onclick={() => {
					const entry = buildNotebookOutline(cells).find((e) => e.id === page.id);
					if (entry) navigateToOutlineEntry(notebookId, entry);
				}}
			>
				{page.title}
			</button>
		{/each}
	</div>
{/if}
