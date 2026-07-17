<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<TabsPrimitive.TriggerProps> = $props();
</script>

<TabsPrimitive.Trigger
	bind:ref
	data-slot="tabs-trigger"
	class={cn(
		'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</TabsPrimitive.Trigger>
