<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<TabsPrimitive.ListProps> = $props();
</script>

<TabsPrimitive.List
	bind:ref
	data-slot="tabs-list"
	class={cn('inline-flex items-center rounded-lg bg-muted p-0.5 text-muted-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</TabsPrimitive.List>
