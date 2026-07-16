<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { RefreshCw, XCircle } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	type CloudJob = {
		id: string;
		kind: string;
		status: string;
		error: string | null;
		logs?: string | null;
		createdAt: string;
		startedAt: string | null;
		finishedAt: string | null;
	};

	let jobs = $state<CloudJob[]>([]);
	let loading = $state(true);

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/jobs?allProjects=1');
			if (res.ok) jobs = ((await res.json()) as { jobs: CloudJob[] }).jobs;
		} finally {
			loading = false;
		}
	}

	async function cancel(job: CloudJob) {
		const res = await fetch(`/api/jobs/${job.id}/cancel`, { method: 'POST' });
		const body = await res.json();
		if (!res.ok) {
			toast.error(body.error ?? 'Failed to cancel job.');
			return;
		}
		toast.success('Job cancelled.');
		await load();
	}

	onMount(load);
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-3">
		<div>
			<h2 class="text-sm font-semibold">Jobs</h2>
			<p class="mt-1 text-xs text-muted-foreground">Recent hosted execution activity.</p>
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

	{#if loading && jobs.length === 0}
		<div class="space-y-1">
			<div class="h-8 rounded-md bg-muted/60"></div>
			<div class="h-8 rounded-md bg-muted/40"></div>
		</div>
	{:else if jobs.length === 0}
		<p class="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
			No jobs yet. Hosted work appears here when you run queries, dbt, Python, AI indexing, or share refreshes.
		</p>
	{:else}
		<div class="overflow-hidden rounded-md border border-border">
			<table class="w-full text-xs">
				<thead class="bg-muted/40 text-muted-foreground">
					<tr>
						<th class="px-3 py-2 text-left font-medium">Kind</th>
						<th class="px-3 py-2 text-left font-medium">Status</th>
						<th class="px-3 py-2 text-left font-medium">Created</th>
						<th class="px-3 py-2 text-right font-medium"></th>
					</tr>
				</thead>
				<tbody>
					{#each jobs as job (job.id)}
						<tr class="border-t border-border">
							<td class="px-3 py-2 font-mono">{job.kind}</td>
							<td class="px-3 py-2">
								<span class="rounded bg-muted px-1.5 py-0.5 font-mono">{job.status}</span>
								{#if job.error}
									<span class="ml-2 text-destructive">{job.error}</span>
								{:else if job.logs}
									<span class="ml-2 text-muted-foreground">{job.logs.slice(-120)}</span>
								{/if}
							</td>
							<td class="px-3 py-2 text-muted-foreground"
								>{new Date(job.createdAt).toLocaleString()}</td
							>
							<td class="px-3 py-2 text-right">
								{#if job.status === 'queued' || job.status === 'running'}
									<Button
										variant="ghost"
										size="icon"
										class="size-6"
										title="Cancel job"
										onclick={() => cancel(job)}
									>
										<XCircle class="size-3.5" />
									</Button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
