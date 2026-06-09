<script lang="ts">
	import { Popover as PopoverPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		side = 'bottom',
		align = 'start',
		sideOffset = 6,
		children,
		...restProps
	}: WithoutChild<PopoverPrimitive.ContentProps> = $props();
</script>

<PopoverPrimitive.Portal>
	<PopoverPrimitive.Content
		bind:ref
		{side}
		{align}
		{sideOffset}
		strategy="fixed"
		class={cn(
			'bg-popover text-popover-foreground z-50 min-w-48 rounded-lg border shadow-md outline-none',
			'data-[state=open]:animate-in data-[state=closed]:animate-out',
			'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
			'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
			'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</PopoverPrimitive.Content>
</PopoverPrimitive.Portal>
