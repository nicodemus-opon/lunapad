<script lang="ts">
	import type { DashboardPanelHeight } from '$lib/types/gui-pipeline';

	interface Props {
		height: DashboardPanelHeight;
		onSetHeight: (h: DashboardPanelHeight) => void;
	}

	const { height, onSetHeight }: Props = $props();

	const HEIGHTS: DashboardPanelHeight[] = ['sm', 'md', 'lg'];
	const BAR_HEIGHTS = ['h-2', 'h-3.5', 'h-5'];
	const TITLES = ['Small (200px)', 'Medium (320px)', 'Large (480px)'];
</script>

<div class="flex items-center gap-0.5">
	{#each HEIGHTS as h, i (h)}
		<button
			class="flex items-end gap-px h-5 px-1 rounded hover:bg-muted/60 transition-colors"
			onclick={() => onSetHeight(h)}
			title={TITLES[i]}
		>
			{#each HEIGHTS as _, j}
				<div
					class="w-1.5 rounded-[1px] transition-colors {BAR_HEIGHTS[j]} {j <= i
						? h === height
							? 'bg-foreground/75'
							: 'bg-foreground/25'
						: 'bg-foreground/10'}"
				></div>
			{/each}
		</button>
	{/each}
</div>
