<script lang="ts">
	import { tick } from 'svelte';
	import AIChatMessage from './AIChatMessage.svelte';
	import { getMessages } from '$lib/stores/ai-chat.svelte.js';

	let messages = $derived(getMessages());
	let scrollEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		// Scroll to bottom when messages change or streaming updates
		if (messages.length) {
			tick().then(() => {
				if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
			});
		}
	});
</script>

<div
	bind:this={scrollEl}
	class="flex min-h-0 flex-1 flex-col overflow-y-auto py-1"
>
	{#if messages.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted-foreground">
					<path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"/>
					<path d="M18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z"/>
				</svg>
			</div>
			<div>
				<p class="text-sm font-medium text-foreground">AI Analysis</p>
				<p class="mt-0.5 text-xs text-muted-foreground">Ask me to explore your data, write queries, or build a full analysis with charts.</p>
			</div>
			<div class="mt-2 flex flex-col gap-1.5 text-left w-full">
				{#each ['Analyze orders by region and month', 'Create a revenue dashboard', 'Find the top 10 customers by spend'] as suggestion}
					<button
						class="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
						onclick={() => {
							// Dispatch to parent via custom event
							const el = document.querySelector('.ai-chat-input textarea') as HTMLTextAreaElement | null;
							if (el) {
								el.value = suggestion;
								el.dispatchEvent(new Event('input'));
								el.focus();
							}
						}}
					>
						{suggestion}
					</button>
				{/each}
			</div>
		</div>
	{:else}
		{#each messages as message (message.id)}
			<AIChatMessage {message} />
		{/each}
	{/if}
</div>
