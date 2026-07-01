<script lang="ts">
	import { Loader2, MessageSquare, Play, X, XCircle } from '@lucide/svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { Snippet } from 'svelte';
	import type { CellStatus } from '$lib/stores/notebook.svelte';

	let {
		isQueryCell,
		revealed,
		status,
		needsRun,
		running,
		runTooltip,
		onRun,
		onCancel,
		onComments,
		commentCount = 0,
		menu
	}: {
		isQueryCell: boolean;
		revealed: boolean;
		status: CellStatus;
		needsRun: boolean;
		running: boolean;
		runTooltip: string;
		onRun: () => void;
		onCancel: () => void;
		onComments?: () => void;
		commentCount?: number;
		menu: Snippet;
	} = $props();

	let runHovered = $state(false);
	const runAlwaysVisible = $derived(running || needsRun || status === 'error');
	const commentsAlwaysVisible = $derived(commentCount > 0);
	const showChrome = $derived(revealed || runAlwaysVisible || commentsAlwaysVisible);

	let justSucceeded = $state(false);
	let prevStatus: typeof status = 'idle';
	$effect(() => {
		const curr = status;
		if (curr === 'success' && prevStatus === 'running') {
			justSucceeded = true;
			setTimeout(() => (justSucceeded = false), 1000);
		}
		prevStatus = curr;
	});

	let stalePulsing = $state(false);
	let prevNeedsRun = false;
	$effect(() => {
		const curr = needsRun;
		if (curr && !prevNeedsRun) {
			stalePulsing = true;
			setTimeout(() => (stalePulsing = false), 600);
		}
		prevNeedsRun = curr;
	});

	const commentBtnClass = $derived(
		commentsAlwaysVisible
			? 'border-primary/20 bg-primary/8 text-primary hover:bg-primary/12'
			: 'border-transparent text-muted-foreground hover:border-border/40 hover:bg-muted/60 hover:text-foreground'
	);
</script>

<div class="flex flex-col items-end gap-px pt-1 pr-1 select-none">
	{#if isQueryCell}
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					class="flex h-6 w-6 items-center justify-center rounded border transition-[opacity,background-color,color,border-color] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 {runAlwaysVisible ||
					revealed
						? 'opacity-100'
						: 'pointer-events-none opacity-0'} {justSucceeded
						? 'run-btn-success-pulse border-success/25 bg-success/8 text-success'
						: stalePulsing
							? 'run-btn-stale-pulse border-warning/25 bg-warning/8 text-warning'
							: needsRun && !running
								? 'border-warning/20 bg-warning/8 text-warning hover:bg-warning/15'
								: status === 'error' && !running
									? 'border-destructive/20 bg-destructive/8 text-destructive hover:bg-destructive/15'
									: 'border-transparent text-muted-foreground hover:border-border/40 hover:bg-muted/60 hover:text-foreground'}"
					aria-label={running ? 'Cancel run' : 'Run cell'}
					onclick={() => (running ? onCancel() : onRun())}
					onmouseenter={() => (runHovered = true)}
					onmouseleave={() => (runHovered = false)}
				>
					{#if running}
						{#if runHovered}
							<X class="h-3.5 w-3.5" />
						{:else}
							<Loader2 class="h-3.5 w-3.5 animate-spin" />
						{/if}
					{:else if status === 'error' && !runHovered}
						<XCircle class="h-3.5 w-3.5" />
					{:else}
						<Play class="h-3 w-3 fill-current" />
					{/if}
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>
				<p class="text-xs">
					{running ? 'Cancel' : status === 'error' ? 'Run failed — run again' : runTooltip}
				</p>
			</Tooltip.Content>
		</Tooltip.Root>
	{/if}

	{#if onComments}
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					class="relative flex h-6 w-6 items-center justify-center rounded border transition-[opacity,background-color,color,border-color] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 {showChrome
						? 'opacity-100'
						: 'pointer-events-none opacity-0'} {commentBtnClass}"
					aria-label={commentCount > 0 ? `${commentCount} open threads` : 'Add comment'}
					onclick={() => onComments()}
				>
					<MessageSquare class="h-3 w-3" />
					{#if commentCount > 0}
						<span
							class="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar"
							aria-hidden="true"
						></span>
					{/if}
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>
				<p class="text-xs">
					{commentCount > 0 ? `${commentCount} open thread${commentCount === 1 ? '' : 's'}` : 'Review'}
					· ⌘⇧C
				</p>
			</Tooltip.Content>
		</Tooltip.Root>
	{/if}

	<div
		class="transition-opacity duration-150 {revealed
			? 'opacity-100'
			: 'pointer-events-none opacity-0'}"
	>
		{@render menu()}
	</div>
</div>
