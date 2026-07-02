<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { removeTable, type UploadedTable } from '$lib/stores/notebook.svelte';
	import { Table2, X } from '@lucide/svelte';

	interface Props {
		table: UploadedTable;
	}

	let { table }: Props = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		<Badge variant="secondary" class="h-6 gap-1 py-0.5 pr-1 pl-2 text-xs font-normal">
			<Table2 class="h-3 w-3 shrink-0 text-muted-foreground" />
			<span class="max-w-30 truncate font-mono">{table.name}</span>
			<span class="shrink-0 text-muted-foreground">{table.rowCount.toLocaleString()}r</span>
			<button
				class="ml-0.5 rounded-sm p-0.5 transition-colors hover:bg-destructive/20 hover:text-destructive"
				onclick={() => removeTable(table.name)}
				aria-label="Remove table {table.name}"
			>
				<X class="h-2.5 w-2.5" />
			</button>
		</Badge>
	</Tooltip.Trigger>
	<Tooltip.Content class="max-w-xs">
		<p class="mb-1 text-xs font-medium">{table.fileName}</p>
		<p class="mb-1 text-xs text-muted-foreground">
			{table.rowCount.toLocaleString()} rows · {table.columns.length} columns
		</p>
		<p class="font-mono text-xs break-all text-muted-foreground">
			{table.columns.slice(0, 10).join(', ')}{table.columns.length > 10
				? ` … +${table.columns.length - 10} more`
				: ''}
		</p>
	</Tooltip.Content>
</Tooltip.Root>
