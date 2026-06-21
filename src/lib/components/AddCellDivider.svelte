<script lang="ts">
	import { Plus, Ellipsis } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	let {
		onAdd,
		persistent = false,
		showUdf = false
	}: {
		onAdd: (kind: 'default' | 'prql' | 'sql' | 'markdown' | 'udf') => void;
		/** Trailing divider at the end of the cell list stays visible. */
		persistent?: boolean;
		/** Python UDF cells only make sense in .luna-format notebooks. */
		showUdf?: boolean;
	} = $props();

	let menuOpen = $state(false);
</script>

<div
	class="group/divider relative flex h-4 items-center justify-center transition-opacity duration-150 {persistent ||
	menuOpen
		? 'opacity-100'
		: 'opacity-0 focus-within:opacity-100 hover:opacity-100'}"
	role="separator"
	aria-label="Add cell"
>
	<div
		class="absolute inset-x-10 top-1/2 h-px -translate-y-1/2 bg-border opacity-0 transition-opacity duration-150 group-focus-within/divider:opacity-100 group-hover/divider:opacity-100"
	></div>
	<div class="relative flex items-center gap-0.5">
		<button
			class="flex p-2 items-center justify-center rounded-full border bg-secondary text-secondary-foreground transition-colors outline-none hover:border-border hover:bg-secondary/90 focus-visible:ring-2 focus-visible:ring-ring/50"
			aria-label="Add cell here"
			title="Add cell"
			onclick={() => onAdd('default')}
		>
			<Plus class="h-5 w-5" />
		</button>
		<DropdownMenu.Root bind:open={menuOpen}>
			<DropdownMenu.Trigger
				class="flex p-2 items-center rounded-full border bg-accent text-2xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
				aria-label="Choose cell type"
			>
			<Ellipsis class="h-5 w-5"/>
				
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="bottom" align="center" class="min-w-32">
				<DropdownMenu.Item onclick={() => onAdd('prql')}>PRQL cell</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => onAdd('sql')}>SQL cell</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => onAdd('markdown')}>Markdown cell</DropdownMenu.Item>
				{#if showUdf}
					<DropdownMenu.Item onclick={() => onAdd('udf')}>Python UDF cell</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
</div>
