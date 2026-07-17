<script lang="ts">
	import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';
	import { cn, type WithoutChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithoutChild<ToggleGroupPrimitive.ItemProps> = $props();
</script>

<ToggleGroupPrimitive.Item
	bind:ref
	data-slot="toggle-group-item"
	class={cn(
		'inline-flex h-7 items-center justify-center rounded-md border border-transparent px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary',
		className
	)}
	{...restProps}
>
	{#snippet child({ pressed })}
		{@render children?.({ pressed })}
	{/snippet}
</ToggleGroupPrimitive.Item>
