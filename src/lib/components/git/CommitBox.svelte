<script lang="ts">
	import { GitCommit, Loader2 } from '@lucide/svelte';
	import { getFocusCommitBoxRequest } from '$lib/stores/git.svelte';
	import { Button } from '$lib/components/ui/button';

	let {
		stagedCount,
		behind,
		busy,
		hasConflicts = false,
		message = $bindable(''),
		onCommitOnly,
		onCommitAndSync
	}: {
		stagedCount: number;
		behind: number;
		busy: boolean;
		hasConflicts?: boolean;
		message: string;
		onCommitOnly: () => void;
		onCommitAndSync: () => void;
	} = $props();

	let textareaEl: HTMLTextAreaElement | undefined = $state();
	let seenFocusRequest = -1;

	$effect(() => {
		const request = getFocusCommitBoxRequest();
		if (request > 0 && request !== seenFocusRequest) {
			seenFocusRequest = request;
			textareaEl?.focus();
			textareaEl?.scrollIntoView({ block: 'nearest' });
		}
	});
</script>

<div class="border-b border-border bg-muted/10 px-2 py-2.5">
	<textarea
		bind:this={textareaEl}
		class="w-full resize-none rounded border border-input bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground/40 focus:ring-1 focus:ring-primary/40 focus:outline-none"
		rows="2"
		placeholder={hasConflicts
			? 'Resolve all conflicts before committing'
			: stagedCount > 0
				? `Commit message (${stagedCount} staged file${stagedCount === 1 ? '' : 's'})`
				: 'Stage changes to commit'}
		disabled={stagedCount === 0 || hasConflicts}
		bind:value={message}
	></textarea>
	<div class="mt-1.5 flex gap-1">
		<Button
			size="sm"
			class="flex-1 overflow-hidden text-2xs"
			disabled={busy || !message.trim() || stagedCount === 0 || hasConflicts}
			title={behind > 0 ? 'Pull, commit & sync' : 'Commit and sync'}
			onclick={onCommitAndSync}
		>
			{#if busy}<Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin" />{:else}<GitCommit
					class="h-3.5 w-3.5 shrink-0"
				/>{/if}
			<span class="truncate">{behind > 0 ? 'Pull, commit & sync' : 'Commit and sync'}</span>
		</Button>
		<Button
			variant="outline"
			size="sm"
			class="shrink-0 text-2xs"
			disabled={busy || !message.trim() || stagedCount === 0 || hasConflicts}
			title="Commit without pushing"
			onclick={onCommitOnly}
		>
			Commit only
		</Button>
	</div>
</div>
