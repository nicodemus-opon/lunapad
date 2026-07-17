<script lang="ts">
	import { Database, MoreHorizontal } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { MENTION_GROUP_LABEL, type MentionItem } from './mention-utils';
	import { scrollMenuItemIntoView } from './menu-utils';

	interface Props {
		items: MentionItem[];
		moreCount: number;
		selectedIndex: number;
		query: string;
		onSelect: (item: MentionItem) => void;
		onHoverIndex?: (index: number) => void;
	}

	const { items, moreCount, selectedIndex, query, onSelect, onHoverIndex }: Props = $props();

	const grouped = $derived.by(() => {
		const map = new Map<MentionItem['group'], MentionItem[]>();
		for (const item of items) {
			if (!map.has(item.group)) map.set(item.group, []);
			map.get(item.group)!.push(item);
		}
		return [...map.entries()];
	});

	let listEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		void selectedIndex;
		const el = listEl?.querySelector('[aria-selected="true"]') as HTMLElement | null;
		if (el && listEl) scrollMenuItemIntoView(listEl, el, 8);
	});
</script>

<div
	bind:this={listEl}
	class="mention-menu z-50 max-h-80 w-72 overflow-y-auto rounded-sm border bg-popover p-1 shadow-lg"
	role="listbox"
	aria-label="Cell references"
>
	{#if items.length === 0}
		<p class="px-2 py-1.5 text-xs text-muted-foreground">
			{query.trim() ? `No models match "${query.trim()}"` : 'Type a model or cell name'}
		</p>
	{:else}
		{#each grouped as [group, groupItems] (group)}
			<p
				class="px-2 pt-1.5 pb-0.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase"
			>
				{MENTION_GROUP_LABEL[group]}
			</p>
			{#each groupItems as item (item.id)}
				{@const idx = items.indexOf(item)}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					role="option"
					aria-selected={idx === selectedIndex}
					class="mention-menu-item flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none {idx ===
					selectedIndex
						? 'bg-accent text-accent-foreground'
						: 'hover:bg-muted/60'}"
					onmousedown={(e) => {
						e.preventDefault();
						onSelect(item);
					}}
					onmouseenter={() => onHoverIndex?.(idx)}
				>
					<span
						class="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border bg-background/80"
					>
						<Database class="h-3.5 w-3.5 opacity-80" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-xs font-medium">{item.label}</span>
						{#if item.meta}
							<span class="block truncate text-2xs text-muted-foreground">{item.meta}</span>
						{/if}
					</span>
				</Button>
			{/each}
		{/each}
		{#if moreCount > 0}
			<div
				class="mt-0.5 flex items-center gap-1.5 px-2 py-1.5 text-2xs text-muted-foreground"
				role="presentation"
			>
				<MoreHorizontal class="h-3.5 w-3.5 shrink-0" />
				<span>{moreCount} more result{moreCount === 1 ? '' : 's'}</span>
			</div>
		{/if}
	{/if}
</div>
