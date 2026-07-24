<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { authClient } from '$lib/auth-client';
	import {
		getTheme,
		setTheme,
		getLLMConfig,
		setLLMConfig,
		getGhostTextEnabled,
		setGhostTextEnabled
	} from '$lib/stores/notebook.svelte';
	import ConnectionsSettings from './ConnectionsSettings.svelte';
	import GitSettings from './GitSettings.svelte';
	import ApiKeysSettings from './ApiKeysSettings.svelte';
	import PythonPackagesPanel from './PythonPackagesPanel.svelte';
	import UsageSettings from './UsageSettings.svelte';
	import JobsSettings from './JobsSettings.svelte';
	import WorkspaceSettings from './WorkspaceSettings.svelte';
	import BrandThemeSection from './BrandThemeSection.svelte';
	import ProjectsSettings from './ProjectsSettings.svelte';
	import DiagnosticsSettings from './DiagnosticsSettings.svelte';
	import TeamSettings from '$lib/components/TeamSettings.svelte';
	import { toast } from 'svelte-sonner';
	import { getProjectFolder } from '$lib/stores/notebook.svelte';
	import {
		Settings,
		User,
		Sparkles,
		Database,
		FolderKanban,
		KeyRound,
		ShieldUser,
		Monitor,
		Sun,
		Moon,
		LogOut,
		PackageSearch,
		Activity,
		ListChecks,
		Wrench,
		GitBranch
	} from '@lucide/svelte';

	type SettingsTab =
		| 'general'
		| 'workspace'
		| 'projects'
		| 'account'
		| 'ai'
		| 'connections'
		| 'git'
		| 'api-keys'
		| 'python'
		| 'usage'
		| 'jobs'
		| 'diagnostics'
		| 'team';

	interface Props {
		open: boolean;
		tab: SettingsTab;
		onLogout: () => void;
	}

	let { open = $bindable(), tab = $bindable(), onLogout }: Props = $props();

	const session = authClient.useSession();
	const isAdmin = $derived($session.data?.user?.role === 'admin');

	const theme = $derived(getTheme());
	const llmConfig = $derived(getLLMConfig());
	const ghostTextEnabled = $derived(getGhostTextEnabled());
	const ghostReasoningModelWarning = $derived(
		ghostTextEnabled &&
			!llmConfig.completionModel?.trim() &&
			/qwen3|deepseek-r1|o1|reasoning/i.test(llmConfig.model)
	);

	let accountName = $state('');
	let savingProfile = $state(false);
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let changingPassword = $state(false);
	let accountSessions = $state<
		Array<{
			id: string;
			createdAt: string;
			updatedAt: string;
			expiresAt: string | null;
			ipAddress: string | null;
			userAgent: string | null;
			current: boolean;
		}>
	>([]);
	let loadingSessions = $state(false);
	let emailVerificationToken = $state('');
	let requestingEmailVerification = $state(false);
	let verifyingEmail = $state(false);
	let accountError = $state<string | null>(null);

	$effect(() => {
		if (open) accountName = $session.data?.user?.name ?? '';
	});

	$effect(() => {
		if (open && tab === 'account') void loadAccountSessions();
	});

	$effect(() => {
		// Hide the admin-only tab if the dialog is opened on it without admin rights.
		if (open && tab === 'team' && !isAdmin) tab = 'general';
		// Python packages only make sense with a project folder open.
		if (open && tab === 'python' && !getProjectFolder()) tab = 'general';
		// Git remote config is scoped to the open project folder.
		if (open && tab === 'git' && !getProjectFolder()) tab = 'general';
	});

	async function saveProfile(): Promise<void> {
		const name = accountName.trim();
		if (!name) return;
		savingProfile = true;
		try {
			const { error } = await authClient.updateUser({ name });
			if (error) {
				toast.error(error.message ?? 'Failed to update profile.');
				return;
			}
			toast.success('Profile updated.');
		} finally {
			savingProfile = false;
		}
	}

	async function changePassword(): Promise<void> {
		if (newPassword.length < 8) {
			toast.error('New password must be at least 8 characters.');
			return;
		}
		if (newPassword !== confirmPassword) {
			toast.error('Passwords do not match.');
			return;
		}
		changingPassword = true;
		try {
			const { error } = await authClient.changePassword({ currentPassword, newPassword });
			if (error) {
				toast.error(error.message ?? 'Failed to change password.');
				return;
			}
			toast.success('Password changed.');
			currentPassword = '';
			newPassword = '';
			confirmPassword = '';
		} finally {
			changingPassword = false;
		}
	}

	async function loadAccountSessions(): Promise<void> {
		loadingSessions = true;
		accountError = null;
		try {
			const res = await fetch('/api/account/sessions');
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.error ?? 'Failed to load account sessions.');
			accountSessions = body.sessions ?? [];
		} catch (err) {
			accountError = err instanceof Error ? err.message : 'Failed to load account sessions.';
		} finally {
			loadingSessions = false;
		}
	}

	async function signOutOtherSessions(): Promise<void> {
		const res = await fetch('/api/account/sessions', { method: 'DELETE' });
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			toast.error(body.error ?? 'Failed to sign out other sessions.');
			return;
		}
		toast.success('Other sessions signed out.');
		await loadAccountSessions();
	}

	async function requestEmailVerification(): Promise<void> {
		requestingEmailVerification = true;
		try {
			const res = await fetch('/api/account/email/verify', { method: 'POST' });
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.error ?? 'Failed to start email verification.');
			if (body.token) emailVerificationToken = body.token;
			toast.success(body.token ? 'Verification token generated.' : 'Verification email requested.');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to start email verification.');
		} finally {
			requestingEmailVerification = false;
		}
	}

	async function confirmEmailVerification(): Promise<void> {
		if (!emailVerificationToken.trim()) return;
		verifyingEmail = true;
		try {
			const res = await fetch('/api/account/email/verify', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token: emailVerificationToken.trim() })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.error ?? 'Failed to verify email.');
			toast.success('Email verified.');
			emailVerificationToken = '';
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to verify email.');
		} finally {
			verifyingEmail = false;
		}
	}

	async function exportAccount(): Promise<void> {
		const res = await fetch('/api/account/export');
		const body = await res.json().catch(() => null);
		if (!res.ok || !body) {
			toast.error('Failed to export account data.');
			return;
		}
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' })
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'lunapad-account-export.json';
		a.click();
		URL.revokeObjectURL(url);
		toast.success('Account export ready.');
	}

	const navItems = $derived([
		{ id: 'general' as const, label: 'General', icon: Settings },
		{ id: 'workspace' as const, label: 'Workspace', icon: ShieldUser },
		{ id: 'projects' as const, label: 'Projects', icon: FolderKanban },
		{ id: 'account' as const, label: 'Account', icon: User },
		{ id: 'ai' as const, label: 'AI', icon: Sparkles },
		{ id: 'connections' as const, label: 'Connections', icon: Database },
		...(getProjectFolder()
			? [{ id: 'git' as const, label: 'Source control', icon: GitBranch }]
			: []),
		{ id: 'api-keys' as const, label: 'API Keys', icon: KeyRound },
		{ id: 'usage' as const, label: 'Usage', icon: Activity },
		{ id: 'jobs' as const, label: 'Jobs', icon: ListChecks },
		...(isAdmin ? [{ id: 'diagnostics' as const, label: 'Diagnostics', icon: Wrench }] : []),
		// Python cells (and their packages) only exist in filesystem/project mode.
		...(getProjectFolder()
			? [{ id: 'python' as const, label: 'Python', icon: PackageSearch }]
			: []),
		...(isAdmin ? [{ id: 'team' as const, label: 'Team', icon: ShieldUser }] : [])
	]);
	const activeNavItem = $derived(navItems.find((item) => item.id === tab) ?? navItems[0]);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[min(720px,calc(100vh-2rem))] max-w-4xl gap-0 overflow-hidden p-0">
		<Dialog.Close class="absolute top-3 right-3 z-10" />
		<div class="grid h-[min(680px,calc(100vh-2rem))] grid-rows-[auto_1fr] sm:grid-cols-[11rem_1fr] sm:grid-rows-1">
			<div class="min-w-0 border-b border-border bg-muted/20 p-2 sm:border-r sm:border-b-0">
				<p class="px-2 py-1.5 text-xs font-semibold">Settings</p>
				<nav class="mt-1 flex gap-1 overflow-x-auto pb-1 sm:block sm:space-y-0.5 sm:overflow-visible sm:pb-0">
					{#each navItems as item (item.id)}
						<button
							class="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors sm:w-full {tab ===
							item.id
								? 'bg-accent text-foreground'
								: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
							onclick={() => (tab = item.id)}
						>
							<item.icon class="h-3.5 w-3.5" />
							{item.label}
						</button>
					{/each}
				</nav>
			</div>

			<div class="min-h-0 overflow-y-auto p-4 sm:p-5">
				<div class="mb-5 border-b border-border pb-4 pr-8">
					<h1 class="text-base font-semibold">{activeNavItem?.label ?? 'Settings'}</h1>
					<p class="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
						Manage workspace access, product preferences, data sources, and account controls.
					</p>
				</div>
				{#if tab === 'general'}
					<div class="space-y-4">
						<h2 class="text-sm font-semibold">Appearance</h2>
						<div class="flex gap-1.5">
							<Button
								variant={theme === 'system' ? 'secondary' : 'outline'}
								size="sm"
								class="h-7 gap-1.5 text-xs"
								onclick={() => setTheme('system')}
							>
								<Monitor class="h-3.5 w-3.5" /> System
							</Button>
							<Button
								variant={theme === 'light' ? 'secondary' : 'outline'}
								size="sm"
								class="h-7 gap-1.5 text-xs"
								onclick={() => setTheme('light')}
							>
								<Sun class="h-3.5 w-3.5" /> Light
							</Button>
							<Button
								variant={theme === 'dark' ? 'secondary' : 'outline'}
								size="sm"
								class="h-7 gap-1.5 text-xs"
								onclick={() => setTheme('dark')}
							>
								<Moon class="h-3.5 w-3.5" /> Dark
							</Button>
						</div>
						<BrandThemeSection />
					</div>
				{:else if tab === 'workspace'}
					<WorkspaceSettings />
				{:else if tab === 'projects'}
					<ProjectsSettings />
				{:else if tab === 'account'}
					<div class="space-y-6">
						{#if accountError}
							<div class="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
								<p class="text-xs text-destructive">{accountError}</p>
								<Button variant="outline" size="sm" class="h-7 text-xs" onclick={loadAccountSessions}>
									Retry
								</Button>
							</div>
						{/if}
						<div class="space-y-3">
							<h2 class="text-sm font-semibold">Profile</h2>
							<div class="space-y-1">
								<label for="account-email" class="text-xs text-muted-foreground">Email</label>
								<Input
									id="account-email"
									class="h-8 text-xs"
									value={$session.data?.user?.email ?? ''}
									readonly
									disabled
								/>
							</div>
							<div class="space-y-1">
								<label for="account-name" class="text-xs text-muted-foreground">Name</label>
								<div class="flex gap-1.5">
									<Input id="account-name" class="h-8 flex-1 text-xs" bind:value={accountName} />
									<Button
										size="sm"
										class="h-8 text-xs"
										disabled={savingProfile || !accountName.trim()}
										onclick={saveProfile}
									>
										{savingProfile ? 'Saving…' : 'Save profile'}
									</Button>
								</div>
							</div>
						</div>

						<div class="space-y-3">
							<h2 class="text-sm font-semibold">Change password</h2>
							<div class="grid gap-3 sm:grid-cols-3">
								<div class="space-y-1">
									<label for="account-current-password" class="text-xs text-muted-foreground"
										>Current password</label
									>
									<Input
										id="account-current-password"
										type="password"
										class="h-8 text-xs"
										bind:value={currentPassword}
										autocomplete="current-password"
									/>
								</div>
								<div class="space-y-1">
									<label for="account-new-password" class="text-xs text-muted-foreground"
										>New password</label
									>
									<Input
										id="account-new-password"
										type="password"
										class="h-8 text-xs"
										bind:value={newPassword}
										autocomplete="new-password"
									/>
								</div>
								<div class="space-y-1">
									<label for="account-confirm-password" class="text-xs text-muted-foreground"
										>Confirm new password</label
									>
									<Input
										id="account-confirm-password"
										type="password"
										class="h-8 text-xs"
										bind:value={confirmPassword}
										autocomplete="new-password"
									/>
								</div>
							</div>
							<Button
								variant="outline"
								size="sm"
								class="text-xs"
								disabled={changingPassword || !currentPassword || !newPassword}
								onclick={changePassword}
							>
								{changingPassword ? 'Changing…' : 'Change password'}
							</Button>
						</div>

						<div class="space-y-3 border-t border-border pt-4">
							<div class="flex items-center justify-between gap-3">
								<div>
									<h2 class="text-sm font-semibold">Email verification</h2>
									<p class="mt-1 text-xs text-muted-foreground">
										Request a verification token or paste one you received.
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									class="h-8 text-xs"
									disabled={requestingEmailVerification}
									onclick={requestEmailVerification}
								>
									{requestingEmailVerification ? 'Requesting…' : 'Request'}
								</Button>
							</div>
							<div class="flex gap-1.5">
								<Input
									class="h-8 flex-1 font-mono text-xs"
									placeholder="Verification token"
									bind:value={emailVerificationToken}
								/>
								<Button
									size="sm"
									class="h-8 text-xs"
									disabled={verifyingEmail || !emailVerificationToken.trim()}
									onclick={confirmEmailVerification}
								>
									{verifyingEmail ? 'Verifying…' : 'Verify'}
								</Button>
							</div>
						</div>

						<div class="space-y-3 border-t border-border pt-4">
							<div class="flex items-center justify-between gap-3">
								<div>
									<h2 class="text-sm font-semibold">Sessions</h2>
									<p class="mt-1 text-xs text-muted-foreground">Review active browser sessions.</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									class="h-8 text-xs"
									disabled={loadingSessions}
									onclick={loadAccountSessions}
								>
									Refresh
								</Button>
							</div>
							<div class="space-y-1">
								{#if loadingSessions && accountSessions.length === 0}
									<div class="h-8 rounded-md bg-muted/60"></div>
									<div class="h-8 rounded-md bg-muted/40"></div>
								{:else if accountSessions.length === 0}
									<p class="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
										No sessions found.
									</p>
								{:else}
									{#each accountSessions.slice(0, 6) as sessionItem (sessionItem.id)}
										<div class="rounded-md border border-border px-3 py-2 text-xs">
											<div class="flex items-center justify-between gap-2">
												<p class="truncate font-medium">
													{sessionItem.current ? 'Current session' : 'Signed-in session'}
												</p>
												<p class="shrink-0 text-2xs text-muted-foreground">
													{new Date(sessionItem.updatedAt).toLocaleString()}
												</p>
											</div>
											<p class="mt-1 truncate text-2xs text-muted-foreground">
												{sessionItem.ipAddress ?? 'Unknown IP'} · {sessionItem.userAgent ?? 'Unknown device'}
											</p>
										</div>
									{/each}
								{/if}
							</div>
							<Button
								variant="outline"
								size="sm"
								class="text-xs"
								disabled={accountSessions.filter((item) => !item.current).length === 0}
								onclick={signOutOtherSessions}
							>
								Sign out other sessions
							</Button>
						</div>

						<div class="space-y-3 border-t border-border pt-4">
							<h2 class="text-sm font-semibold">Account data</h2>
							<Button variant="outline" size="sm" class="text-xs" onclick={exportAccount}>
								Export account data
							</Button>
						</div>

						<div class="border-t border-border pt-4">
							<Button variant="destructive" size="sm" class="gap-1.5 text-xs" onclick={onLogout}>
								<LogOut class="h-3.5 w-3.5" /> Log out
							</Button>
						</div>
					</div>
				{:else if tab === 'ai'}
					<div class="space-y-4">
						<h2 class="text-sm font-semibold">AI</h2>
						<div class="space-y-3">
							<div class="space-y-1">
								<label for="llm-provider" class="text-xs text-muted-foreground">Provider</label>
								<Select.Root
									type="single"
									value={llmConfig.provider}
									onValueChange={(value) =>
										setLLMConfig({ provider: value as 'openapi-compatible' | 'ollama' })}
								>
									<Select.Trigger id="llm-provider" class="h-8 font-mono text-xs">
										{llmConfig.provider === 'ollama'
											? 'Ollama (OpenAI-compatible)'
											: 'OpenAPI-compatible'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="openapi-compatible" class="text-xs"
											>OpenAPI-compatible</Select.Item
										>
										<Select.Item value="ollama" class="text-xs">Ollama</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>
							<div class="space-y-1">
								<label for="llm-base-url" class="text-xs text-muted-foreground">Base URL</label>
								<Input
									id="llm-base-url"
									class="h-8 font-mono text-xs"
									value={llmConfig.baseUrl}
									oninput={(e: Event) =>
										setLLMConfig({ baseUrl: (e.target as HTMLInputElement).value })}
								/>
							</div>
							<div class="space-y-1">
								<label for="llm-api-key" class="text-xs text-muted-foreground"
									>API key <span class="opacity-50">(optional)</span></label
								>
								<Input
									id="llm-api-key"
									type="password"
									class="h-8 font-mono text-xs"
									value={llmConfig.apiKey ?? ''}
									oninput={(e: Event) =>
										setLLMConfig({ apiKey: (e.target as HTMLInputElement).value || undefined })}
								/>
							</div>
							<div class="space-y-1">
								<label for="llm-model" class="text-xs text-muted-foreground">Model</label>
								<Input
									id="llm-model"
									class="h-8 font-mono text-xs"
									value={llmConfig.model}
									oninput={(e: Event) =>
										setLLMConfig({ model: (e.target as HTMLInputElement).value })}
								/>
							</div>
							<p class="text-xs text-muted-foreground">
								Used by the AI chat panel. For Ollama: <span class="font-mono">qwen3:1.7b</span>
								(fast) or <span class="font-mono">qwen3:4b</span> (better quality).
							</p>
							<div class="space-y-1 border-t border-border pt-3">
								<label class="flex items-center gap-2 text-xs text-muted-foreground">
									<input
										type="checkbox"
										class="accent-primary"
										checked={ghostTextEnabled}
										onchange={(e: Event) =>
											setGhostTextEnabled((e.target as HTMLInputElement).checked)}
									/>
									Ghost-text completions in PRQL/SQL/Python cells
								</label>
								<label for="llm-completion-model" class="text-xs text-muted-foreground"
									>Completion model <span class="opacity-50">(optional override)</span></label
								>
								<Input
									id="llm-completion-model"
									class="h-8 font-mono text-xs"
									placeholder={llmConfig.model}
									value={llmConfig.completionModel ?? ''}
									oninput={(e: Event) =>
										setLLMConfig({
											completionModel: (e.target as HTMLInputElement).value || undefined
										})}
								/>
								<p class="text-xs text-muted-foreground">
									Reasoning/chat models often burn their token budget "thinking" and return empty
									ghost-text suggestions. A small dedicated code-completion model works much better
									here — e.g. <span class="font-mono">qwen2.5-coder:1.5b</span>. Leave blank to
									reuse the model above.
								</p>
								{#if ghostReasoningModelWarning}
									<p class="text-xs text-warning">
										Your chat model looks like a reasoning model — ghost text will likely stay empty
										until you set a small coder model above.
									</p>
								{/if}
							</div>
						</div>
					</div>
				{:else if tab === 'connections'}
					<ConnectionsSettings />
				{:else if tab === 'git'}
					<GitSettings />
				{:else if tab === 'api-keys'}
					<ApiKeysSettings />
				{:else if tab === 'python'}
					<PythonPackagesPanel />
				{:else if tab === 'usage'}
					<UsageSettings />
				{:else if tab === 'jobs'}
					<JobsSettings />
				{:else if tab === 'diagnostics' && isAdmin}
					<DiagnosticsSettings />
				{:else if tab === 'team' && isAdmin}
					<TeamSettings />
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
