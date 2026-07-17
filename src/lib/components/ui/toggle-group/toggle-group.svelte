<script lang="ts">
	import { ToggleGroup as ToggleGroupPrimitive } from 'bits-ui';

	let { value = $bindable(), children, ...restProps }: ToggleGroupPrimitive.RootProps = $props();
</script>

<ToggleGroupPrimitive.Root bind:value={value as never} data-slot="toggle-group" {...restProps}>
	{@render children?.()}
</ToggleGroupPrimitive.Root>
