<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { RefreshCw } from '@lucide/svelte';

	type UsageSummary = {
		plan: string;
		limits: Record<string, number | string>;
		usage: Record<string, number>;
	};

	let usage = $state<UsageSummary | null>(null);
	let loading = $state(true);

	const rows = $derived(
		usage
			? [
					['Projects', usage.usage.projects, usage.limits.maxProjects, 'Create a project'],
					[
						'External connections',
						usage.usage.externalConnections,
						usage.limits.maxExternalConnections,
						'Add a warehouse connection'
					],
					['Published shares', usage.usage.publishedShares, usage.limits.maxPublishedShares, 'Publish a report'],
					['Schedules', usage.usage.scheduledJobs, usage.limits.maxSchedules, 'Schedule refresh'],
					['API keys', usage.usage.apiKeys, null, 'Create API key'],
					['Active jobs', usage.usage.activeJobs, usage.limits.maxConcurrentJobs, 'Run hosted work'],
					['AI tokens', usage.usage.aiTokens, usage.limits.monthlyAiTokens, 'Use AI assistant'],
					['Storage MB', usage.usage.storageMb ?? 0, usage.limits.maxStorageMb, 'Store project files']
				]
			: []
	);

	function numericLimit(limit: number | string | null): number | null {
		if (typeof limit === 'number') return limit;
		if (typeof limit === 'string') {
			const parsed = Number(limit);
			return Number.isFinite(parsed) ? parsed : null;
		}
		return null;
	}

	function ratio(used: number, limit: number | string | null): number {
		const numeric = numericLimit(limit);
		if (!numeric || numeric <= 0) return 0;
		return Math.min(used / numeric, 1);
	}

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/usage');
			if (res.ok) usage = ((await res.json()) as { usage: UsageSummary }).usage;
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-3">
		<div>
			<h2 class="text-sm font-semibold">Usage</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				{usage ? `${usage.plan} plan` : 'Current limits and activity'}
			</p>
		</div>
		<Button
			variant="outline"
			size="sm"
			class="h-7 gap-1.5 text-xs"
			disabled={loading}
			onclick={load}
		>
			<RefreshCw class="h-3.5 w-3.5" /> Refresh
		</Button>
	</div>

	{#if loading && !usage}
		<div class="space-y-1">
			<div class="h-8 rounded-md bg-muted/60"></div>
			<div class="h-8 rounded-md bg-muted/40"></div>
			<div class="h-8 rounded-md bg-muted/30"></div>
		</div>
	{:else}
		<div class="overflow-hidden rounded-md border border-border">
			<table class="w-full text-xs">
				<thead class="bg-muted/40 text-muted-foreground">
					<tr>
						<th class="px-3 py-2 text-left font-medium">Metric</th>
						<th class="px-3 py-2 text-right font-medium">Used</th>
						<th class="px-3 py-2 text-right font-medium">Limit</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row}
						<tr class="border-t border-border">
							<td class="px-3 py-2">
								<div class="font-medium">{row[0]}</div>
								<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
									<div
										class="h-full rounded-full {ratio(row[1] as number, row[2] as number | string | null) > 0.85
											? 'bg-destructive'
											: ratio(row[1] as number, row[2] as number | string | null) > 0.65
												? 'bg-amber-500'
												: 'bg-primary'}"
										style={`width: ${Math.round(ratio(row[1] as number, row[2] as number | string | null) * 100)}%`}
									></div>
								</div>
								<div class="mt-1 text-2xs text-muted-foreground">{row[3]}</div>
							</td>
							<td class="px-3 py-2 text-right font-mono">{row[1]}</td>
							<td class="px-3 py-2 text-right font-mono">{row[2] ?? 'No limit'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
