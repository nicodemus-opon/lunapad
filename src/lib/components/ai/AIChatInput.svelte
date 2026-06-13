<script lang="ts">
	import { Send, Square, X } from '@lucide/svelte';
	import { getAIChatOpen, getContextCellIds, removeContextCell, getIsGenerating, abortGeneration } from '$lib/stores/ai-chat.svelte.js';
	import { getCells } from '$lib/stores/notebook.svelte.js';
	import { submitAIMessage } from '$lib/services/ai-chat-client.js';

	let text = $state('');
	let isGenerating = $derived(getIsGenerating());
	let contextCellIds = $derived(getContextCellIds());
	let cells = $derived(getCells());
	let textareaEl: HTMLTextAreaElement | undefined = $state();

	function contextPills() {
		return contextCellIds.map((id) => {
			const cell = cells.find((c) => c.id === id);
			return { id, name: cell?.outputName ?? id };
		});
	}

	async function submit() {
		const value = text.trim();
		if (!value || isGenerating) return;
		text = '';
		adjustHeight();
		await submitAIMessage(value);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void submit();
		}
	}

	function adjustHeight() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 160)}px`;
	}
</script>

<div class="ai-chat-input border-t border-border/50 p-2">
	<!-- Context pills -->
	{#if contextCellIds.length > 0}
		<div class="mb-1.5 flex flex-wrap gap-1 px-1">
			{#each contextPills() as pill}
				<span class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/8 px-2 py-0.5 text-2xs text-primary">
					<span class="font-mono">{pill.name}</span>
					<button
						class="rounded-full hover:text-destructive"
						onclick={() => removeContextCell(pill.id)}
						aria-label="Remove context"
					>
						<X size={9} />
					</button>
				</span>
			{/each}
		</div>
	{/if}

	<div class="flex items-end gap-1.5">
		<textarea
			bind:this={textareaEl}
			bind:value={text}
			oninput={adjustHeight}
			onkeydown={onKeydown}
			rows={1}
			placeholder="Ask anything about your data…"
			disabled={isGenerating}
			class="min-h-8 flex-1 resize-none rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors focus:border-primary/60 focus:bg-background disabled:opacity-50"
			style="height: 36px; overflow-y: hidden;"
		></textarea>

		{#if isGenerating}
			<button
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
				onclick={abortGeneration}
				title="Stop generation"
			>
				<Square size={14} />
			</button>
		{:else}
			<button
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
				disabled={!text.trim()}
				onclick={submit}
				title="Send (Enter)"
			>
				<Send size={13} />
			</button>
		{/if}
	</div>
	<p class="mt-1 px-1 text-2xs text-muted-foreground/50">Enter to send · Shift+Enter for new line</p>
</div>
