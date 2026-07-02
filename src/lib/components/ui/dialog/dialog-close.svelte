<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { X } from '@lucide/svelte';
	import { cn, type WithoutChildren } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildren<DialogPrimitive.CloseProps> = $props();
</script>

<DialogPrimitive.Close
	bind:ref
	class={cn(
		'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
		className
	)}
	{...restProps}
>
	<X class="h-4 w-4" />
	<span class="sr-only">Close</span>
</DialogPrimitive.Close>
