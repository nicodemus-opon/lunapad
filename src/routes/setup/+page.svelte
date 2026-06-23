<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import { authClient } from '$lib/auth-client';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let submitting = $state(false);
	let checkingSetup = $state(true);

	onMount(async () => {
		try {
			const res = await fetch('/api/setup');
			const body = (await res.json()) as { needsSetup: boolean };
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
		if (password !== confirmPassword) {
			toast.error('Passwords do not match.');
			return;
		}
		submitting = true;
		try {
			const { error } = await authClient.signUp.email({ name, email, password });
			if (error) {
				toast.error(error.message ?? 'Failed to create the admin account.');
				return;
			}
			toast.success('Admin account created.');
			await goto('/');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	{#if checkingSetup}
		<p class="text-sm text-muted-foreground">Checking setup status…</p>
	{:else}
		<form
			onsubmit={handleSubmit}
			class="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
		>
			<div>
				<h1 class="text-lg font-serif">Welcome to Lunapad</h1>
				<p class="mt-1 text-xs text-muted-foreground">
					Create the first account. It becomes the admin for this shared instance, and
					sign-up closes after this — only an admin can add teammates afterward.
				</p>
			</div>

			<div>
				<label for="setup-name" class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
					>Name</label
				>
				<Input id="setup-name" class="h-8 text-xs" bind:value={name} required autocomplete="name" />
			</div>
			<div>
				<label for="setup-email" class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
					>Email</label
				>
				<Input
					id="setup-email"
					type="email"
					class="h-8 text-xs"
					bind:value={email}
					required
					autocomplete="email"
				/>
			</div>
			<div>
				<label for="setup-password" class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
					>Password</label
				>
				<Input
					id="setup-password"
					type="password"
					class="h-8 text-xs"
					bind:value={password}
					required
					minlength={8}
					autocomplete="new-password"
				/>
			</div>
			<div>
				<label
					for="setup-confirm-password"
					class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Confirm password</label
				>
				<Input
					id="setup-confirm-password"
					type="password"
					class="h-8 text-xs"
					bind:value={confirmPassword}
					required
					minlength={8}
					autocomplete="new-password"
				/>
			</div>

			<Button type="submit" class="w-full" disabled={submitting}>
				{submitting ? 'Creating…' : 'Create admin account'}
			</Button>
		</form>
	{/if}
</div>
