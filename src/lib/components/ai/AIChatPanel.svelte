<script lang="ts">
	import { X, Sparkles, RotateCcw, SlidersHorizontal } from '@lucide/svelte';
	import AIChatThread from './AIChatThread.svelte';
	import AIChatInput from './AIChatInput.svelte';
	import WorkspaceStandards from './WorkspaceStandards.svelte';
	import SprintBoard from './SprintBoard.svelte';
	import { setAIChatOpen, getUndoAvailable, clearMessages, getMessages, getCheckpointCount, getConfirmationRequest, resolveConfirmation, getPendingPlanProposal, resolvePlanApproval, setUndoAvailable, setPendingSnapshot, getSprintTasks, isSprintPlanPendingApproval, resolveSprintPlanApproval } from '$lib/stores/ai-chat.svelte.js';
	import { undoAIChanges, undoLastAIStep, resetAISession } from '$lib/services/ai-chat-client.js';

	interface Props {
		width: number;
		onStartResize: (e: PointerEvent) => void;
	}

	let { width, onStartResize }: Props = $props();

	let undoAvailable = $derived(getUndoAvailable());
	let checkpointCount = $derived(getCheckpointCount());
	let confirmationRequest = $derived(getConfirmationRequest());
	let planProposal = $derived(getPendingPlanProposal());
	let messageCount = $derived(getMessages().length);
	let sprintTasks = $derived(getSprintTasks());
	let sprintPlanPending = $derived(isSprintPlanPendingApproval());
	let sprintFeedback = $state('');
	let standardsOpen = $state(false);
</script>

<!-- Resize handle -->
<div
	class="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize"
	onpointerdown={onStartResize}
	role="separator"
	aria-orientation="vertical"
>
	<div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/40 transition-colors group-hover:bg-primary/40 group-active:bg-primary/60"></div>
</div>

<!-- Panel -->
<div
	class="flex shrink-0 flex-col border-l border-border/40 bg-sidebar "
	style="width: {width}px;"
	data-testid="ai-panel"
>
	<!-- Header -->
	<div class="flex h-9 shrink-0 items-center justify-between border-b border-border/40 px-2.5">
		<div class="flex items-center gap-1.5 text-sm font-medium text-foreground">
			<Sparkles size={14} class="text-primary" />
			<span>AI</span>
		</div>
		<div class="flex items-center gap-0.5">
			<button
				class="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-muted {standardsOpen ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (standardsOpen = !standardsOpen)}
				title="Modeling standards"
			>
				<SlidersHorizontal size={12} />
			</button>
			{#if messageCount > 0}
				<button
					class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onclick={() => { clearMessages(); resetAISession(); setUndoAvailable(false); setPendingSnapshot(null); }}
					title="Clear conversation"
				>
					<RotateCcw size={12} />
				</button>
			{/if}
			<button
				class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				onclick={() => setAIChatOpen(false)}
				title="Close AI panel (⌘J)"
			>
				<X size={13} />
			</button>
		</div>
	</div>

	<!-- Modeling standards panel -->
	{#if standardsOpen}
		<WorkspaceStandards />
	{/if}

	<!-- Plan proposal gate — shows the modeling plan before sql-gen starts -->
	{#if planProposal}
		<div class="border-b border-primary-500/30 bg-primary-500/6 px-3 py-2" data-testid="ai-plan-proposal">
			<div class="mb-1.5 text-xs font-medium text-primary-600 dark:text-primary-400">Plan to build:</div>
			<ul class="mb-2 space-y-1">
				{#each planProposal.models as model}
					<li class="text-xs text-foreground/80">
						<span class="font-mono font-medium">{model.name}</span>
						{#if model.grain}<span class="text-muted-foreground"> — {model.grain}</span>{/if}
						{#if model.depends_on?.length}<span class="text-muted-foreground"> (uses {model.depends_on.join(', ')})</span>{/if}
					</li>
				{/each}
			</ul>
			{#if planProposal.note}
				<p class="mb-2 text-xs text-muted-foreground">{planProposal.note}</p>
			{/if}
			<div class="flex items-center gap-3">
				<button
					class="text-xs text-muted-foreground underline-offset-2 hover:underline"
					onclick={() => resolvePlanApproval(false)}
				>
					Cancel
				</button>
				<button
					class="text-xs font-medium text-primary-600 underline-offset-2 hover:underline dark:text-primary-400"
					onclick={() => resolvePlanApproval(true)}
				>
					Looks good — build it
				</button>
			</div>
		</div>
	{/if}

	<!-- Sprint board — visible while sprint tasks are active or complete -->
	{#if sprintTasks.length > 0}
		<SprintBoard tasks={sprintTasks} />
	{/if}

	<!-- Sprint plan refinement gate — pause before execution so user can iterate on the plan -->
	{#if sprintPlanPending}
		<div class="border-b border-primary/30 bg-primary/5 px-3 py-2" data-testid="ai-sprint-plan-gate">
			<textarea
				bind:value={sprintFeedback}
				placeholder="Request changes to the plan… or click Start Building"
				rows={2}
				class="mb-2 w-full resize-none rounded border border-border/50 bg-background/60 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/60"
			></textarea>
			<div class="flex items-center gap-3">
				<button
					class="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-40"
					disabled={!sprintFeedback.trim()}
					onclick={() => { resolveSprintPlanApproval(sprintFeedback.trim()); sprintFeedback = ''; }}
				>
					Refine
				</button>
				<button
					class="text-xs font-medium text-primary underline-offset-2 hover:underline"
					onclick={() => resolveSprintPlanApproval(null)}
				>
					Start Building
				</button>
			</div>
		</div>
	{/if}

	<!-- Confirmation gate bar -->
	{#if confirmationRequest}
		<div class="flex items-center justify-between border-b border-amber-500/30 bg-amber-500/8 px-3 py-1.5" data-testid="ai-confirm-bar">
			<span class="text-xs text-amber-600 dark:text-amber-400">
				{confirmationRequest.cellCount} cells created — run them?
			</span>
			<div class="flex items-center gap-2">
				<button
					class="text-xs text-muted-foreground underline-offset-2 hover:underline"
					onclick={() => resolveConfirmation(false)}
				>
					Cancel
				</button>
				<button
					class="text-xs font-medium text-primary underline-offset-2 hover:underline"
					onclick={() => resolveConfirmation(true)}
				>
					Proceed
				</button>
			</div>
		</div>
	{/if}

	<!-- Undo bar -->
	{#if undoAvailable}
		<div class="flex items-center justify-between border-b border-primary/20 bg-primary/5 px-3 py-1.5" data-testid="ai-undo-bar">
			<span class="text-xs text-primary/80">AI changes applied</span>
			<div class="flex items-center gap-3">
				{#if checkpointCount > 1}
					<button
						class="text-xs text-primary/70 underline-offset-2 hover:underline"
						onclick={undoLastAIStep}
					>
						Undo last step
					</button>
				{/if}
				<button
					class="text-xs font-medium text-primary underline-offset-2 hover:underline"
					onclick={undoAIChanges}
				>
					Undo all
				</button>
			</div>
		</div>
	{/if}

	<!-- Thread -->
	<AIChatThread />

	<!-- Input -->
	<AIChatInput />
</div>
