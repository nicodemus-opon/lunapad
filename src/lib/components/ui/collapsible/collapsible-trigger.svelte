<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<CollapsiblePrimitive.TriggerProps> = $props();
</script>

<CollapsiblePrimitive.Trigger
	bind:ref
	data-slot="collapsible-trigger"
	class={cn(
		'inline-flex items-center gap-1.5 rounded-md text-sm font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</CollapsiblePrimitive.Trigger>
