<script lang="ts">
	import { Table2, TrendingUp, Sigma } from '@lucide/svelte';
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
	class="notebook-tabs {size === 'md' ? 'is-md' : ''}"
	role="tablist"
	aria-label="Result view mode"
	data-testid="result-view-tabs"
>
	{#each items as item (item.mode)}
		{@const Icon = item.icon}
		<button
			type="button"
			data-testid={`result-view-${item.mode}`}
			role="tab"
			aria-selected={viewMode === item.mode}
			class="notebook-tab"
			class:is-active={viewMode === item.mode}
			onmousedown={(event) => handlePointerDown(event, item.mode)}
			onclick={(event) => handleClick(event, item.mode)}
		>
			<Icon class="h-3 w-3" />
			{item.label}
		</button>
	{/each}
</div>
