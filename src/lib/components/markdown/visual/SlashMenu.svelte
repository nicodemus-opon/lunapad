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
	import * as Command from '$lib/components/ui/command';
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

<Command.Root
	bind:ref={listEl}
	class="slash-menu z-50 w-72 rounded-lg"
	role="listbox"
	aria-activedescendant={items[selectedIndex]?.id
		? `slash-command-${items[selectedIndex].id}`
		: undefined}
>
	{#if items.length === 0}
		<Command.Empty>No matching commands</Command.Empty>
	{:else}
		<Command.List>
			{#each grouped as [group, cmds] (group)}
				<Command.Group>
					<Command.GroupHeading>{groupLabel[group] ?? group}</Command.GroupHeading>
					{#each cmds as cmd (cmd.id)}
						{@const idx = items.indexOf(cmd)}
						{@const Icon = iconFor(cmd)}
						<Command.Item
							id={`slash-command-${cmd.id}`}
							role="option"
							aria-selected={idx === selectedIndex}
							data-selected={idx === selectedIndex ? 'true' : undefined}
							class="gap-2.5 py-2"
							onmousedown={(e) => {
								e.preventDefault();
								onSelect(cmd);
							}}
							onmouseenter={() => onHoverIndex?.(idx)}
						>
							<span
								class="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-background/80 text-muted-foreground"
							>
								<Icon class="size-3.5" />
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-xs font-medium">{cmd.label}</span>
								{#if cmd.description}
									<span class="block truncate text-2xs text-muted-foreground">
										{cmd.description}
									</span>
								{/if}
							</span>
						</Command.Item>
					{/each}
				</Command.Group>
			{/each}
		</Command.List>
	{/if}
</Command.Root>
