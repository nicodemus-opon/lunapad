<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLHeadingElement>> = $props();
</script>

<h2
	bind:this={ref}
	data-slot="dialog-title"
	class={cn('text-sm font-semibold text-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</h2>
