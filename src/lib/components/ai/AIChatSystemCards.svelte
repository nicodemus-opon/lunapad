<script lang="ts">
	import { X } from '@lucide/svelte';
	import { SPRINT_TASK_STYLE } from './sprint-task-style.js';
	import {
		getUndoAvailable,
		getCheckpointCount,
		getConfirmationRequest,
		resolveConfirmation,
		getPendingPlanProposal,
		resolvePlanApproval,
		getSprintTasks,
		setSprintTasks,
		isSprintPlanPendingApproval,
		resolveSprintPlanApproval
	} from '$lib/stores/ai-chat.svelte.js';
	import { undoAIChanges, undoLastAIStep } from '$lib/services/ai-chat-client.js';

	let undoAvailable = $derived(getUndoAvailable());
	let checkpointCount = $derived(getCheckpointCount());
	let confirmationRequest = $derived(getConfirmationRequest());
	let planProposal = $derived(getPendingPlanProposal());
	let sprintTasks = $derived(getSprintTasks());
	let sprintPlanPending = $derived(isSprintPlanPendingApproval());
	let sprintFeedback = $state('');

	let hasCards = $derived(
		!!planProposal || sprintPlanPending || !!confirmationRequest || undoAvailable
	);
</script>

{#if hasCards}
	<div
		class="sticky bottom-0 z-10 flex flex-col gap-2 bg-gradient-to-t from-sidebar from-80% to-transparent px-3 pt-4 pb-2"
	>
		{#if planProposal}
			<div
				class="rounded-lg border border-primary/30 bg-background/95 px-3 py-2.5 shadow-sm backdrop-blur-sm"
				data-testid="ai-plan-proposal"
			>
				<div class="mb-1.5 text-xs font-medium text-primary">Build this?</div>
				<ul class="mb-2 space-y-1">
					{#each planProposal.models as model}
						<li class="text-xs text-foreground/80">
							<span class="font-mono font-medium">{model.name}</span>
							{#if model.grain}<span class="text-muted-foreground"> — {model.grain}</span>{/if}
							{#if model.depends_on?.length}<span class="text-muted-foreground">
									(uses {model.depends_on.join(', ')})</span
								>{/if}
						</li>
					{/each}
				</ul>
				{#if planProposal.note}
					<p class="mb-2 text-xs text-muted-foreground">{planProposal.note}</p>
				{/if}
				<div class="flex items-center justify-end gap-2">
					<button
						class="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
						onclick={() => resolvePlanApproval(false)}
					>
						Cancel
					</button>
					<button
						class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
						onclick={() => resolvePlanApproval(true)}
					>
						Build it
					</button>
				</div>
			</div>
		{/if}

		{#if sprintPlanPending}
			<div
				class="rounded-lg border border-primary/30 bg-background/95 px-3 py-2.5 shadow-sm backdrop-blur-sm"
				data-testid="ai-sprint-plan-gate"
			>
				<div class="mb-2 text-xs font-medium text-foreground">
					Plan · {sprintTasks.length} task{sprintTasks.length === 1 ? '' : 's'}
				</div>
				<ul class="mb-2.5 space-y-1.5">
					{#each sprintTasks as task (task.id)}
						{@const style = SPRINT_TASK_STYLE[task.type]}
						{@const TypeIcon = style.icon}
						<li
							class="flex items-start gap-2 rounded border border-border/40 bg-muted/30 px-2 py-1.5"
							data-testid="ai-sprint-plan-task"
						>
							<span
								class="mt-0.5 shrink-0"
								style="color: var({style.colorVar})"
								title={style.label}
							>
								<TypeIcon size={12} />
							</span>
							<div class="min-w-0 flex-1">
								<span class="block text-xs font-medium text-foreground">{task.title}</span>
								{#if task.successCriteria}
									<span class="block text-xs text-muted-foreground/70">{task.successCriteria}</span>
								{/if}
							</div>
							<button
								class="mt-0.5 shrink-0 rounded text-muted-foreground/50 transition-colors hover:text-destructive"
								onclick={() => setSprintTasks(sprintTasks.filter((t) => t.id !== task.id))}
								title="Remove this task from the plan"
								aria-label="Remove task"
							>
								<X size={11} />
							</button>
						</li>
					{/each}
				</ul>
				<textarea
					bind:value={sprintFeedback}
					placeholder="Request changes to the plan… or click Start Building"
					rows={2}
					class="mb-2 w-full resize-none rounded border border-border/50 bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary/60"
				></textarea>
				<div class="flex items-center justify-end gap-2">
					<button
						class="rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
						disabled={!sprintFeedback.trim()}
						onclick={() => {
							resolveSprintPlanApproval(sprintFeedback.trim());
							sprintFeedback = '';
						}}
					>
						Refine
					</button>
					<button
						class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
						disabled={sprintTasks.length === 0}
						onclick={() => resolveSprintPlanApproval(null)}
					>
						Start Building
					</button>
				</div>
			</div>
		{/if}

		{#if confirmationRequest}
			<div
				class="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/8 px-3 py-2 shadow-sm backdrop-blur-sm"
				data-testid="ai-confirm-bar"
			>
				<span class="text-xs text-amber-600 dark:text-amber-400">
					{confirmationRequest.cellCount} cells created — run them?
				</span>
				<div class="flex items-center gap-2">
					<button
						class="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60"
						onclick={() => resolveConfirmation(false)}
					>
						Cancel
					</button>
					<button
						class="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
						onclick={() => resolveConfirmation(true)}
					>
						Proceed
					</button>
				</div>
			</div>
		{/if}

		{#if undoAvailable}
			<div
				class="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 shadow-sm backdrop-blur-sm"
				data-testid="ai-undo-bar"
			>
				<span class="text-xs text-primary/80">AI changes applied</span>
				<div class="flex items-center gap-2">
					{#if checkpointCount > 1}
						<button
							class="rounded-md px-2 py-1 text-xs text-primary/70 transition-colors hover:bg-primary/10"
							onclick={undoLastAIStep}
						>
							Undo last step
						</button>
					{/if}
					<button
						class="rounded-md px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
						onclick={undoAIChanges}
					>
						Undo all
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}
