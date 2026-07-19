<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import type { Cell } from '$lib/stores/notebook.svelte';
	import type { ControlCellKind } from '$lib/services/control-cells';

	type AddKind =
		| 'default'
		| 'prql'
		| 'sql'
		| 'markdown'
		| 'udf'
		| 'plot'
		| 'python'
		| ControlCellKind;

	let {
		onAdd,
		prevCell = null,
		persistent = false,
		showUdf = false,
		showPlot = false,
		showPython = false
	}: {
		onAdd: (kind: AddKind) => void;
		/** Cell immediately above this divider — drives context suggestions. */
		prevCell?: Cell | null;
		/** Trailing divider at the end of the cell list stays visible. */
		persistent?: boolean;
		showUdf?: boolean;
		showPlot?: boolean;
		showPython?: boolean;
	} = $props();

	let menuOpen = $state(false);
	let hovered = $state(false);

	const suggested = $derived.by((): AddKind[] => {
		if (!prevCell) return ['sql', 'markdown', 'prql'];
		if (prevCell.cellType === 'markdown') return ['sql', 'markdown', 'prql'];
		if (prevCell.cellType === 'query' && prevCell.result) return ['markdown', 'plot', 'sql'];
		if (prevCell.cellType === 'query') return ['sql', 'markdown'];
		if (prevCell.cellType === 'plot') return ['markdown', 'sql'];
		return ['default', 'markdown', 'sql'];
	});

	const kindLabels: Record<AddKind, string> = {
		default: 'Cell',
		prql: 'PRQL cell',
		sql: 'SQL cell',
		markdown: 'Markdown cell',
		udf: 'Python UDF cell',
		plot: 'Plot cell',
		python: 'Python cell',
		'text-input': 'Text input',
		'number-input': 'Number input',
		slider: 'Slider',
		'date-input': 'Date input',
		'date-range': 'Date range',
		checkbox: 'Checkbox',
		select: 'Select',
		multiselect: 'Multiselect',
		'run-button': 'Run button',
		'file-upload': 'File upload',
		'table-input': 'Editable table',
		map: 'Map',
		'table-display': 'Rich table',
		pivot: 'Pivot',
		'single-value': 'Single value',
		writeback: 'Writeback',
		agent: 'Agent block'
	};

	const allKinds = $derived(
		(
			[
				'prql',
				'sql',
				'markdown',
				showUdf ? 'udf' : null,
				showPlot ? 'plot' : null,
				showPython ? 'python' : null
			] as const
		).filter((k): k is Exclude<typeof k, null> => k != null)
	);

	const otherKinds = $derived(allKinds.filter((k) => !suggested.includes(k)));
	const visible = $derived(persistent || menuOpen || hovered);
	const inputKinds: ControlCellKind[] = [
		'text-input',
		'number-input',
		'slider',
		'date-input',
		'date-range',
		'checkbox',
		'select',
		'multiselect',
		'run-button',
		'file-upload'
	];
	const dataKinds: ControlCellKind[] = [
		'table-input',
		'table-display',
		'pivot',
		'map',
		'single-value',
		'writeback',
		'agent'
	];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="notebook-add-divider group/divider grid grid-cols-[var(--notebook-gutter-width)_minmax(0,1fr)] gap-x-2 transition-opacity duration-(--motion-fast) {visible
		? 'opacity-100'
		: 'opacity-0 focus-within:opacity-100 hover:opacity-100'}"
	role="separator"
	aria-label="Add cell"
	onmouseenter={() => (hovered = true)}
	onmouseleave={() => (hovered = false)}
>
	<div class="flex items-center justify-center">
		<DropdownMenu.Root bind:open={menuOpen}>
			<DropdownMenu.Trigger
				class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 transition-colors outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
				aria-label="Add cell here"
				title="Add cell"
			>
				<Plus class="h-3.5 w-3.5" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content side="bottom" align="start" class="min-w-40">
				{#if suggested.length > 0}
					<DropdownMenu.Label class="text-2xs text-muted-foreground">Suggested</DropdownMenu.Label>
					{#each suggested as kind (kind)}
						<DropdownMenu.Item onclick={() => onAdd(kind)}>{kindLabels[kind]}</DropdownMenu.Item>
					{/each}
					{#if otherKinds.length > 0}
						<DropdownMenu.Separator />
						<DropdownMenu.Label class="text-2xs text-muted-foreground">More</DropdownMenu.Label>
					{/if}
				{/if}
				{#each otherKinds as kind (kind)}
					<DropdownMenu.Item onclick={() => onAdd(kind)}>{kindLabels[kind]}</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Separator />
				<DropdownMenu.Label class="text-2xs text-muted-foreground">Inputs</DropdownMenu.Label>
				{#each inputKinds as kind (kind)}
					<DropdownMenu.Item onclick={() => onAdd(kind)}>{kindLabels[kind]}</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Separator />
				<DropdownMenu.Label class="text-2xs text-muted-foreground">Data & AI</DropdownMenu.Label>
				{#each dataKinds as kind (kind)}
					<DropdownMenu.Item onclick={() => onAdd(kind)}>{kindLabels[kind]}</DropdownMenu.Item>
				{/each}
				{#if !suggested.includes('default')}
					<DropdownMenu.Separator />
					<DropdownMenu.Item onclick={() => onAdd('default')}>Default cell</DropdownMenu.Item>
				{/if}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
	<div class="flex items-center pr-1">
		<div
			class="h-px flex-1 bg-border/35 transition-opacity duration-(--motion-fast) {visible
				? 'opacity-100'
				: 'opacity-0'}"
		></div>
	</div>
</div>
