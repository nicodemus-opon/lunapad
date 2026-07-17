<script lang="ts">
	import { Progress as ProgressPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		value = 0,
		max = 100,
		class: className,
		...restProps
	}: WithoutChildrenOrChild<ProgressPrimitive.RootProps> = $props();

	const pct = $derived(
		value == null ? null : Math.max(0, Math.min(100, ((value ?? 0) / (max || 100)) * 100))
	);
</script>

<ProgressPrimitive.Root
	bind:ref
	{value}
	{max}
	data-slot="progress"
	class={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
	{...restProps}
>
	<div
		data-slot="progress-indicator"
		class="h-full w-full flex-1 rounded-full bg-primary transition-transform duration-(--motion-medium) ease-out"
		style:transform={pct == null ? 'translateX(-35%)' : `translateX(-${100 - pct}%)`}
	></div>
</ProgressPrimitive.Root>
