<script lang="ts">
	import type { AppendStage } from '$lib/types/gui-pipeline';
	import * as Popover from '$lib/components/ui/popover';
	import { ColumnInput } from '$lib/components/ui/column-input';
	import { Plus, X } from '@lucide/svelte';

	interface Props {
		stage: AppendStage;
		availableTables: string[];
		onUpdate: (stage: AppendStage) => void;
	}

	let { stage, availableTables, onUpdate }: Props = $props();

	function updateSource(idx: number, value: string) {
		const sources = stage.sources.map((source, i) => (i === idx ? value : source));
		onUpdate({ ...stage, sources });
	}

	function removeSource(idx: number) {
		onUpdate({ ...stage, sources: stage.sources.filter((_, i) => i !== idx) });
	}

	let addOpen = $state(false);
	let draftSource = $state('');

	function confirmAdd() {
		const source = draftSource.trim();
		if (!source) return;
		onUpdate({ ...stage, sources: [...stage.sources, source] });
		draftSource = availableTables[0] ?? '';
		addOpen = false;
	}
</script>

<div class="flex items-center gap-1.5 flex-wrap">
	{#if stage.sources.length === 0}
		<span class="text-xs text-muted-foreground/70 italic">no append sources</span>
	{/if}

	{#each stage.sources as source, idx (`${source}-${idx}`)}
		<div class="inline-flex items-center rounded-full border bg-muted/35 text-xs overflow-hidden group/pill shrink-0" style="border-colorb: hsl(var(--chart-{(idx % 5) + 1}))">
			<Popover.Root>
				<Popover.Trigger class="px-2.5 py-1 hover:bg-muted/60 transition-colors font-mono">
					from {source || '?'}
				</Popover.Trigger>
				<Popover.Content class="w-56 p-2">
					<ColumnInput
						value={source}
						suggestions={availableTables}
						placeholder="source..."
						onchange={(value) => updateSource(idx, value)}
					/>
				</Popover.Content>
			</Popover.Root>
			<button
				class="px-1.5 py-1 text-muted-foreground opacity-0 group-hover/pill:opacity-100 hover:text-destructive transition-all"
				onclick={() => removeSource(idx)}
				aria-label="Remove source"
			>
				<X class="w-3 h-3" />
			</button>
		</div>
	{/each}

	<Popover.Root bind:open={addOpen}>
		<Popover.Trigger
			class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 px-2 py-1 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
		>
			<Plus class="w-3 h-3" /> source
		</Popover.Trigger>
		<Popover.Content class="w-56 p-2 space-y-2">
			<ColumnInput
				value={draftSource}
				suggestions={availableTables}
				placeholder="source..."
				onchange={(value) => (draftSource = value)}
			/>
			<button
				class="w-full h-7 rounded-md border text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
				onclick={confirmAdd}
			>
				Add source
			</button>
		</Popover.Content>
	</Popover.Root>
</div>
