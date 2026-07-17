<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	const steps = [
		{
			id: 'workspace',
			title: 'Workspace',
			description: 'Name the tenant and starter dbt project.'
		},
		{
			id: 'account',
			title: 'Admin account',
			description: 'Create the first workspace admin.'
		},
		{
			id: 'review',
			title: 'Review',
			description: 'Confirm the workspace before creating it.'
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
	let progressPercent = $derived(((currentStepIndex + 1) / steps.length) * 100);

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
		class="grid w-full max-w-4xl overflow-hidden rounded-lg border border-border bg-card shadow-sm md:grid-cols-[17rem_1fr]"
	>
		<div class="border-b border-border bg-muted/30 p-5 md:border-r md:border-b-0 md:p-6">
			<p class="text-2xs tracking-wide text-muted-foreground uppercase">Cloud workspace</p>
			<h1 class="mt-2 font-serif text-2xl leading-tight">Create your Lunapad workspace</h1>
			<p class="mt-3 text-sm leading-6 text-muted-foreground">
				Start a hosted data workspace for notebooks, reports, Python, dbt, and publishing.
			</p>

			<div class="mt-6 h-1.5 overflow-hidden rounded-full bg-border">
				<div
					class="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
					style:width={`${progressPercent}%`}
				></div>
			</div>

			<ol class="mt-5 space-y-3">
				{#each steps as step, index}
					<li class="flex gap-3">
						<div
							class={[
								'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-2xs font-medium',
								index < currentStepIndex
									? 'border-primary bg-primary text-primary-foreground'
									: index === currentStepIndex
										? 'border-primary text-foreground'
										: 'border-border text-muted-foreground'
							]}
						>
							{#if index < currentStepIndex}
								<CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
							{:else}
								{index + 1}
							{/if}
						</div>
						<div>
							<p
								class={[
									'text-sm font-medium',
									index === currentStepIndex ? 'text-foreground' : 'text-muted-foreground'
								]}
							>
								{step.title}
							</p>
							<p class="mt-0.5 text-xs leading-5 text-muted-foreground">{step.description}</p>
						</div>
					</li>
				{/each}
			</ol>
		</div>

		<div class="flex min-h-[31rem] flex-col p-5 sm:p-6">
			<div class="flex-1">
				<p class="text-xs text-muted-foreground">Step {currentStepIndex + 1} of {steps.length}</p>
				<h2 class="mt-1 font-serif text-xl leading-tight">{currentStep.title}</h2>

				{#if currentStepId === 'workspace'}
					<div class="mt-6 grid gap-5">
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
							<p class="mt-2 text-xs leading-5 text-muted-foreground">
								Lunapad will scaffold a dbt-ready project so the workspace opens with a useful model
								layout.
							</p>
						</div>
					</div>
				{:else if currentStepId === 'account'}
					<div class="mt-6 grid gap-5 sm:grid-cols-2">
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
						<div class="rounded-lg border border-border bg-muted/25 p-4">
							<p class="text-2xs tracking-wide text-muted-foreground uppercase">Workspace</p>
							<div class="mt-3 grid gap-3 sm:grid-cols-2">
								<div>
									<p class="text-xs text-muted-foreground">Workspace name</p>
									<p class="mt-1 text-sm font-medium">{workspaceName}</p>
								</div>
								<div>
									<p class="text-xs text-muted-foreground">Starter project</p>
									<p class="mt-1 text-sm font-medium">{projectName}</p>
								</div>
							</div>
						</div>
						<div class="rounded-lg border border-border bg-muted/25 p-4">
							<p class="text-2xs tracking-wide text-muted-foreground uppercase">Admin</p>
							<div class="mt-3 grid gap-3 sm:grid-cols-2">
								<div>
									<p class="text-xs text-muted-foreground">Name</p>
									<p class="mt-1 text-sm font-medium">{name}</p>
								</div>
								<div>
									<p class="text-xs text-muted-foreground">Email</p>
									<p class="mt-1 text-sm font-medium break-all">{email}</p>
								</div>
							</div>
						</div>
					</div>
				{/if}
			</div>

			{#if signupError}
				<p
					class="mt-5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
				>
					{signupError}
				</p>
			{/if}

			<div
				class="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between"
			>
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
		</div>
	</form>
</div>
