<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLButtonAttributes, HTMLButtonElement> = $props();
</script>

<button
	bind:this={ref}
	type="button"
	data-slot="command-item"
	class={cn(
		'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</button>
