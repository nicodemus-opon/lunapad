<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		depth = 0,
		selected = false,
		dragTarget = false,
		expandable = false,
		expanded = false,
		leafSpacer = true,
		onActivate,
		class: className,
		icon,
		label,
		trailing,
		...restProps
	}: HTMLAttributes<HTMLDivElement> & {
		depth?: number;
		selected?: boolean;
		dragTarget?: boolean;
		expandable?: boolean;
		expanded?: boolean;
		/** Leaf rows render a chevron-width spacer so labels align with sibling expandable rows. */
		leafSpacer?: boolean;
		onActivate?: () => void;
		icon?: Snippet;
		label: Snippet;
		trailing?: Snippet;
	} = $props();
</script>

<div
	class={cn(
		'group/row mx-[var(--sidebar-row-inset)] flex h-[var(--sidebar-row-height)] cursor-pointer items-center gap-1.5 rounded-md pr-2 transition-colors select-none',
		'hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
		selected && 'bg-sidebar-accent text-sidebar-accent-foreground',
		dragTarget && 'bg-sidebar-accent ring-1 ring-primary/40',
		className
	)}
	style:--tree-depth={depth}
	style:padding-left={`calc(var(--sidebar-panel-x) + var(--tree-depth) * var(--tree-indent))`}
	role="treeitem"
	aria-expanded={expandable ? expanded : undefined}
	aria-selected={selected}
	tabindex="0"
	onclick={onActivate}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onActivate?.();
		}
	}}
	{...restProps}
>
	{#if expandable}
		<ChevronRight
			class={cn(
				'h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-(--motion-fast)',
				expanded && 'rotate-90'
			)}
		/>
	{:else if leafSpacer}
		<span class="w-3 shrink-0" aria-hidden="true"></span>
	{/if}
	{@render icon?.()}
	{@render label()}
	{@render trailing?.()}
</div>
