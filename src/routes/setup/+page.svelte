<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let workspaceName = $state('My workspace');
	let projectName = $state('Analytics project');
	let submitting = $state(false);
	let checkingSetup = $state(true);
	let setupMode = $state<'fresh' | 'repair' | 'closed'>('fresh');
	let repairReason = $state<string | null>(null);
	let setupError = $state<string | null>(null);

	onMount(async () => {
		try {
			const res = await fetch('/api/setup');
			const body = (await res.json()) as {
				needsSetup: boolean;
				mode: 'fresh' | 'repair' | 'closed';
				repairReason?: string;
			};
			setupMode = body.mode;
			repairReason = body.repairReason ?? null;
			if (!body.needsSetup) {
				await goto('/login');
				return;
			}
		} finally {
			checkingSetup = false;
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		setupError = null;
		if (password !== confirmPassword) {
			toast.error('Passwords do not match.');
			return;
		}
		submitting = true;
		try {
			const res = await fetch('/api/setup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, email, password, workspaceName, projectName })
			});
			const body = (await res.json()) as { error?: string };
			if (!res.ok) throw new Error(body.error ?? 'Failed to complete setup.');
			toast.success(setupMode === 'repair' ? 'Workspace repaired.' : 'Workspace created.');
			await goto('/');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to complete setup.';
			setupError = message;
			toast.error(message);
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-background px-4 py-8">
	{#if checkingSetup}
		<p class="text-sm text-muted-foreground">Checking setup status…</p>
	{:else}
		<form
			onsubmit={handleSubmit}
			class="w-full max-w-xl space-y-5 rounded-lg border border-border bg-card p-6 shadow-sm"
		>
			<div>
				<p class="text-2xs tracking-wide text-muted-foreground uppercase">
					{setupMode === 'repair' ? 'Finish setup' : 'Welcome to Lunapad'}
				</p>
				<h1 class="mt-1 font-serif text-2xl">
					{setupMode === 'repair' ? 'Repair your workspace' : 'Create your workspace'}
				</h1>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					{#if setupMode === 'repair'}
						A user account exists, but Lunapad does not have a valid workspace and project yet.
						Sign in as the first admin to finish the tenant setup.
					{:else}
						Create the first admin, workspace, and dbt-ready starter project for this instance.
						After setup, teammates join through Team settings or invitations.
					{/if}
				</p>
				{#if repairReason}
					<p class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
						{repairReason}
					</p>
				{/if}
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label
						for="setup-workspace"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Workspace name</label
					>
					<Input
						id="setup-workspace"
						class="h-9 text-sm"
						bind:value={workspaceName}
						required
						autocomplete="organization"
					/>
				</div>
				<div>
					<label
						for="setup-project"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Starter project</label
					>
					<Input
						id="setup-project"
						class="h-9 text-sm"
						bind:value={projectName}
						required
						autocomplete="off"
					/>
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label
						for="setup-name"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Name</label
					>
					<Input id="setup-name" class="h-9 text-sm" bind:value={name} required autocomplete="name" />
				</div>
				<div>
					<label
						for="setup-email"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Email</label
					>
					<Input
						id="setup-email"
						type="email"
						class="h-9 text-sm"
						bind:value={email}
						required
						autocomplete="email"
					/>
				</div>
				<div>
					<label
						for="setup-password"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Password</label
					>
					<Input
						id="setup-password"
						type="password"
						class="h-9 text-sm"
						bind:value={password}
						required
						minlength={8}
						autocomplete={setupMode === 'repair' ? 'current-password' : 'new-password'}
					/>
				</div>
				<div>
					<label
						for="setup-confirm-password"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Confirm password</label
					>
					<Input
						id="setup-confirm-password"
						type="password"
						class="h-9 text-sm"
						bind:value={confirmPassword}
						required
						minlength={8}
						autocomplete={setupMode === 'repair' ? 'current-password' : 'new-password'}
					/>
				</div>
			</div>

			{#if setupError}
				<p class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					{setupError}
				</p>
			{/if}

			<Button type="submit" class="w-full" disabled={submitting}>
				{submitting
					? setupMode === 'repair'
						? 'Repairing…'
						: 'Creating…'
					: setupMode === 'repair'
						? 'Repair workspace'
						: 'Create workspace'}
			</Button>
		</form>
	{/if}
</div>
