<script lang="ts">
	import type {
		ColumnProfile,
		DatasetOverview as DatasetOverviewData
	} from '$lib/services/column-profile';
	import {
		collectQualityHints,
		compactProfileColumns,
		defaultSelectedColumn
	} from '$lib/services/column-profile';
	import DatasetOverviewStrip from './DatasetOverview.svelte';
	import DataQualityHints from './DataQualityHints.svelte';
	import ColumnSelector from './ColumnSelector.svelte';
	import ColumnProfileCard from './ColumnProfileCard.svelte';

	interface Props {
		profiles: ColumnProfile[];
		overview: DatasetOverviewData;
		mode?: 'full' | 'compact';
		truncated?: boolean;
		fillHeight?: boolean;
	}

	let {
		profiles,
		overview,
		mode = 'full',
		truncated = false,
		fillHeight = false
	}: Props = $props();

	const hints = $derived(collectQualityHints(profiles, { truncated }));
	const useMasterDetail = $derived(mode === 'full' && profiles.length >= 8);

	let selectedColumn = $state<string | null>(null);

	$effect(() => {
		const next = defaultSelectedColumn(profiles);
		if (!selectedColumn || !profiles.some((p) => p.column === selectedColumn)) {
			selectedColumn = next;
		}
	});

	const selectedProfile = $derived(
		profiles.find((p) => p.column === selectedColumn) ?? profiles[0] ?? null
	);

	const compactProfiles = $derived(compactProfileColumns(profiles, 2));
</script>

<div class="flex flex-col gap-3 {fillHeight ? 'h-full min-h-0' : ''}">
	{#if overview.name}
		<div class="flex items-baseline gap-2">
			<h3 class="font-mono text-sm font-semibold">{overview.name}</h3>
			<span class="text-xs text-muted-foreground">profile</span>
		</div>
	{/if}

	<DatasetOverviewStrip {overview} />
	<DataQualityHints {hints} />

	{#if profiles.length === 0}
		<p class="py-6 text-center text-sm text-muted-foreground">No columns to profile.</p>
	{:else if mode === 'compact'}
		<div class="space-y-2">
			{#each compactProfiles as profile (profile.column)}
				<ColumnProfileCard {profile} compact />
			{/each}
			{#if profiles.length > 2}
				<p class="text-center text-[11px] text-muted-foreground">
					Open the full result tab for all {profiles.length} columns.
				</p>
			{/if}
		</div>
	{:else if useMasterDetail}
		<div class="flex min-h-0 flex-1 gap-3 overflow-hidden">
			<div class="w-48 shrink-0 overflow-hidden rounded-lg border bg-card p-2">
				<ColumnSelector
					{profiles}
					selected={selectedColumn}
					onSelect={(col) => (selectedColumn = col)}
				/>
			</div>
			<div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
				{#if selectedProfile}
					<ColumnProfileCard profile={selectedProfile} />
				{/if}
			</div>
		</div>
	{:else}
		<div class="space-y-3 {fillHeight ? 'min-h-0 flex-1 overflow-y-auto' : ''}">
			{#each profiles as profile (profile.column)}
				<ColumnProfileCard {profile} />
			{/each}
		</div>
	{/if}
</div>
