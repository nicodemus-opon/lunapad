<script lang="ts">
	import ColumnProfilePanel from './stats/ColumnProfilePanel.svelte';
	import { computeProfilesFromRows, computeDatasetOverview } from '$lib/services/column-profile';

	interface Props {
		rows: Record<string, unknown>[];
		columns: string[];
		name?: string;
		compact?: boolean;
		truncated?: boolean;
		fillHeight?: boolean;
	}

	const {
		rows,
		columns,
		name = 'result',
		compact = false,
		truncated = false,
		fillHeight = false
	}: Props = $props();

	const profiles = $derived(computeProfilesFromRows(rows, columns));
	const overview = $derived(computeDatasetOverview(profiles, { name, rowCount: rows.length }));
</script>

<ColumnProfilePanel
	{profiles}
	{overview}
	mode={compact ? 'compact' : 'full'}
	{truncated}
	{fillHeight}
/>
