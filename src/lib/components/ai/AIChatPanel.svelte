<script lang="ts">
	import { X, Sparkles, RotateCcw, SlidersHorizontal, MoreHorizontal } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import AIChatThread from './AIChatThread.svelte';
	import AIChatInput from './AIChatInput.svelte';
	import AIChatAgentStatus from './AIChatAgentStatus.svelte';
	import WorkspaceStandards from './WorkspaceStandards.svelte';
	import {
		setAIChatOpen,
		clearMessages,
		getMessages,
		setUndoAvailable,
		setPendingSnapshot
	} from '$lib/stores/ai-chat.svelte.js';
	import { resetAISession } from '$lib/services/ai-chat-client.js';

	interface Props {
		width: number;
		onStartResize: (e: PointerEvent) => void;
	}

	let { width, onStartResize }: Props = $props();

	let messageCount = $derived(getMessages().length);
	let standardsOpen = $state(false);

	function clearConversation() {
		clearMessages();
		resetAISession();
		setUndoAvailable(false);
		setPendingSnapshot(null);
	}
</script>

<!-- Resize handle -->
<div
	class="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize"
	onpointerdown={onStartResize}
	role="separator"
	aria-orientation="vertical"
>
	<div
		class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/40 transition-colors group-hover:bg-primary/40 group-active:bg-primary/60"
	></div>
</div>

<!-- Panel -->
<div
	class="flex shrink-0 flex-col border-l border-border bg-background"
	style="width: {width}px;"
	data-testid="ai-panel"
>
	<!-- Header -->
	<div class="flex h-9 shrink-0 items-center justify-between border-b border-border px-2.5">
		<div class="flex items-center gap-1.5 text-sm font-medium text-foreground">
			<Sparkles class="h-3.5 w-3.5 text-primary" />
			<span>Assistant</span>
		</div>
		<div class="flex items-center gap-0.5">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
							aria-label="More options"
						>
							<MoreHorizontal class="h-3.5 w-3.5" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-44">
					<DropdownMenu.Item onclick={() => (standardsOpen = true)}>
						<SlidersHorizontal class="mr-2 h-3.5 w-3.5 opacity-60" />
						Modeling standards
					</DropdownMenu.Item>
					{#if messageCount > 0}
						<DropdownMenu.Item onclick={clearConversation}>
							<RotateCcw class="mr-2 h-3.5 w-3.5 opacity-60" />
							Clear conversation
						</DropdownMenu.Item>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<button
				class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				onclick={() => setAIChatOpen(false)}
				title="Close AI panel (⌘J)"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>
	</div>

	<WorkspaceStandards bind:open={standardsOpen} />

	<!-- Thread -->
	<AIChatThread />

	<!-- Agent status (pinned above composer) -->
	<AIChatAgentStatus />

	<!-- Input -->
	<AIChatInput />
</div>
