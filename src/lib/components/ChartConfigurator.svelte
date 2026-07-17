<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Settings2 } from '@lucide/svelte';
	import type { ChartConfig } from '$lib/types/gui-pipeline';
	import ChartConfigPanel from './ChartConfigPanel.svelte';

	interface Props {
		config: ChartConfig;
		columns: string[];
		rows: Record<string, unknown>[];
		onUpdate: (config: ChartConfig) => void;
	}

	const { config, columns, rows, onUpdate }: Props = $props();
</script>

<Popover.Root>
	<Popover.Trigger
		data-testid="chart-settings"
		class="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
		title="Chart settings"
		aria-label="Chart settings"
	>
		<Settings2 class="h-3.5 w-3.5" />
	</Popover.Trigger>
	<Popover.Content
		class="max-h-[min(78vh,34rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto p-3"
		sideOffset={6}
		align="end"
	>
		<ChartConfigPanel {config} {columns} {rows} {onUpdate} />
	</Popover.Content>
</Popover.Root>
