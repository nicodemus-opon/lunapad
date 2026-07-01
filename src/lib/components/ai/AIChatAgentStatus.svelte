<script lang="ts">
	import { ChevronDown, ChevronRight, Loader } from '@lucide/svelte';
	import SprintBoard from './SprintBoard.svelte';
	import PipelinePhaseStepper from './PipelinePhaseStepper.svelte';
	import {
		getSprintTasks,
		getPipelinePhases,
		getIsGenerating,
		getCurrentActivityLabel
	} from '$lib/stores/ai-chat.svelte.js';

	let sprintTasks = $derived(getSprintTasks());
	let pipelinePhases = $derived(getPipelinePhases());
	let isGenerating = $derived(getIsGenerating());
	let activityLabel = $derived(getCurrentActivityLabel());

	let expanded = $state(false);

	let doneCount = $derived(
		sprintTasks.filter((t) => t.status === 'done' || t.status === 'skipped').length
	);
	let allDone = $derived(
		sprintTasks.length > 0 &&
			sprintTasks.every((t) => t.status === 'done' || t.status === 'skipped')
	);
	let activePhase = $derived(pipelinePhases.find((p) => p.status === 'active'));

	let visible = $derived(
		pipelinePhases.length > 0 ||
			sprintTasks.length > 0 ||
			(isGenerating && sprintTasks.length === 0 && !!activityLabel && pipelinePhases.length === 0)
	);

	let summary = $derived.by(() => {
		if (pipelinePhases.length > 0) {
			return activePhase?.label ?? pipelinePhases[pipelinePhases.length - 1]?.label ?? 'Working…';
		}
		if (sprintTasks.length > 0) {
			return `Building · ${doneCount}/${sprintTasks.length} tasks`;
		}
		return activityLabel ?? 'Working…';
	});

	// Collapse when all sprint tasks finish
	$effect(() => {
		if (allDone) expanded = false;
	});

	// Expand while actively generating sprint tasks (until first completes)
	$effect(() => {
		const hasActive = sprintTasks.some((t) => t.status === 'active');
		if (hasActive && !allDone) expanded = true;
	});
</script>

{#if visible}
	<div
		class="shrink-0 border-t border-border/40 bg-sidebar px-2 py-1"
		data-testid="ai-agent-status"
	>
		{#if pipelinePhases.length > 0 || sprintTasks.length > 0}
			<button
				class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/40"
				onclick={() => (expanded = !expanded)}
			>
				{#if expanded}
					<ChevronDown size={12} class="shrink-0 text-muted-foreground" />
				{:else}
					<ChevronRight size={12} class="shrink-0 text-muted-foreground" />
				{/if}
				{#if isGenerating && !allDone}
					<Loader size={12} class="shrink-0 animate-spin text-primary" />
				{/if}
				<span class="flex-1 truncate text-xs text-muted-foreground">{summary}</span>
			</button>
			{#if expanded}
				<div class="mt-0.5 overflow-hidden rounded-md border border-border/30 bg-muted/20">
					{#if pipelinePhases.length > 0}
						<PipelinePhaseStepper phases={pipelinePhases} embedded />
					{:else if sprintTasks.length > 0}
						<SprintBoard tasks={sprintTasks} embedded />
					{/if}
				</div>
			{/if}
		{:else}
			<div
				class="flex items-center gap-1.5 px-1.5 py-1 text-xs text-muted-foreground"
				data-testid="ai-activity-bar"
			>
				<Loader size={12} class="shrink-0 animate-spin text-primary" />
				<span class="truncate">{activityLabel}</span>
			</div>
		{/if}
	</div>
{/if}
