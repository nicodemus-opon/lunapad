<script lang="ts">
	import type { ResultViewMode } from '$lib/types/gui-pipeline';

	interface Props {
		viewMode: ResultViewMode;
		onSwitch: (mode: ResultViewMode) => void;
		/** Tab result view uses slightly taller chrome than the inline cell view */
		size?: 'sm' | 'md';
	}

	let { viewMode, onSwitch, size = 'sm' }: Props = $props();
	let pointerSwitched = false;

	const items: { mode: ResultViewMode; label: string }[] = [
		{ mode: 'table', label: 'Table' },
		{ mode: 'chart', label: 'Chart' },
		{ mode: 'stats', label: 'Stats' }
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
	role="toolbar"
	aria-label="Result view mode"
	data-testid="result-view-tabs"
>
	{#each items as item (item.mode)}
		<button
			type="button"
			class="notebook-tab"
			class:is-active={viewMode === item.mode}
			data-testid={`result-view-${item.mode}`}
			title={item.label}
			role="tab"
			aria-selected={viewMode === item.mode}
			onmousedown={(event) => handlePointerDown(event, item.mode)}
			onclick={(event) => handleClick(event, item.mode)}
		>
			{item.label}
		</button>
	{/each}
</div>
