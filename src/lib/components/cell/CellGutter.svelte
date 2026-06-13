<script lang="ts">
	import { Loader2, Play, X, XCircle } from '@lucide/svelte';
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
		menu: Snippet;
	} = $props();

	let runHovered = $state(false);
	// Stale, running, and failed cells keep their run affordance visible at all
	// times — it's the primary signal and the primary fix in one button.
	const runAlwaysVisible = $derived(running || needsRun || status === 'error');

	// Success flash — brief green color after a successful run
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

	// Stale ring pulse — one-shot ring when needsRun flips to true
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
</script>

<div class="flex items-start justify-end gap-px pt-1 pr-1 select-none">
	{#if isQueryCell}
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					class="flex h-6 w-6 items-center justify-center rounded border transition-[opacity,background-color,color,border-color] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 {runAlwaysVisible ||
					revealed
						? 'opacity-100'
						: 'pointer-events-none opacity-0'} {justSucceeded
						? 'text-success bg-success/8 border-success/25 run-btn-success-pulse'
						: stalePulsing
							? 'run-btn-stale-pulse text-warning bg-warning/8 border-warning/25'
							: needsRun && !running
								? 'text-warning bg-warning/8 border-warning/20 hover:bg-warning/15'
								: status === 'error' && !running
									? 'text-destructive bg-destructive/8 border-destructive/20 hover:bg-destructive/15'
									: 'text-muted-foreground border-transparent hover:bg-muted/60 hover:border-border/40 hover:text-foreground'}"
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

	<div
		class="transition-opacity duration-150 {revealed
			? 'opacity-100'
			: 'pointer-events-none opacity-0'}"
	>
		{@render menu()}
	</div>
</div>
