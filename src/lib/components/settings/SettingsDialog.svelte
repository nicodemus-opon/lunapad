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
	import ApiKeysSettings from './ApiKeysSettings.svelte';
	import PythonPackagesPanel from './PythonPackagesPanel.svelte';
	import TeamSettings from '$lib/components/TeamSettings.svelte';
	import { toast } from 'svelte-sonner';
	import { getProjectFolder } from '$lib/stores/notebook.svelte';
	import {
		Settings,
		User,
		Sparkles,
		Database,
		KeyRound,
		ShieldUser,
		Monitor,
		Sun,
		Moon,
		LogOut,
		PackageSearch
	} from '@lucide/svelte';

	type SettingsTab = 'general' | 'account' | 'ai' | 'connections' | 'api-keys' | 'python' | 'team';

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

	let accountName = $state('');
	let savingProfile = $state(false);
	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let changingPassword = $state(false);

	$effect(() => {
		if (open) accountName = $session.data?.user?.name ?? '';
	});

	$effect(() => {
		// Hide the admin-only tab if the dialog is opened on it without admin rights.
		if (open && tab === 'team' && !isAdmin) tab = 'general';
		// Python packages only make sense with a project folder open.
		if (open && tab === 'python' && !getProjectFolder()) tab = 'general';
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

	const navItems = $derived([
		{ id: 'general' as const, label: 'General', icon: Settings },
		{ id: 'account' as const, label: 'Account', icon: User },
		{ id: 'ai' as const, label: 'AI', icon: Sparkles },
		{ id: 'connections' as const, label: 'Connections', icon: Database },
		{ id: 'api-keys' as const, label: 'API Keys', icon: KeyRound },
		// Python cells (and their packages) only exist in filesystem/project mode.
		...(getProjectFolder()
			? [{ id: 'python' as const, label: 'Python', icon: PackageSearch }]
			: []),
		...(isAdmin ? [{ id: 'team' as const, label: 'Team', icon: ShieldUser }] : [])
	]);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-3xl gap-0 overflow-hidden p-0">
		<div class="flex h-[560px]">
			<div class="flex w-44 shrink-0 flex-col border-r border-border/60 bg-muted/20 p-2">
				<p class="px-2 py-1.5 text-xs font-semibold">Settings</p>
				<nav class="mt-1 space-y-0.5">
					{#each navItems as item (item.id)}
						<button
							class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors {tab ===
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

			<div class="flex-1 overflow-y-auto p-5">
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
					</div>
				{:else if tab === 'account'}
					<div class="space-y-6">
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
										disabled={savingProfile}
										onclick={saveProfile}
									>
										{savingProfile ? 'Saving…' : 'Save'}
									</Button>
								</div>
							</div>
						</div>

						<div class="space-y-3">
							<h2 class="text-sm font-semibold">Change password</h2>
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

						<div class="border-t border-border/60 pt-4">
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
							<div class="space-y-1 border-t border-border/40 pt-3">
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
									Reasoning/chat models often burn their token budget "thinking" and return
									empty ghost-text suggestions. A small dedicated code-completion model works
									much better here — e.g. <span class="font-mono">qwen2.5-coder:1.5b</span>. Leave
									blank to reuse the model above.
								</p>
							</div>
						</div>
					</div>
				{:else if tab === 'connections'}
					<ConnectionsSettings />
				{:else if tab === 'api-keys'}
					<ApiKeysSettings />
				{:else if tab === 'python'}
					<PythonPackagesPanel />
				{:else if tab === 'team' && isAdmin}
					<TeamSettings />
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
