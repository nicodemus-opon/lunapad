<script lang="ts">
	import { tick } from 'svelte';
	import { Sparkles } from '@lucide/svelte';
	import AIChatMessage from './AIChatMessage.svelte';
	import AIChatSystemCards from './AIChatSystemCards.svelte';
	import { getMessages, setPendingSuggestion } from '$lib/stores/ai-chat.svelte.js';

	let messages = $derived(getMessages());
	let scrollEl: HTMLDivElement | undefined = $state();
	let wasAtBottom = true;

	function nearBottom(): boolean {
		if (!scrollEl) return true;
		return scrollEl.scrollHeight - (scrollEl.scrollTop + scrollEl.clientHeight) < 40;
	}

	$effect.pre(() => {
		const last = messages[messages.length - 1];
		void [
			messages.length,
			last?.text.length,
			last?.actionEvents.length,
			last?.isStreaming,
			last?.suggestions?.length
		];
		wasAtBottom = nearBottom();
	});

	$effect(() => {
		const last = messages[messages.length - 1];
		void [
			messages.length,
			last?.text.length,
			last?.actionEvents.length,
			last?.isStreaming,
			last?.suggestions?.length
		];
		if (!wasAtBottom) return;
		tick().then(() => {
			if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
		});
	});

	function handleSuggestion(text: string): void {
		setPendingSuggestion(text);
	}

	const suggestions = ['Analyze orders by region and month', 'Create a revenue dashboard'];
</script>

<div
	bind:this={scrollEl}
	class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background py-1"
	data-testid="ai-thread"
>
	{#if messages.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
				<Sparkles class="h-5 w-5 text-muted-foreground" />
			</div>
			<div>
				<p class="text-sm font-medium text-foreground">Assistant</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					Ask me to explore your data, write queries, or build a full analysis with charts.
				</p>
			</div>
			<div class="mt-1 flex flex-wrap justify-center gap-2">
				{#each suggestions as suggestion}
					<button
						class="rounded-full border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
						onclick={() => setPendingSuggestion(suggestion)}
						data-testid="ai-empty-suggestion"
					>
						{suggestion}
					</button>
				{/each}
			</div>
		</div>
	{:else}
		{#each messages as message (message.id)}
			<AIChatMessage {message} onSuggestion={handleSuggestion} />
		{/each}
	{/if}

	<AIChatSystemCards />
</div>
