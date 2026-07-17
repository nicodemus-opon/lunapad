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
	data-slot="command-empty"
	class={cn('py-6 text-center text-sm text-muted-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</div>
