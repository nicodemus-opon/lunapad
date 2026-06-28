<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Loader2, Trash2, Plus, Package } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import {
		listPythonPackages,
		installPythonPackage,
		uninstallPythonPackage,
		type PythonPackage
	} from '$lib/services/python-client';
	import { getProjectFolder } from '$lib/stores/notebook.svelte';

	const CURATED = new Set(['pandas', 'numpy', 'pyarrow', 'plotly']);

	let packages = $state<PythonPackage[]>([]);
	let loading = $state(true);
	let newName = $state('');
	let installing = $state(false);
	let removingName = $state<string | null>(null);
	const folder = $derived(getProjectFolder());

	async function refresh(): Promise<void> {
		loading = true;
		try {
			packages = await listPythonPackages();
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void refresh();
	});

	async function install(): Promise<void> {
		const name = newName.trim();
		if (!name) return;
		installing = true;
		try {
			const result = await installPythonPackage(name, folder);
			if (!result.ok) {
				toast.error(result.message || `Failed to install ${name}`);
				return;
			}
			newName = '';
			toast.success(`Installed ${name}`);
			await refresh();
		} finally {
			installing = false;
		}
	}

	async function remove(name: string): Promise<void> {
		removingName = name;
		try {
			const result = await uninstallPythonPackage(name, folder);
			if (!result.ok) {
				toast.error(result.message || `Failed to remove ${name}`);
				return;
			}
			await refresh();
		} finally {
			removingName = null;
		}
	}
</script>

<div class="space-y-4">
	<div>
		<h2 class="text-sm font-semibold">Python packages</h2>
		<p class="mt-0.5 text-xs text-muted-foreground">
			Pandas, NumPy, PyArrow, and Plotly are always available to Python cells. Anything you add here
			is also written to <span class="font-mono">.lunapad/python-packages.json</span> in the open project
			folder, so it's shared with this project — a teammate cloning the repo gets the same packages auto-installed
			on their first run, no manual setup.
		</p>
	</div>

	<div class="flex gap-1.5">
		<Input
			class="h-8 flex-1 font-mono text-xs"
			placeholder="package name (e.g. requests)"
			bind:value={newName}
			onkeydown={(e) => {
				if (e.key === 'Enter') void install();
			}}
		/>
		<Button
			size="sm"
			class="h-8 gap-1 text-xs"
			disabled={installing || !newName.trim()}
			onclick={install}
		>
			{#if installing}
				<Loader2 class="h-3.5 w-3.5 animate-spin" />
			{:else}
				<Plus class="h-3.5 w-3.5" />
			{/if}
			Install
		</Button>
	</div>

	{#if !folder}
		<p class="text-xs text-muted-foreground/80">
			No project folder open — installs apply to this machine's Python environment only and won't be
			shared with a project.
		</p>
	{/if}

	{#if loading}
		<p class="text-xs text-muted-foreground">Loading…</p>
	{:else if packages.length === 0}
		<p class="text-xs text-muted-foreground">No packages found yet — run a Python cell first.</p>
	{:else}
		<div class="divide-y divide-border/60 rounded-md border border-border/60">
			{#each packages as pkg (pkg.name)}
				<div class="flex items-center justify-between gap-2 px-3 py-2">
					<div class="flex items-center gap-2 text-xs">
						<Package class="h-3.5 w-3.5 text-muted-foreground" />
						<span class="font-mono">{pkg.name}</span>
						<span class="text-muted-foreground">{pkg.version}</span>
						{#if CURATED.has(pkg.name.toLowerCase())}
							<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
								>curated</span
							>
						{/if}
					</div>
					{#if !CURATED.has(pkg.name.toLowerCase())}
						<button
							class="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:opacity-40"
							title="Remove {pkg.name}"
							disabled={removingName === pkg.name}
							onclick={() => remove(pkg.name)}
						>
							{#if removingName === pkg.name}
								<Loader2 class="h-3.5 w-3.5 animate-spin" />
							{:else}
								<Trash2 class="h-3.5 w-3.5" />
							{/if}
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
