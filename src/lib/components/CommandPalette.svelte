<script lang="ts">
	import { fly } from 'svelte/transition';
	import { Search, FileText, Table2, Zap } from '@lucide/svelte';
	import {
		getNotebooks,
		setActiveTab,
		addCellAfter,
		getLastCellId,
		openNotebookTabAtCell,
		runAll
	} from '$lib/stores/notebook.svelte';

	interface Props {
		open: boolean;
		onClose: () => void;
		onToggleSidebar?: () => void;
	}

	let { open = $bindable(), onClose, onToggleSidebar }: Props = $props();

	let query = $state('');
	let selectedIndex = $state(0);
	let inputEl: HTMLInputElement | undefined = $state();

	type PaletteItem =
		| { kind: 'notebook'; id: string; label: string }
		| { kind: 'cell'; id: string; notebookId: string; label: string; sub: string }
		| { kind: 'action'; label: string; sub: string; run: () => void };

	const notebooks = $derived(getNotebooks());

	const allItems = $derived<PaletteItem[]>([
		...notebooks.map((nb) => ({
			kind: 'notebook' as const,
			id: nb.id,
			label: nb.name || 'Untitled notebook'
		})),
		...notebooks.flatMap((nb) =>
			nb.cells
				.filter((c) => c.cellType === 'query' && c.outputName)
				.map((c) => ({
					kind: 'cell' as const,
					id: c.id,
					notebookId: nb.id,
					label: c.outputName,
					sub: nb.name || 'Untitled'
				}))
		),
		{
			kind: 'action',
			label: 'Run all cells',
			sub: '⌘⇧R',
			run: () => {
				void runAll();
				close();
			}
		},
		{
			kind: 'action',
			label: 'Toggle sidebar',
			sub: '⌘B',
			run: () => {
				onToggleSidebar?.();
				close();
			}
		},
		{
			kind: 'action',
			label: 'New cell',
			sub: '⌘⇧↵',
			run: () => {
				const lastId = getLastCellId();
				if (lastId) addCellAfter(lastId);
				close();
			}
		}
	]);

	const filtered = $derived.by(() => {
		if (!query.trim()) return allItems.slice(0, 12);
		const q = query.toLowerCase();
		return allItems.filter((item) => item.label.toLowerCase().includes(q)).slice(0, 12);
	});

	$effect(() => {
		if (open) {
			query = '';
			selectedIndex = 0;
			setTimeout(() => inputEl?.focus(), 0);
		}
	});

	$effect(() => {
		// Reset selection when filter changes
		void filtered;
		selectedIndex = 0;
	});

	function close() {
		open = false;
		onClose();
	}

	function selectItem(item: PaletteItem) {
		if (item.kind === 'notebook') {
			setActiveTab(item.id);
		} else if (item.kind === 'cell') {
			openNotebookTabAtCell(item.notebookId, item.id);
		} else {
			item.run();
			return;
		}
		close();
	}

	function onKeydown(e: KeyboardEvent) {
		const items = filtered;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const item = filtered[selectedIndex];
			if (item) selectItem(item);
		} else if (e.key === 'Escape') {
			close();
		}
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-(--z-overlay) bg-background/70 backdrop-blur-[3px]"
		onclick={close}
		role="presentation"
	></div>

	<!-- Palette panel -->
	<div
		class="surface-raised fixed top-[20vh] left-1/2 z-(--z-modal) w-full max-w-md -translate-x-1/2 overflow-hidden rounded-xl border border-border/70 bg-popover text-popover-foreground shadow-xl outline-none"
		transition:fly={{ y: -8, duration: 220 }}
		role="dialog"
		aria-label="Command palette"
		tabindex="-1"
		onkeydown={onKeydown}
	>
		<!-- Search input -->
		<div class="flex items-center gap-2.5 border-b border-border/40 px-3.5 py-3">
			<Search class="h-4 w-4 shrink-0 text-muted-foreground" />
			<input
				bind:this={inputEl}
				bind:value={query}
				placeholder="Search notebooks, cells, actions…"
				class="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
			/>
			<kbd
				class="rounded border border-border/40 px-1 py-0.5 font-mono text-2xs text-muted-foreground/50"
				>esc</kbd
			>
		</div>

		<!-- Results list -->
		<div class="max-h-72 overflow-y-auto py-1.5">
			{#if filtered.length === 0}
				<p class="px-4 py-6 text-center text-sm text-muted-foreground">No results for "{query}"</p>
			{:else}
				{#each filtered as item, i (item.label + i)}
					<button
						class="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors {i ===
						selectedIndex
							? 'bg-primary/14 text-foreground ring-1 ring-primary/18 ring-inset'
							: 'text-foreground/80 hover:bg-muted/60 hover:text-foreground'}"
						onclick={() => selectItem(item)}
						onmouseenter={() => (selectedIndex = i)}
					>
						{#if item.kind === 'notebook'}
							<FileText class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="flex-1 truncate font-medium">{item.label}</span>
							<span class="font-mono text-2xs text-muted-foreground/50">notebook</span>
						{:else if item.kind === 'cell'}
							<Table2 class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="flex-1 truncate font-mono text-xs">{item.label}</span>
							<span class="max-w-24 truncate text-2xs text-muted-foreground/50">{item.sub}</span>
						{:else}
							<Zap class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span class="flex-1 truncate">{item.label}</span>
							<kbd class="font-mono text-2xs text-muted-foreground/50">{item.sub}</kbd>
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	</div>
{/if}
