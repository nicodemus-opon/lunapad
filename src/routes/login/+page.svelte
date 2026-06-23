<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';
	import { authClient } from '$lib/auth-client';

	let email = $state('');
	let password = $state('');
	let submitting = $state(false);

	onMount(async () => {
		const res = await fetch('/api/setup');
		const body = (await res.json()) as { needsSetup: boolean };
		if (body.needsSetup) {
			await goto('/setup');
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		try {
			const { error } = await authClient.signIn.email({ email, password });
			if (error) {
				toast.error(error.message ?? 'Invalid email or password.');
				return;
			}
			const redirectTo = page.url.searchParams.get('redirectTo') || '/';
			await goto(redirectTo);
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	<form
		onsubmit={handleSubmit}
		class="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
	>
		<h1 class="text-lg font-serif">Sign in to Lunapad</h1>

		<div>
			<label for="login-email" class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
				>Email</label
			>
			<Input
				id="login-email"
				type="email"
				class="h-8 text-xs"
				bind:value={email}
				required
				autocomplete="email"
			/>
		</div>
		<div>
			<label for="login-password" class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
				>Password</label
			>
			<Input
				id="login-password"
				type="password"
				class="h-8 text-xs"
				bind:value={password}
				required
				autocomplete="current-password"
			/>
		</div>

		<Button type="submit" class="w-full" disabled={submitting}>
			{submitting ? 'Signing in…' : 'Sign in'}
		</Button>
	</form>
</div>
