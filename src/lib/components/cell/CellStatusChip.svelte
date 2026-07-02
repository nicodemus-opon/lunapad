<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import type { Snippet } from 'svelte';

	type Tone = 'neutral' | 'warning' | 'positive' | 'destructive';

	let {
		tone = 'neutral',
		label,
		content,
		open = $bindable(false),
		onOpenChange
	}: {
		tone?: Tone;
		label: Snippet;
		content: Snippet;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	} = $props();

	const toneClass: Record<Tone, string> = {
		neutral:
			'border-border/30 bg-muted/10 text-muted-foreground hover:bg-muted/20 hover:text-foreground',
		warning: 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/20',
		positive: 'border-success/30 bg-success/10 text-success hover:bg-success/20',
		destructive: 'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20'
	};
</script>

<Popover.Root bind:open {onOpenChange}>
	<Popover.Trigger
		class="inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-2xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-2.5 [&_svg]:shrink-0 {toneClass[
			tone
		]}"
	>
		{@render label()}
	</Popover.Trigger>
	<Popover.Content class="w-auto max-w-80 p-3">
		{@render content()}
	</Popover.Content>
</Popover.Root>
