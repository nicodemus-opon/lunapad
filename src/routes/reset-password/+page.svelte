<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { toast } from 'svelte-sonner';

	let password = $state('');
	let confirmPassword = $state('');
	let error = $state<string | null>(null);
	let submitting = $state(false);
	const token = $derived(page.url.searchParams.get('token') ?? '');

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		error = null;
		if (password !== confirmPassword) {
			toast.error('Passwords do not match.');
			return;
		}
		submitting = true;
		try {
			const res = await fetch('/api/account/password-reset/confirm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token, password })
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) throw new Error(body.error ?? 'Password reset failed.');
			toast.success('Password reset.');
			await goto('/login');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Password reset failed.';
			error = message;
			toast.error(message);
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
			<h1 class="font-serif text-lg">Reset password</h1>
			<p class="mt-1 text-xs text-muted-foreground">Choose a new password for your Lunapad account.</p>
		</div>

		{#if !token}
			<p class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
				Reset token is missing.
			</p>
		{/if}

		<div>
			<label
				for="reset-password"
				class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Password</label
			>
			<Input
				id="reset-password"
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
				for="reset-confirm-password"
				class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
				>Confirm password</label
			>
			<Input
				id="reset-confirm-password"
				type="password"
				class="h-8 text-xs"
				bind:value={confirmPassword}
				required
				minlength={8}
				autocomplete="new-password"
			/>
		</div>

		{#if error}
			<p class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
				{error}
			</p>
		{/if}

		<Button type="submit" class="w-full" disabled={submitting || !token}>
			{submitting ? 'Saving…' : 'Save password'}
		</Button>
	</form>
</div>
