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
	let checkingSetup = $state(true);
	let setupError = $state<string | null>(null);
	let loginError = $state<string | null>(null);

	onMount(async () => {
		email = page.url.searchParams.get('email') ?? '';
		try {
			const res = await fetch('/api/setup');
			const body = (await res.json()) as {
				needsSetup: boolean;
				mode: 'fresh' | 'repair' | 'closed';
				deploymentMode: 'local' | 'cloud';
				cloudSignupOpen: boolean;
				error?: string;
			};
			if (!res.ok) throw new Error(body.error ?? 'Failed to check setup status.');
			if (body.needsSetup) {
				const redirectTo = page.url.searchParams.get('redirectTo') || '/';
				const setupPath =
					body.deploymentMode === 'cloud' && body.cloudSignupOpen && body.mode === 'fresh'
						? '/signup'
						: '/setup';
				await goto(`${setupPath}?redirectTo=${encodeURIComponent(redirectTo)}`);
			}
		} catch (err) {
			setupError = err instanceof Error ? err.message : 'Failed to check setup status.';
		} finally {
			checkingSetup = false;
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		loginError = null;
		submitting = true;
		try {
			const { error } = await authClient.signIn.email({ email, password });
			if (error) {
				loginError = error.message ?? 'Invalid email or password.';
				toast.error(loginError);
				return;
			}
			const inviteToken = page.url.searchParams.get('inviteToken');
			if (inviteToken) {
				const inviteRes = await fetch(`/api/invitations/${inviteToken}/accept`, { method: 'POST' });
				const inviteBody = await inviteRes.json();
				if (!inviteRes.ok) {
					const message = inviteBody.error ?? 'Signed in, but could not accept invitation.';
					loginError = message;
					toast.error(message);
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

<div class="flex min-h-screen items-center justify-center bg-background px-4 py-8">
	<form
		onsubmit={handleSubmit}
		class="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
	>
		<div>
			<h1 class="font-serif text-lg">Sign in to Lunapad</h1>
			<p class="mt-1 text-xs text-muted-foreground">
				Open your data workspace, shared reports, automations, and team settings.
			</p>
		</div>

		{#if checkingSetup}
			<p
				class="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
			>
				Checking setup status…
			</p>
		{:else if setupError}
			<p
				class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
			>
				{setupError}
			</p>
		{/if}

		{#if loginError}
			<p
				class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
			>
				{loginError}
			</p>
		{/if}

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

		<Button type="submit" class="w-full" disabled={submitting || checkingSetup}>
			{submitting ? 'Signing in…' : 'Sign in'}
		</Button>
	</form>
</div>
