<script lang="ts">
	import type { AppendStage } from '$lib/types/gui-pipeline';
	import * as Popover from '$lib/components/ui/popover';
	import { ColumnInput } from '$lib/components/ui/column-input';
	import { Button } from '$lib/components/ui/button';
	import { Plus, X } from '@lucide/svelte';
	import { CHIP, CHIP_ADD, CHIP_SECTION, CHIP_X } from '../chip-styles';

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
		<div class={CHIP}>
			<Popover.Root>
				<Popover.Trigger class={CHIP_SECTION}>
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
				class={CHIP_X}
				onclick={() => removeSource(idx)}
				aria-label="Remove source"
			>
				<X class="w-3 h-3" />
			</button>
		</div>
	{/each}

	<Popover.Root bind:open={addOpen}>
		<Popover.Trigger class={CHIP_ADD}>
			<Plus class="w-3 h-3" /> source
		</Popover.Trigger>
		<Popover.Content class="w-56 p-2 space-y-2">
			<ColumnInput
				value={draftSource}
				suggestions={availableTables}
				placeholder="source..."
				onchange={(value) => (draftSource = value)}
			/>
			<Button size="sm" class="w-full" onclick={confirmAdd}>Add source</Button>
		</Popover.Content>
	</Popover.Root>
</div>
