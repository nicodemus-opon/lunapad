<script lang="ts">
	import { CheckCircle2, Circle, Loader2 } from '@lucide/svelte';
	import type { PipelinePhase } from '$lib/types/ai-chat.js';
	import { getCurrentActivityLabel } from '$lib/stores/ai-chat.svelte.js';

	interface Props {
		phases: PipelinePhase[];
		/** When true, render without outer border bar styling. */
		embedded?: boolean;
	}

	let { phases, embedded = false }: Props = $props();

	let activityLabel = $derived(getCurrentActivityLabel());
</script>

<div
	class={embedded ? 'px-2 py-1.5' : 'border-b border-border bg-muted/20 px-3 py-1.5'}
	data-testid="ai-pipeline-stepper"
>
	<ul class="flex flex-wrap items-center gap-x-1 gap-y-1">
		{#each phases as phase, i (phase.id)}
			<li class="flex items-center gap-1">
				{#if phase.status === 'done'}
					<CheckCircle2 size={11} class="text-success" />
				{:else if phase.status === 'active'}
					<Loader2 size={11} class="animate-spin text-primary" />
				{:else}
					<Circle size={11} class="text-muted-foreground/40" />
				{/if}
				<span
					class="text-xs leading-relaxed
						{phase.status === 'done'
						? 'text-muted-foreground/60'
						: phase.status === 'active'
							? 'font-medium text-foreground'
							: 'text-muted-foreground/40'}"
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
		<p class="mt-0.5 truncate text-xs text-primary/70">{activityLabel}</p>
	{/if}
</div>
