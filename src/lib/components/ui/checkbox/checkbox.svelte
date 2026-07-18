<script lang="ts">
	import { Checkbox as CheckboxPrimitive } from 'bits-ui';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<CheckboxPrimitive.Root
	bind:ref
	bind:checked
	bind:indeterminate
	data-slot="checkbox"
	class={cn(
		'peer size-4 shrink-0 rounded-[min(var(--radius-sm),4px)] border border-input bg-background text-primary-foreground shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary dark:bg-input/30 dark:data-[state=checked]:bg-primary dark:data-[state=indeterminate]:bg-primary',
		className
	)}
	{...restProps}
>
	{#snippet children({ checked, indeterminate })}
		<span class="flex size-full items-center justify-center text-current">
			{#if indeterminate}
				<MinusIcon class="size-3" />
			{:else if checked}
				<CheckIcon class="size-3" />
			{/if}
		</span>
	{/snippet}
</CheckboxPrimitive.Root>
