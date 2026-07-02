<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="dialog-header"
	class={cn(
		'flex shrink-0 items-start justify-between gap-3 border-b border-border/60 px-4 py-3',
		className
	)}
	{...restProps}
>
	<div class="min-w-0 flex-1">
		{@render children?.()}
	</div>
</div>
