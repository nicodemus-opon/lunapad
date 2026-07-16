<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Download, RefreshCw, Wrench } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	type DiagnosticPayload = {
		executionAdapter?: { adapter: string; status: string; message?: string };
		tenantWarnings?: Array<{ code: string; message: string }>;
		staleJobs?: Array<{ id: string; kind: string; status: string }>;
		failedJobs?: Array<{ id: string; kind: string; status: string; error: string | null }>;
		quotaPressure?: { activeJobs: number; maxConcurrentJobs: number; activeJobRatio: number };
	};
	type TrinoStatus = {
		connectionId: string;
		sourceAlias: string;
		physicalCatalogName: string;
		trinoUser: string;
		status: 'ready' | 'registering' | 'failed';
		message?: string;
		lastSyncedAt?: string | null;
	};

	let diagnostics = $state<DiagnosticPayload | null>(null);
	let trinoStatuses = $state<TrinoStatus[]>([]);
	let loading = $state(true);
	let reconciling = $state(false);
	let exportingBundle = $state(false);

	async function load() {
		loading = true;
		try {
			const [diagnosticsRes, trinoRes] = await Promise.all([
				fetch('/api/admin/diagnostics'),
				fetch('/api/admin/trino/status')
			]);
			if (diagnosticsRes.ok) diagnostics = (await diagnosticsRes.json()) as DiagnosticPayload;
			if (trinoRes.ok) {
				const body = await trinoRes.json();
				trinoStatuses = body.statuses ?? [];
			}
		} finally {
			loading = false;
		}
	}

	async function exportSupportBundle() {
		exportingBundle = true;
		try {
			const res = await fetch('/api/support/bundle');
			const body = await res.json().catch(() => null);
			if (!res.ok || !body) throw new Error(body?.error ?? 'Failed to export support bundle.');
			const url = URL.createObjectURL(
				new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })
			);
			const a = document.createElement('a');
			a.href = url;
			a.download = `lunapad-support-bundle-${Date.now()}.json`;
			a.click();
			URL.revokeObjectURL(url);
			toast.success('Support bundle exported.');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to export support bundle.');
		} finally {
			exportingBundle = false;
		}
	}

	async function reconcileTrino() {
		reconciling = true;
		try {
			const res = await fetch('/api/admin/trino/reconcile', { method: 'POST' });
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? 'Failed to reconcile Trino catalogs.');
			const failed = (body.statuses ?? []).filter((status: { status: string }) => status.status === 'failed');
			toast[failed.length ? 'warning' : 'success'](
				failed.length
					? `${failed.length} catalog(s) failed to reconcile.`
					: 'Trino catalogs reconciled.'
			);
			await load();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to reconcile Trino catalogs.');
		} finally {
			reconciling = false;
		}
	}

	onMount(load);
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between gap-3">
		<div>
			<h2 class="text-sm font-semibold">Diagnostics</h2>
			<p class="mt-1 text-xs text-muted-foreground">Hosted execution, tenant integrity, and Trino state.</p>
		</div>
		<div class="flex gap-1.5">
			<Button variant="outline" size="sm" class="h-7 gap-1.5 text-xs" disabled={loading} onclick={load}>
				<RefreshCw class="h-3.5 w-3.5" /> Refresh
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1.5 text-xs"
				disabled={exportingBundle}
				onclick={exportSupportBundle}
			>
				<Download class="h-3.5 w-3.5" /> Support bundle
			</Button>
			<Button size="sm" class="h-7 gap-1.5 text-xs" disabled={reconciling} onclick={reconcileTrino}>
				<Wrench class="h-3.5 w-3.5" /> Reconcile Trino
			</Button>
		</div>
	</div>

	{#if loading && !diagnostics}
		<div class="space-y-1">
			<div class="h-8 rounded-md bg-muted/60"></div>
			<div class="h-8 rounded-md bg-muted/40"></div>
		</div>
	{:else if diagnostics}
		<div class="grid gap-2 text-xs">
			<div class="rounded-md border border-border px-3 py-2">
				<p class="font-medium">Execution adapter</p>
				<p class="mt-1 text-muted-foreground">
					{diagnostics.executionAdapter?.adapter ?? 'unknown'} · {diagnostics.executionAdapter?.status ?? 'unknown'}
					{#if diagnostics.executionAdapter?.message}
						· {diagnostics.executionAdapter.message}
					{/if}
				</p>
			</div>
			<div class="rounded-md border border-border px-3 py-2">
				<p class="font-medium">Tenant integrity</p>
				{#if diagnostics.tenantWarnings?.length}
					<ul class="mt-1 space-y-1 text-muted-foreground">
						{#each diagnostics.tenantWarnings as warning}
							<li>{warning.code}: {warning.message}</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-1 text-muted-foreground">No tenant warnings.</p>
				{/if}
			</div>
			<div class="rounded-md border border-border px-3 py-2">
				<p class="font-medium">Jobs</p>
				<p class="mt-1 text-muted-foreground">
					{diagnostics.staleJobs?.length ?? 0} stale · {diagnostics.failedJobs?.length ?? 0} failed ·
					{diagnostics.quotaPressure?.activeJobs ?? 0}/{diagnostics.quotaPressure?.maxConcurrentJobs ?? 0} active
				</p>
			</div>
			<div class="rounded-md border border-border px-3 py-2">
				<p class="font-medium">Trino catalogs</p>
				{#if trinoStatuses.length === 0}
					<p class="mt-1 text-muted-foreground">No external catalog mappings for this workspace.</p>
				{:else}
					<div class="mt-2 space-y-1">
						{#each trinoStatuses as status (status.connectionId)}
							<div class="rounded border border-border/70 px-2 py-1.5">
								<div class="flex items-center justify-between gap-2">
									<p class="truncate font-medium">{status.sourceAlias}</p>
									<span
										class="rounded-full px-1.5 py-0.5 text-2xs {status.status === 'ready'
											? 'bg-primary/10 text-primary'
											: status.status === 'failed'
												? 'bg-destructive/10 text-destructive'
												: 'bg-warning/10 text-warning'}"
									>
										{status.status}
									</span>
								</div>
								<p class="mt-1 truncate font-mono text-2xs text-muted-foreground">
									{status.physicalCatalogName} · {status.trinoUser}
								</p>
								{#if status.message}
									<p class="mt-1 text-2xs text-muted-foreground">{status.message}</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
