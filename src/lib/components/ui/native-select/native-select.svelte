<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLSelectAttributes, HTMLSelectElement> = $props();
</script>

<span class="relative inline-flex min-w-0">
	<select
		bind:this={ref}
		bind:value
		data-slot="native-select"
		class={cn(
			'h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-background py-1 pr-7 pl-2.5 text-sm text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</select>
	<ChevronDownIcon
		class="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
	/>
</span>
