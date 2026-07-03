<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import type { Snippet } from 'svelte';

	type Tone = 'neutral' | 'warning' | 'positive' | 'destructive';

	let {
		tone = 'neutral',
		label,
		content,
		open = $bindable(false),
		onOpenChange,
		onclick,
		class: className = '',
		ariaLabel
	}: {
		tone?: Tone;
		label: Snippet;
		content?: Snippet;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		onclick?: (e: MouseEvent) => void;
		class?: string;
		ariaLabel?: string;
	} = $props();

	const toneClass: Record<Tone, string> = {
		neutral:
			'border-border bg-muted/10 text-muted-foreground hover:bg-muted/20 hover:text-foreground',
		warning: 'border-warning bg-warning/10 text-warning hover:bg-warning/20',
		positive: 'border-success bg-success/10 text-success hover:bg-success/20',
		destructive: 'border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20'
	};

	const chipClass = $derived(
		`inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-2xs font-medium transition-colors outline-none [&_svg]:size-2.5 [&_svg]:shrink-0 ${toneClass[tone]} ${className}`
	);
</script>

{#if content}
	<Popover.Root bind:open {onOpenChange}>
		<Popover.Trigger
			class="{chipClass} focus-visible:ring-2 focus-visible:ring-ring/50"
			aria-label={ariaLabel}
		>
			{@render label()}
		</Popover.Trigger>
		<Popover.Content class="w-auto max-w-80 p-3">
			{@render content()}
		</Popover.Content>
	</Popover.Root>
{:else if onclick}
	<button
		type="button"
		class="{chipClass} focus-visible:ring-2 focus-visible:ring-ring/50"
		{onclick}
		aria-label={ariaLabel}
	>
		{@render label()}
	</button>
{:else}
	<span class={chipClass} title={ariaLabel}>
		{@render label()}
	</span>
{/if}
