<script lang="ts">
	import { Popover } from 'bits-ui';
	import { Button } from '$lib/components/ui/button/index.js';
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
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				variant="ghost"
				size="sm"
				class="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
				title="Chart settings"
				{...props}
			>
				<Settings2 class="h-3.5 w-3.5" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Portal>
		<Popover.Content
			class="z-50 max-h-[80vh] w-72 overflow-y-auto rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
			sideOffset={6}
			align="end"
		>
			<ChartConfigPanel {config} {columns} {rows} {onUpdate} />
		</Popover.Content>
	</Popover.Portal>
</Popover.Root>
