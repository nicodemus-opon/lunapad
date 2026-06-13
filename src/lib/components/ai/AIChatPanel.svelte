<script lang="ts">
	import { X, Sparkles, RotateCcw } from '@lucide/svelte';
	import AIChatThread from './AIChatThread.svelte';
	import AIChatInput from './AIChatInput.svelte';
	import { setAIChatOpen, getUndoAvailable, clearMessages, getMessages } from '$lib/stores/ai-chat.svelte.js';
	import { undoAIChanges } from '$lib/services/ai-chat-client.js';

	interface Props {
		width: number;
		onStartResize: (e: PointerEvent) => void;
	}

	let { width, onStartResize }: Props = $props();

	let undoAvailable = $derived(getUndoAvailable());
	let messageCount = $derived(getMessages().length);
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
	class="flex shrink-0 flex-col border-l border-border/40 bg-background"
	style="width: {width}px;"
>
	<!-- Header -->
	<div class="flex h-9 shrink-0 items-center justify-between border-b border-border/40 px-2.5">
		<div class="flex items-center gap-1.5 text-sm font-medium text-foreground">
			<Sparkles size={14} class="text-primary" />
			<span>AI</span>
		</div>
		<div class="flex items-center gap-0.5">
			{#if messageCount > 0}
				<button
					class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onclick={clearMessages}
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

	<!-- Undo bar -->
	{#if undoAvailable}
		<div class="flex items-center justify-between border-b border-primary/20 bg-primary/5 px-3 py-1.5">
			<span class="text-xs text-primary/80">AI changes applied</span>
			<button
				class="text-xs font-medium text-primary underline-offset-2 hover:underline"
				onclick={undoAIChanges}
			>
				Undo
			</button>
		</div>
	{/if}

	<!-- Thread -->
	<AIChatThread />

	<!-- Input -->
	<AIChatInput />
</div>
