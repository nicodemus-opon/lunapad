<script lang="ts">
	import type { DashboardPanelWidth } from '$lib/types/gui-pipeline';

	interface Props {
		width: DashboardPanelWidth;
		onSetWidth: (w: DashboardPanelWidth) => void;
	}

	const { width, onSetWidth }: Props = $props();

	const WIDTHS: DashboardPanelWidth[] = [1, 2, 3];
	const TITLES = ['1 column', '2 columns', '3 columns (full width)'];
</script>

<div class="flex items-center gap-0.5">
	{#each WIDTHS as w, i (w)}
		<button
			class="flex gap-px items-center h-5 px-1 rounded hover:bg-muted/60 transition-colors"
			onclick={() => onSetWidth(w)}
			title={TITLES[i]}
		>
			{#each [1, 2, 3] as col (col)}
				<div
					class="w-1.5 h-3 rounded-[1px] transition-colors {col <= w
						? w === width
							? 'bg-foreground/75'
							: 'bg-foreground/25'
						: 'bg-foreground/10'}"
				></div>
			{/each}
		</button>
	{/each}
</div>
