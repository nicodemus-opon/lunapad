<script lang="ts">
	import { Table2, TrendingUp, Sigma } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import type { ResultViewMode } from '$lib/types/gui-pipeline';

	interface Props {
		viewMode: ResultViewMode;
		onSwitch: (mode: ResultViewMode) => void;
		/** Tab result view uses slightly taller chrome than the inline cell view */
		size?: 'sm' | 'md';
	}

	let { viewMode, onSwitch, size = 'sm' }: Props = $props();
	let pointerSwitched = false;

	const items: { mode: ResultViewMode; label: string; icon: typeof Table2 }[] = [
		{ mode: 'table', label: 'Table', icon: Table2 },
		{ mode: 'chart', label: 'Chart', icon: TrendingUp },
		{ mode: 'stats', label: 'Stats', icon: Sigma }
	];

	function handlePointerDown(event: MouseEvent, mode: ResultViewMode) {
		event.preventDefault();
		event.stopPropagation();
		pointerSwitched = true;
		onSwitch(mode);
	}

	function handleClick(event: MouseEvent, mode: ResultViewMode) {
		event.stopPropagation();
		if (pointerSwitched) {
			pointerSwitched = false;
			return;
		}
		onSwitch(mode);
	}
</script>

<div
	class="result-view-switcher {size === 'md' ? 'is-md' : ''}"
	role="toolbar"
	aria-label="Result view mode"
	data-testid="result-view-tabs"
>
	{#each items as item (item.mode)}
		{@const Icon = item.icon}
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			data-testid={`result-view-${item.mode}`}
			aria-label={item.label}
			aria-pressed={viewMode === item.mode}
			title={item.label}
			class="result-view-switcher__button {viewMode === item.mode ? 'is-active' : ''}"
			onmousedown={(event) => handlePointerDown(event, item.mode)}
			onclick={(event) => handleClick(event, item.mode)}
		>
			<Icon class={size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
		</Button>
	{/each}
</div>

<style>
	.result-view-switcher {
		display: inline-flex;
		align-items: center;
		gap: 0.075rem;
	}

	:global(.result-view-switcher__button) {
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		color: color-mix(in oklab, var(--muted-foreground) 78%, transparent);
		border-radius: var(--radius-sm);
	}

	.is-md :global(.result-view-switcher__button) {
		width: 1.375rem;
		height: 1.375rem;
	}

	:global(.result-view-switcher__button:hover) {
		color: var(--foreground);
		background: color-mix(in oklab, var(--muted) 45%, transparent);
	}

	:global(.result-view-switcher__button.is-active) {
		color: var(--foreground);
		background: color-mix(in oklab, var(--muted) 62%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--border) 72%, transparent);
	}
</style>
