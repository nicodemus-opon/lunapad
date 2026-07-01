<script lang="ts">
	import type {
		LoopStage,
		LoopMiniStage,
		GUIPipelineStage,
		FilterStage as FilterStageModel,
		SelectStage as SelectStageModel,
		DeriveStage as DeriveStageModel,
		SortStage as SortStageModel,
		TakeStage as TakeStageModel
	} from '$lib/types/gui-pipeline';
	import {
		getAvailableColumns,
		loopMiniStagesToBody,
		parseLoopBodyToMiniStages
	} from '$lib/services/gui-prql';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import FilterStageEditor from './FilterStage.svelte';
	import SelectStageEditor from './SelectStage.svelte';
	import DeriveStageEditor from './DeriveStage.svelte';
	import SortStageEditor from './SortStage.svelte';
	import TakeStageEditor from './TakeStage.svelte';
	import { pickDefaultFilter } from '$lib/components/gui/chip-intelligence';
	import { Plus, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { CHIP, SECTION_LABEL } from '../chip-styles';

	interface Props {
		stage: LoopStage;
		availableColumns?: string[];
		onUpdate: (stage: LoopStage) => void;
	}

	let { stage, availableColumns = [], onUpdate }: Props = $props();

	type LoopMiniStageType = LoopMiniStage['type'];

	const LOOP_MINI_STAGE_TYPES: { value: LoopMiniStageType; label: string }[] = [
		{ value: 'filter', label: 'filter' },
		{ value: 'select', label: 'select' },
		{ value: 'derive', label: 'derive' },
		{ value: 'sort', label: 'sort' },
		{ value: 'take', label: 'take' }
	];

	let addMiniType = $state<LoopMiniStageType>('filter');

	function defaultMiniStage(type: LoopMiniStageType): LoopMiniStage {
		switch (type) {
			case 'filter': {
				const suggested = pickDefaultFilter(availableColumns, []);
				return {
					type: 'filter',
					logic: 'and',
					conditions: [{ column: suggested.column, op: suggested.op, value: suggested.value }]
				};
			}
			case 'select':
				return { type: 'select', columns: [] };
			case 'derive':
				return { type: 'derive', columns: [] };
			case 'sort':
				return { type: 'sort', keys: [] };
			case 'take':
				return { type: 'take', n: 100 };
		}
	}

	function currentStructuredBody(): LoopMiniStage[] {
		if (stage.structuredBody && stage.structuredBody.length > 0) return stage.structuredBody;
		const parsed = parseLoopBodyToMiniStages(stage.body);
		if (parsed && parsed.length > 0) return parsed;
		return [];
	}

	function updateStructuredBody(next: LoopMiniStage[]) {
		onUpdate({
			...stage,
			mode: 'structured',
			structuredBody: next,
			body: loopMiniStagesToBody(next)
		});
	}

	function switchMode(mode: 'raw' | 'structured') {
		if (mode === 'raw') {
			const body =
				stage.mode === 'structured' && stage.structuredBody && stage.structuredBody.length > 0
					? loopMiniStagesToBody(stage.structuredBody)
					: stage.body;
			onUpdate({ ...stage, mode: 'raw', body });
			return;
		}

		const seeded = currentStructuredBody();
		const next = seeded.length > 0 ? seeded : [defaultMiniStage('filter')];
		updateStructuredBody(next);
	}

	function updateMiniStage(idx: number, nextMini: LoopMiniStage) {
		const current = currentStructuredBody();
		const next = current.map((item, i) => (i === idx ? nextMini : item));
		updateStructuredBody(next);
	}

	function removeMiniStage(idx: number) {
		const next = currentStructuredBody().filter((_, i) => i !== idx);
		updateStructuredBody(next);
	}

	function changeMiniType(idx: number, type: LoopMiniStageType) {
		updateMiniStage(idx, defaultMiniStage(type));
	}

	function addMiniStage() {
		const next = [...currentStructuredBody(), defaultMiniStage(addMiniType)];
		updateStructuredBody(next);
	}

	function miniColsAt(idx: number): string[] {
		const structured = currentStructuredBody();
		const prefix: GUIPipelineStage[] = [
			{ type: 'from', table: '__loop__' },
			...structured.slice(0, idx)
		];
		return getAvailableColumns(prefix, { __loop__: availableColumns }, prefix.length);
	}

	const effectiveMode = $derived(stage.mode === 'structured' ? 'structured' : 'raw');
	const structuredBody = $derived(effectiveMode === 'structured' ? currentStructuredBody() : []);
</script>

<div class="w-full space-y-3">
	<div class="flex flex-wrap items-center gap-2">
		<span class="{CHIP} px-2">
			loop {effectiveMode} ({stage.body.split('\n').length} line{stage.body.split('\n').length === 1
				? ''
				: 's'})
		</span>
		<div class="inline-flex items-center rounded border border-border/60 bg-muted/20 p-0.5">
			<button
				class="h-5 rounded-sm px-1.5 font-mono text-2xs transition-colors duration-150 {effectiveMode ===
				'structured'
					? 'bg-background text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => switchMode('structured')}
			>
				structured
			</button>
			<button
				class="h-5 rounded-sm px-1.5 font-mono text-2xs transition-colors duration-150 {effectiveMode ===
				'raw'
					? 'bg-background text-foreground'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => switchMode('raw')}
			>
				raw PRQL
			</button>
		</div>
	</div>

	{#if effectiveMode === 'raw'}
		<p class={SECTION_LABEL}>loop body PRQL</p>
		<Textarea
			rows={8}
			class="font-mono text-xs"
			placeholder="filter n < 4\nselect n = n + 1"
			value={stage.body}
			oninput={(event: Event) =>
				onUpdate({
					...stage,
					mode: 'raw',
					body: (event.target as HTMLTextAreaElement).value
				})}
		/>
	{:else}
		<div class="space-y-2">
			<div class="flex items-center gap-2">
				<Select.Root
					type="single"
					value={addMiniType}
					onValueChange={(value) => (addMiniType = value as LoopMiniStageType)}
				>
					<Select.Trigger class="h-7 w-36 text-xs">{addMiniType}</Select.Trigger>
					<Select.Content>
						{#each LOOP_MINI_STAGE_TYPES as entry}
							<Select.Item value={entry.value} class="text-xs">{entry.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button
					variant="outline"
					size="sm"
					class="h-7 gap-1 font-mono text-xs"
					onclick={addMiniStage}
				>
					<Plus class="h-3 w-3" /> add stage
				</Button>
			</div>

			{#if structuredBody.length === 0}
				<p class="text-xs text-muted-foreground italic">no loop mini stages</p>
			{/if}

			{#each structuredBody as mini, idx}
				<div class="space-y-2 border-l border-border/50 py-1 pl-3">
					<div class="flex items-center gap-2">
						<Select.Root
							type="single"
							value={mini.type}
							onValueChange={(value) => changeMiniType(idx, value as LoopMiniStageType)}
						>
							<Select.Trigger class="h-7 w-36 text-xs">{mini.type}</Select.Trigger>
							<Select.Content>
								{#each LOOP_MINI_STAGE_TYPES as entry}
									<Select.Item value={entry.value} class="text-xs">{entry.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<button
							class="inline-flex h-7 items-center gap-1 rounded px-2 font-mono text-xs text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive"
							onclick={() => removeMiniStage(idx)}
						>
							<X class="h-3 w-3" /> remove
						</button>
					</div>

					{#if mini.type === 'filter'}
						<FilterStageEditor
							stage={mini as FilterStageModel}
							availableColumns={miniColsAt(idx)}
							onUpdate={(next) => updateMiniStage(idx, next as LoopMiniStage)}
						/>
					{:else if mini.type === 'select'}
						<SelectStageEditor
							stage={mini as SelectStageModel}
							availableColumns={miniColsAt(idx)}
							onUpdate={(next) => updateMiniStage(idx, next as LoopMiniStage)}
						/>
					{:else if mini.type === 'derive'}
						<DeriveStageEditor
							stage={mini as DeriveStageModel}
							availableColumns={miniColsAt(idx)}
							onUpdate={(next) => updateMiniStage(idx, next as LoopMiniStage)}
						/>
					{:else if mini.type === 'sort'}
						<SortStageEditor
							stage={mini as SortStageModel}
							availableColumns={miniColsAt(idx)}
							onUpdate={(next) => updateMiniStage(idx, next as LoopMiniStage)}
						/>
					{:else if mini.type === 'take'}
						<TakeStageEditor
							stage={mini as TakeStageModel}
							onUpdate={(next) => updateMiniStage(idx, next as LoopMiniStage)}
						/>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
