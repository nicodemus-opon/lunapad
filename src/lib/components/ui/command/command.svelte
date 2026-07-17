<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> = $props();
</script>

<div
	bind:this={ref}
	data-slot="command"
	class={cn(
		'flex w-full flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
