<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let password = $state('');
	let name = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);

	async function acceptInvite() {
		error = null;
		loading = true;
		try {
			const res = await fetch('/api/auth/sign-up/email', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: data.invitation.email,
					password,
					name: name || data.invitation.email.split('@')[0]
				})
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error ?? body.message ?? 'Sign-up failed');
			await fetch(`/api/invitations/accept`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: data.token })
			});
			window.location.href = '/';
		} catch (e) {
			error = e instanceof Error ? e.message : 'Sign-up failed';
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-background px-4">
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void acceptInvite();
		}}
		class="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
	>
		<h1 class="font-serif text-lg">Join the team</h1>
		<p class="text-xs text-muted-foreground">
			Invited as <span class="font-medium text-foreground">{data.invitation.role}</span> ·
			{data.invitation.email}
		</p>

		<div>
			<label for="invite-name" class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
				>Display name</label
			>
			<Input id="invite-name" class="h-8 text-xs" bind:value={name} placeholder="Your name" />
		</div>
		<div>
			<label
				for="invite-password"
				class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Password</label
			>
			<Input
				id="invite-password"
				type="password"
				class="h-8 text-xs"
				bind:value={password}
				required
				autocomplete="new-password"
			/>
		</div>
		{#if error}
			<p class="text-xs text-destructive">{error}</p>
		{/if}
		<Button type="submit" class="w-full" disabled={loading || !password}>
			{loading ? 'Creating account…' : 'Create account'}
		</Button>
	</form>
</div>
