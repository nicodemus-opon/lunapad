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
	data-slot="command-group-heading"
	class={cn('px-2 pt-1.5 pb-1 text-2xs font-semibold text-muted-foreground uppercase', className)}
	{...restProps}
>
	{@render children?.()}
</div>
