<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<DialogPrimitive.TriggerProps> = $props();
</script>

<DialogPrimitive.Trigger bind:ref class={cn(className)} {...restProps}>
	{@render children?.()}
</DialogPrimitive.Trigger>
