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
		email = page.url.searchParams.get('email') ?? '';
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
			const inviteToken = page.url.searchParams.get('inviteToken');
			if (inviteToken) {
				const inviteRes = await fetch(`/api/invitations/${inviteToken}/accept`, { method: 'POST' });
				const inviteBody = await inviteRes.json();
				if (!inviteRes.ok) {
					toast.error(inviteBody.error ?? 'Signed in, but could not accept invitation.');
				} else {
					toast.success('Invitation accepted.');
				}
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
		<h1 class="font-serif text-lg">Sign in to Lunapad</h1>

		<div>
			<label
				for="login-email"
				class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Email</label
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
			<label
				for="login-password"
				class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Password</label
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
