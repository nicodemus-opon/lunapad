<script lang="ts">
	import type { ColumnProfile } from '$lib/services/column-profile';
	import { KIND_ICON, fmtPct, STATS_ITEM_SELECTED, STATS_ITEM_IDLE } from './stats-ui';

	interface Props {
		profiles: ColumnProfile[];
		selected: string | null;
		onSelect: (column: string) => void;
	}

	let { profiles, selected, onSelect }: Props = $props();

	let query = $state('');

	const filtered = $derived(
		query.trim()
			? profiles.filter((p) => p.column.toLowerCase().includes(query.trim().toLowerCase()))
			: profiles
	);
</script>

<div class="flex h-full flex-col gap-2">
	<input
		type="search"
		placeholder="Search columns…"
		bind:value={query}
		class="h-7 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
	/>
	<div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
		{#each filtered as profile (profile.column)}
			{@const Icon = KIND_ICON[profile.kind]}
			{@const isSelected = selected === profile.column}
			<button
				type="button"
				class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors
					{isSelected ? STATS_ITEM_SELECTED : STATS_ITEM_IDLE}"
				onclick={() => onSelect(profile.column)}
			>
				<Icon class="h-3 w-3 shrink-0 {isSelected ? '' : 'opacity-70'}" />
				<span class="min-w-0 flex-1 truncate font-mono">{profile.column}</span>
				<span class="shrink-0 tabular-nums">{fmtPct(profile.completeness, 0)}</span>
			</button>
		{/each}
		{#if filtered.length === 0}
			<p class="px-2 py-1 text-2xs text-muted-foreground italic">No matching columns</p>
		{/if}
	</div>
</div>
