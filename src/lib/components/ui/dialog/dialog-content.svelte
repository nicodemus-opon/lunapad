<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<DialogPrimitive.ContentProps> = $props();
</script>

<DialogPrimitive.Portal>
	<DialogPrimitive.Overlay
		class={cn(
			'fixed inset-0 z-(--z-overlay) bg-background/70 backdrop-blur-sm',
			'data-[state=open]:animate-in data-[state=closed]:animate-out',
			'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
			'data-[state=closed]:pointer-events-none data-[state=closed]:invisible'
		)}
	/>
	<DialogPrimitive.Content
		bind:ref
		class={cn(
			'fixed top-1/2 left-1/2 z-(--z-modal) w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2',
			'rounded-xl border bg-popover text-popover-foreground shadow-xl outline-none',
			'data-[state=open]:animate-in data-[state=closed]:animate-out',
			'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
			'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
			'data-[state=closed]:pointer-events-none data-[state=closed]:invisible',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</DialogPrimitive.Content>
</DialogPrimitive.Portal>
