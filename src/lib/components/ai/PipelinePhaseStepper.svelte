<script lang="ts">
	import { CheckCircle, Circle, Loader } from '@lucide/svelte';
	import type { PipelinePhase } from '$lib/types/ai-chat.js';
	import { getCurrentActivityLabel } from '$lib/stores/ai-chat.svelte.js';

	interface Props {
		phases: PipelinePhase[];
	}

	let { phases }: Props = $props();

	let activityLabel = $derived(getCurrentActivityLabel());
</script>

<div class="border-b border-border/40 bg-muted/20 px-3 py-1.5" data-testid="ai-pipeline-stepper">
	<ul class="flex flex-wrap items-center gap-x-1 gap-y-1">
		{#each phases as phase, i (phase.id)}
			<li class="flex items-center gap-1">
				{#if phase.status === 'done'}
					<CheckCircle size={11} class="text-green-500" />
				{:else if phase.status === 'active'}
					<Loader size={11} class="animate-spin text-primary" />
				{:else}
					<Circle size={11} class="text-muted-foreground/40" />
				{/if}
				<span
					class="text-[11px] leading-relaxed
						{phase.status === 'done' ? 'text-muted-foreground/60' :
						 phase.status === 'active' ? 'font-medium text-foreground' :
						 'text-muted-foreground/40'}"
				>
					{phase.label}
				</span>
			</li>
			{#if i < phases.length - 1}
				<li class="text-muted-foreground/30" aria-hidden="true">→</li>
			{/if}
		{/each}
	</ul>
	{#if activityLabel}
		<p class="mt-0.5 truncate text-[10px] text-primary/70">{activityLabel}</p>
	{/if}
</div>
