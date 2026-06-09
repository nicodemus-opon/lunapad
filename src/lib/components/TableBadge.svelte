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
		<Badge variant="secondary" class="gap-1 pl-2 pr-1 py-0.5 text-xs font-normal h-6">
			<Table2 class="w-3 h-3 shrink-0 text-muted-foreground" />
			<span class="font-mono max-w-[120px] truncate">{table.name}</span>
			<span class="text-muted-foreground shrink-0">{table.rowCount.toLocaleString()}r</span>
			<button
				class="ml-0.5 rounded-sm hover:bg-destructive/20 hover:text-destructive p-0.5 transition-colors"
				onclick={() => removeTable(table.name)}
				aria-label="Remove table {table.name}"
			>
				<X class="w-2.5 h-2.5" />
			</button>
		</Badge>
	</Tooltip.Trigger>
	<Tooltip.Content class="max-w-xs">
		<p class="text-xs font-medium mb-1">{table.fileName}</p>
		<p class="text-xs text-muted-foreground mb-1">
			{table.rowCount.toLocaleString()} rows · {table.columns.length} columns
		</p>
		<p class="text-xs font-mono text-muted-foreground break-all">
			{table.columns.slice(0, 10).join(', ')}{table.columns.length > 10 ? ` … +${table.columns.length - 10} more` : ''}
		</p>
	</Tooltip.Content>
</Tooltip.Root>
