<script lang="ts">
	import type { SlashCommand } from '$lib/services/markdown-format';
	import type { Component } from 'svelte';
	import {
		Heading1,
		Heading2,
		Heading3,
		Heading4,
		Heading5,
		Heading6,
		Minus,
		Quote,
		Code,
		List,
		ListOrdered,
		ListChecks,
		Table,
		Image,
		Link,
		Smile,
		LayoutGrid,
		Columns2,
		BarChart3,
		Table2,
		Gauge,
		Filter,
		Badge,
		Activity,
		AlertCircle,
		CreditCard,
		PanelTop,
		ChevronsDownUp,
		Workflow,
		Braces,
		Repeat2,
		GitBranch,
		Code2,
		FileCode2,
		Video,
		Film,
		Bookmark,
		Sigma,
		TableOfContents
	} from '@lucide/svelte';
	import { scrollMenuItemIntoView } from './menu-utils';

	interface Props {
		items: SlashCommand[];
		selectedIndex: number;
		onSelect: (item: SlashCommand) => void;
		onHoverIndex?: (index: number) => void;
	}

	const { items, selectedIndex, onSelect, onHoverIndex }: Props = $props();

	const groupLabel: Record<string, string> = {
		report: 'Reports',
		heading: 'Headings',
		structure: 'Basic blocks',
		widget: 'Widgets & layouts',
		query: 'Query & pages'
	};

	const iconMap: Record<string, Component> = {
		h1: Heading1,
		h2: Heading2,
		h3: Heading3,
		h4: Heading4,
		h5: Heading5,
		h6: Heading6,
		divider: Minus,
		quote: Quote,
		code: Code,
		bullet: List,
		numbered: ListOrdered,
		task: ListChecks,
		table: Table,
		image: Image,
		link: Link,
		emoji: Smile,
		grid: LayoutGrid,
		columns: Columns2,
		chart: BarChart3,
		datatable: Table2,
		'pivot-table': Table2,
		'summary-table': Table2,
		metric: Gauge,
		filter: Filter,
		badge: Badge,
		progress: Activity,
		callout: AlertCircle,
		card: CreditCard,
		tabs: PanelTop,
		details: ChevronsDownUp,
		mermaid: Workflow,
		'report-summary': LayoutGrid,
		'report-filtered': Filter,
		'report-grouped': GitBranch,
		'report-tabs': PanelTop,
		each: Repeat2,
		group: GitBranch,
		if: Braces,
		else: Braces,
		conditional: Braces,
		sql: Code2,
		prql: FileCode2,
		python: Code2,
		page: PanelTop,
		video: Video,
		embed: Film,
		bookmark: Bookmark,
		math: Sigma,
		toc: TableOfContents
	};

	const grouped = $derived.by(() => {
		const map = new Map<string, SlashCommand[]>();
		for (const item of items) {
			const g = item.group;
			if (!map.has(g)) map.set(g, []);
			map.get(g)!.push(item);
		}
		return [...map.entries()];
	});

	let listEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		void selectedIndex;
		const el = listEl?.querySelector('[aria-selected="true"]') as HTMLElement | null;
		if (el && listEl) scrollMenuItemIntoView(listEl, el, 8);
	});

	function iconFor(cmd: SlashCommand) {
		return iconMap[cmd.id] ?? LayoutGrid;
	}
</script>

<div
	bind:this={listEl}
	class="slash-menu z-50 max-h-80 w-72 overflow-y-auto rounded-sm border bg-popover p-1 shadow-lg"
	role="listbox"
>
	{#if items.length === 0}
		<p class="px-2 py-1.5 text-xs text-muted-foreground">No matching commands</p>
	{:else}
		{#each grouped as [group, cmds] (group)}
			<p
				class="px-2 pt-1.5 pb-0.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase"
			>
				{groupLabel[group] ?? group}
			</p>
			{#each cmds as cmd (cmd.id)}
				{@const idx = items.indexOf(cmd)}
				{@const Icon = iconFor(cmd)}
				<button
					type="button"
					role="option"
					aria-selected={idx === selectedIndex}
					class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {idx ===
					selectedIndex
						? 'bg-accent text-accent-foreground'
						: 'hover:bg-muted/60'}"
					onmousedown={(e) => {
						e.preventDefault();
						onSelect(cmd);
					}}
					onmouseenter={() => onHoverIndex?.(idx)}
				>
					<span
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border bg-background/80"
					>
						<Icon class="h-3.5 w-3.5 opacity-80" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-xs font-medium">{cmd.label}</span>
						{#if cmd.description}
							<span class="block truncate text-2xs text-muted-foreground">{cmd.description}</span>
						{/if}
					</span>
				</button>
			{/each}
		{/each}
	{/if}
</div>
