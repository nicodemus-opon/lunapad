<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { ChevronLeft, ChevronRight, Loader2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { fly } from 'svelte/transition';

	const steps = [
		{
			id: 'account',
			title: 'Create your account',
			subtitle: 'You will be the admin for this workspace.'
		},
		{
			id: 'workspace',
			title: 'Name your workspace',
			subtitle: 'You can invite teammates and add more projects later.'
		}
	] as const;

	type StepId = (typeof steps)[number]['id'];

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let workspaceName = $state('My workspace');
	let projectName = $state('Analytics project');
	let signupError = $state<string | null>(null);
	let submitting = $state(false);
	let currentStepIndex = $state(0);

	let currentStep = $derived(steps[currentStepIndex]);
	let currentStepId = $derived<StepId>(currentStep.id);
	let passwordMismatch = $derived(
		password.length > 0 && confirmPassword.length > 0 && password !== confirmPassword
	);
	let canContinue = $derived(
		currentStepId === 'workspace'
			? workspaceName.trim().length > 0 && projectName.trim().length > 0
			: currentStepId === 'account'
				? name.trim().length > 0 &&
					email.trim().length > 0 &&
					email.includes('@') &&
					password.length >= 8 &&
					confirmPassword.length >= 8 &&
					!passwordMismatch
				: true
	);

	function validateCurrentStep(): boolean {
		signupError = null;
		if (currentStepId === 'workspace') {
			if (!workspaceName.trim() || !projectName.trim()) {
				toast.error('Name the workspace and starter project.');
				return false;
			}
			return true;
		}

		if (currentStepId === 'account') {
			if (!name.trim() || !email.trim() || !password || !confirmPassword) {
				toast.error('Complete the admin account details.');
				return false;
			}
			if (password.length < 8) {
				toast.error('Password must be at least 8 characters.');
				return false;
			}
			if (password !== confirmPassword) {
				toast.error('Passwords do not match.');
				return false;
			}
		}

		return true;
	}

	function nextStep() {
		if (!validateCurrentStep()) return;
		currentStepIndex = Math.min(currentStepIndex + 1, steps.length - 1);
	}

	function previousStep() {
		signupError = null;
		currentStepIndex = Math.max(currentStepIndex - 1, 0);
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		signupError = null;
		if (currentStepIndex < steps.length - 1) {
			nextStep();
			return;
		}
		if (!validateCurrentStep()) return;
		if (password !== confirmPassword) {
			toast.error('Passwords do not match.');
			return;
		}
		submitting = true;
		try {
			const res = await fetch('/api/signup', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, email, password, workspaceName, projectName })
			});
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) throw new Error(body.error ?? 'Failed to create workspace.');
			toast.success('Workspace created.');
			await goto(page.url.searchParams.get('redirectTo') || '/');
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to create workspace.';
			signupError = message;
			toast.error(message);
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-background px-4 py-8">
	<form
		onsubmit={handleSubmit}
		class="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8"
	>
		<div class="flex gap-1.5">
			{#each steps as step, index}
				<div
					class={[
						'h-1 flex-1 rounded-full transition-colors duration-300',
						index <= currentStepIndex ? 'bg-primary' : 'bg-border'
					]}
				></div>
			{/each}
		</div>

		{#key currentStepId}
			<div in:fly={{ x: 12, duration: 180 }}>
				<p class="mt-4 text-2xs tracking-wide text-muted-foreground uppercase">
					Step {currentStepIndex + 1} of {steps.length}
				</p>
				<h1 class="mt-1 font-serif text-xl leading-tight">{currentStep.title}</h1>
				<p class="mt-1 text-xs text-muted-foreground">{currentStep.subtitle}</p>

				{#if currentStepId === 'account'}
					<div class="mt-6 space-y-4">
						<div>
							<label
								for="signup-name"
								class="mb-1.5 block text-2xs tracking-wide text-muted-foreground uppercase"
								>Name</label
							>
							<Input
								id="signup-name"
								class="h-10 text-sm"
								bind:value={name}
								required
								autocomplete="name"
								autofocus
							/>
						</div>
						<div>
							<label
								for="signup-email"
								class="mb-1.5 block text-2xs tracking-wide text-muted-foreground uppercase"
								>Email</label
							>
							<Input
								id="signup-email"
								type="email"
								class="h-10 text-sm"
								bind:value={email}
								required
								autocomplete="email"
							/>
						</div>
						<div>
							<label
								for="signup-password"
								class="mb-1.5 block text-2xs tracking-wide text-muted-foreground uppercase"
								>Password</label
							>
							<Input
								id="signup-password"
								type="password"
								class="h-10 text-sm"
								bind:value={password}
								required
								minlength={8}
								autocomplete="new-password"
							/>
						</div>
						<div>
							<label
								for="signup-confirm-password"
								class="mb-1.5 block text-2xs tracking-wide text-muted-foreground uppercase"
								>Confirm password</label
							>
							<Input
								id="signup-confirm-password"
								type="password"
								class="h-10 text-sm"
								bind:value={confirmPassword}
								required
								minlength={8}
								autocomplete="new-password"
								aria-invalid={passwordMismatch}
							/>
							{#if passwordMismatch}
								<p class="mt-2 text-xs text-destructive">Passwords do not match.</p>
							{/if}
						</div>
					</div>
				{:else}
					<div class="mt-6 space-y-4">
						<div>
							<label
								for="signup-workspace"
								class="mb-1.5 block text-2xs tracking-wide text-muted-foreground uppercase"
								>Workspace name</label
							>
							<Input
								id="signup-workspace"
								class="h-10 text-sm"
								bind:value={workspaceName}
								required
								autocomplete="organization"
								autofocus
							/>
						</div>
						<div>
							<label
								for="signup-project"
								class="mb-1.5 block text-2xs tracking-wide text-muted-foreground uppercase"
								>Starter project</label
							>
							<Input
								id="signup-project"
								class="h-10 text-sm"
								bind:value={projectName}
								required
								autocomplete="off"
							/>
						</div>
					</div>
				{/if}
			</div>
		{/key}

		{#if signupError}
			<p
				class="mt-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
			>
				{signupError}
			</p>
		{/if}

		<div class="mt-6 flex items-center justify-between border-t border-border pt-5">
			<div class="flex gap-3">
				{#if currentStepIndex > 0}
					<Button type="button" variant="outline" onclick={previousStep} disabled={submitting}>
						<ChevronLeft class="h-4 w-4" aria-hidden="true" />
						Back
					</Button>
				{/if}
				<Button
					type="button"
					variant="ghost"
					onclick={() => goto('/login')}
					disabled={submitting}
				>
					Sign in
				</Button>
			</div>

			{#if currentStepIndex < steps.length - 1}
				<Button type="button" onclick={nextStep} disabled={!canContinue || submitting}>
					Continue
					<ChevronRight class="h-4 w-4" aria-hidden="true" />
				</Button>
			{:else}
				<Button type="submit" disabled={submitting}>
					{#if submitting}
						<Loader2 class="h-4 w-4 animate-spin" aria-hidden="true" />
						Creating…
					{:else}
						Create workspace
					{/if}
				</Button>
			{/if}
		</div>
	</form>
</div>
