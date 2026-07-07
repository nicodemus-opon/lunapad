<script lang="ts">
	import type { Component } from 'svelte';
	import {
		ArrowUpToLine,
		ArrowDownToLine,
		Pilcrow,
		Heading1,
		Heading2,
		Heading3,
		List,
		ListOrdered,
		ListChecks,
		Quote,
		Code,
		AlertCircle,
		ChevronsDownUp,
		Copy,
		Link,
		Trash2
	} from '@lucide/svelte';
	import { scrollMenuItemIntoView } from './menu-utils';
	import type { BlockMenuGroup } from './block-menu-actions';

	interface Props {
		groups: BlockMenuGroup[];
		selectedIndex: number;
		onSelect: (id: string) => void;
		onHoverIndex?: (index: number) => void;
	}

	const { groups, selectedIndex, onSelect, onHoverIndex }: Props = $props();

	const iconMap: Record<string, Component> = {
		'add-above': ArrowUpToLine,
		'add-below': ArrowDownToLine,
		'turn-paragraph': Pilcrow,
		'turn-h1': Heading1,
		'turn-h2': Heading2,
		'turn-h3': Heading3,
		'turn-bullet': List,
		'turn-numbered': ListOrdered,
		'turn-task': ListChecks,
		'turn-quote': Quote,
		'turn-code': Code,
		'turn-callout': AlertCircle,
		'turn-toggle': ChevronsDownUp,
		duplicate: Copy,
		'copy-link': Link,
		delete: Trash2
	};

	const flat = $derived(groups.flatMap((g) => g.items));
	let listEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		void selectedIndex;
		const el = listEl?.querySelector('[aria-selected="true"]') as HTMLElement | null;
		if (el && listEl) scrollMenuItemIntoView(listEl, el, 8);
	});
</script>

<div
	bind:this={listEl}
	class="block-menu z-50 max-h-96 w-56 overflow-y-auto rounded-sm border bg-popover p-1 shadow-lg"
	role="listbox"
	tabindex="-1"
	onmousedown={(e) => e.stopPropagation()}
>
	{#each groups as group (group.label)}
		<p
			class="px-2 pt-1.5 pb-0.5 text-2xs font-semibold tracking-wide text-muted-foreground uppercase"
		>
			{group.label}
		</p>
		{#each group.items as item (item.id)}
			{@const idx = flat.indexOf(item)}
			{@const Icon = iconMap[item.id]}
			<button
				type="button"
				role="option"
				aria-selected={idx === selectedIndex}
				disabled={item.disabled}
				class="block-menu-item flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 {idx ===
				selectedIndex
					? 'is-active'
					: ''} {item.danger ? 'text-destructive' : ''}"
				onmousedown={(e) => {
					e.preventDefault();
					if (!item.disabled) onSelect(item.id);
				}}
				onmouseenter={() => {
					if (!item.disabled) onHoverIndex?.(idx);
				}}
			>
				{#if Icon}
					<Icon class="h-3.5 w-3.5 shrink-0 opacity-80" />
				{/if}
				<span class="truncate">{item.label}</span>
			</button>
		{/each}
	{/each}
</div>

<style>
	.block-menu-item {
		border-left: 2px solid transparent;
	}
	.block-menu-item:hover,
	.block-menu-item.is-active {
		background: color-mix(in oklab, var(--accent) 70%, transparent);
		border-left-color: var(--primary);
	}
	.block-menu-item:focus-visible {
		outline: none;
	}
</style>
