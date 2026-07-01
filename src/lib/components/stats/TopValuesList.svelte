<script lang="ts">
	import type { TopValue } from '$lib/services/column-profile';
	import { fmtPct, STATS_TOP_VALUE } from './stats-ui';

	interface Props {
		values: TopValue[];
		compact?: boolean;
	}

	const { values, compact = false }: Props = $props();

	const maxCount = $derived(values[0]?.count ?? 1);
</script>

{#if values.length === 0}
	<p class="text-[11px] text-muted-foreground italic">No data</p>
{:else}
	<div class="space-y-1">
		{#each values as row (`${row.value ?? 'null'}-${row.count}`)}
			{@const barPct = maxCount > 0 ? (row.count / maxCount) * 100 : 0}
			<div class="flex items-center gap-2 text-[11px]">
				<span
					class="{compact
						? 'w-1/2'
						: 'w-2/5'} shrink-0 truncate font-mono text-foreground/80"
					title={row.value ?? ''}
				>
					{#if row.value != null}{row.value}{:else}<em class="text-muted-foreground">null</em
						>{/if}
				</span>
				<div class="h-2.5 min-w-0 flex-1 overflow-hidden rounded bg-muted">
					<div class="h-full rounded {STATS_TOP_VALUE}" style="width: {barPct}%"></div>
				</div>
				<span class="w-14 shrink-0 text-right text-muted-foreground tabular-nums">
					{row.count.toLocaleString()} ({fmtPct(row.pctOfRows, 1)})
				</span>
			</div>
		{/each}
	</div>
{/if}
