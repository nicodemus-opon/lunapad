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
	data-slot="command-list"
	class={cn('max-h-80 overflow-x-hidden overflow-y-auto', className)}
	{...restProps}
>
	{@render children?.()}
</div>
