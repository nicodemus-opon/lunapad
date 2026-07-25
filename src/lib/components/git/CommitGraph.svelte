<script lang="ts">
	import { layoutCommitGraph } from '$lib/utils/commit-graph';
	import type { GitCommitLogEntry } from '$lib/types/git';

	let { commits }: { commits: GitCommitLogEntry[] } = $props();

	const LANE_WIDTH = 14;
	const ROW_HEIGHT = 20;
	const DOT_RADIUS = 3;

	const lanes = $derived(layoutCommitGraph(commits));
	const laneCount = $derived(
		lanes.length === 0
			? 1
			: Math.max(
					1,
					...lanes.flatMap((l) => [
						l.lane + 1,
						...l.parentLanes.map((p) => p.lane + 1),
						...l.passthroughLanes.map((n) => n + 1)
					])
				)
	);
	const railWidth = $derived(laneCount * LANE_WIDTH);

	function x(lane: number): number {
		return lane * LANE_WIDTH + LANE_WIDTH / 2;
	}

	function relativeTime(dateStr: string): string {
		const diffMs = Date.now() - new Date(dateStr).getTime();
		const diffMin = Math.round(diffMs / 60_000);
		if (diffMin < 1) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.round(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		return `${Math.round(diffHr / 24)}d ago`;
	}
</script>

<div class="max-h-40 overflow-y-auto pb-1">
	{#each lanes as row, i (row.hash)}
		{@const commit = commits[i]}
		<div class="flex items-center gap-1.5 px-1">
			<svg width={railWidth} height={ROW_HEIGHT} class="shrink-0" aria-hidden="true">
				{#each row.passthroughLanes as laneIdx (laneIdx)}
					<line
						x1={x(laneIdx)}
						y1={0}
						x2={x(laneIdx)}
						y2={ROW_HEIGHT}
						stroke="var(--chart-2)"
						stroke-width="1.5"
						opacity="0.5"
					/>
				{/each}
				{#if i > 0}
					<line
						x1={x(row.lane)}
						y1={0}
						x2={x(row.lane)}
						y2={ROW_HEIGHT / 2}
						stroke="var(--chart-2)"
						stroke-width="1.5"
					/>
				{/if}
				{#each row.parentLanes as parent (parent.hash + parent.lane)}
					<line
						x1={x(row.lane)}
						y1={ROW_HEIGHT / 2}
						x2={x(parent.lane)}
						y2={ROW_HEIGHT}
						stroke="var(--chart-2)"
						stroke-width="1.5"
					/>
				{/each}
				<circle
					cx={x(row.lane)}
					cy={ROW_HEIGHT / 2}
					r={DOT_RADIUS}
					fill="var(--chart-1)"
					stroke="var(--background)"
					stroke-width="1"
				/>
			</svg>
			<div
				class="mx-[var(--sidebar-row-inset)] min-w-0 flex-1 px-[calc(var(--sidebar-panel-x)-var(--sidebar-row-inset))] py-1"
			>
				<p class="truncate text-2xs text-foreground">{commit.message}</p>
				<p class="text-3xs text-muted-foreground/60">
					{commit.author} · {relativeTime(commit.date)} · {commit.hash.slice(0, 7)}
				</p>
			</div>
		</div>
	{/each}
</div>
