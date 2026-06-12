<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import {
		GripVertical,
		Code2,
		Eye,
		EyeOff,
		FlaskConical,
		Loader2,
		Database,
		Plug,
		ChevronUp,
		ChevronDown,
		Trash2
	} from '@lucide/svelte';
	import {
		moveCell,
		removeCell,
		setCellConnection,
		setCellDisplay,
		type Cell
	} from '$lib/stores/notebook.svelte';
	import { BUILTIN_DUCKDB_CONNECTION_ID, type Connection } from '$lib/types/connection';

	let {
		cell,
		isQueryCell,
		isFirst,
		isLast,
		isDbtProject,
		connections,
		connectionValue,
		sqlExpanded = $bindable(false),
		open = $bindable(false),
		onOpenMaterialize,
		onRunTests
	}: {
		cell: Cell;
		isQueryCell: boolean;
		isFirst: boolean;
		isLast: boolean;
		isDbtProject: boolean;
		connections: Connection[];
		connectionValue: string;
		sqlExpanded?: boolean;
		open?: boolean;
		onOpenMaterialize: () => void;
		onRunTests: () => void;
	} = $props();

	const codeHidden = $derived(cell.display === 'output');
</script>

<DropdownMenu.Root bind:open>
	<DropdownMenu.Trigger
		data-drag-handle
		class="flex h-6 w-5 cursor-grab items-center justify-center rounded text-muted-foreground transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
		aria-label="Cell actions — drag to reorder"
		title="Click for actions, drag to reorder"
	>
		<GripVertical class="h-3.5 w-3.5" />
	</DropdownMenu.Trigger>
	<DropdownMenu.Content side="bottom" align="start" class="min-w-48">
		{#if isQueryCell}
			{#if cell.display !== 'collapsed'}
				<DropdownMenu.Item onclick={() => setCellDisplay(cell.id, codeHidden ? 'full' : 'output')}>
					{#if codeHidden}
						<Eye class="h-3.5 w-3.5" /> Show code
					{:else}
						<EyeOff class="h-3.5 w-3.5" /> Hide code
					{/if}
				</DropdownMenu.Item>
			{/if}
			{#if cell.compiledSQL}
				<DropdownMenu.Item onclick={() => (sqlExpanded = !sqlExpanded)}>
					<Code2 class="h-3.5 w-3.5" />
					{sqlExpanded ? 'Hide compiled SQL' : 'Show compiled SQL'}
				</DropdownMenu.Item>
			{/if}
			{#if isDbtProject}
				<DropdownMenu.Item disabled={cell.dbtTestStatus === 'running'} onclick={onRunTests}>
					{#if cell.dbtTestStatus === 'running'}
						<Loader2 class="h-3.5 w-3.5 animate-spin" /> Running tests…
					{:else}
						<FlaskConical class="h-3.5 w-3.5" /> Run dbt tests
					{/if}
				</DropdownMenu.Item>
			{/if}
			{#if connections.length > 0}
				<DropdownMenu.Sub>
					<DropdownMenu.SubTrigger>
						<Plug class="h-3.5 w-3.5" /> Connection
					</DropdownMenu.SubTrigger>
					<DropdownMenu.SubContent>
						<DropdownMenu.RadioGroup
							value={connectionValue}
							onValueChange={(value) =>
								setCellConnection(cell.id, value === BUILTIN_DUCKDB_CONNECTION_ID ? null : value)}
						>
							{#each connections as connection (connection.id)}
								<DropdownMenu.RadioItem value={connection.id} class="font-mono text-xs">
									{connection.name}
								</DropdownMenu.RadioItem>
							{/each}
						</DropdownMenu.RadioGroup>
					</DropdownMenu.SubContent>
				</DropdownMenu.Sub>
			{/if}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onclick={onOpenMaterialize}>
				<Database class="h-3.5 w-3.5" /> Materialize & schedule…
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
		{/if}
		<DropdownMenu.Item disabled={isFirst} onclick={() => moveCell(cell.id, 'up')}>
			<ChevronUp class="h-3.5 w-3.5" /> Move up
			<DropdownMenu.Shortcut>⇧K</DropdownMenu.Shortcut>
		</DropdownMenu.Item>
		<DropdownMenu.Item disabled={isLast} onclick={() => moveCell(cell.id, 'down')}>
			<ChevronDown class="h-3.5 w-3.5" /> Move down
			<DropdownMenu.Shortcut>⇧J</DropdownMenu.Shortcut>
		</DropdownMenu.Item>
		<DropdownMenu.Separator />
		<DropdownMenu.Item variant="destructive" onclick={() => removeCell(cell.id)}>
			<Trash2 class="h-3.5 w-3.5" /> Delete cell
			<DropdownMenu.Shortcut>dd</DropdownMenu.Shortcut>
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
