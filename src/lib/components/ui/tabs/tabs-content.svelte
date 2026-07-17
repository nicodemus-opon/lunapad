<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<TabsPrimitive.ContentProps> = $props();
</script>

<TabsPrimitive.Content
	bind:ref
	data-slot="tabs-content"
	class={cn('outline-none', className)}
	{...restProps}
>
	{@render children?.()}
</TabsPrimitive.Content>
