<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Copy, CheckCircle2, ExternalLink, KeyRound, Trash2 } from '@lucide/svelte';
	import { getProjectFolder } from '$lib/stores/notebook.svelte';
	import {
		gitGetRemote,
		gitSetRemote,
		gitGenerateDeployKey,
		gitSavePatCredential,
		gitRemoveCredential
	} from '$lib/services/git-client';
	import type { GitRemoteInfo } from '$lib/types/git';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

	const projectFolder = $derived(getProjectFolder());

	let remote = $state<GitRemoteInfo | null>(null);
	let loading = $state(true);
	let remoteUrl = $state('');
	let defaultBranch = $state('main');
	let savingRemote = $state(false);

	let generatingKey = $state(false);
	let showPatForm = $state(false);
	let patToken = $state('');
	let patUsername = $state('');
	let savingPat = $state(false);

	let removeConfirmOpen = $state(false);

	async function load() {
		if (!projectFolder) return;
		loading = true;
		try {
			remote = await gitGetRemote(projectFolder);
			if (remote) {
				remoteUrl = remote.remoteUrl;
				defaultBranch = remote.defaultBranch;
			}
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to load git remote settings');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (projectFolder) void load();
	});

	async function saveRemote() {
		if (!projectFolder || !remoteUrl.trim()) return;
		savingRemote = true;
		try {
			await gitSetRemote(projectFolder, remoteUrl.trim(), defaultBranch.trim() || 'main');
			toast.success('Remote saved');
			await load();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to save remote');
		} finally {
			savingRemote = false;
		}
	}

	async function generateDeployKey() {
		if (!projectFolder) return;
		generatingKey = true;
		try {
			await gitGenerateDeployKey(projectFolder);
			toast.success('Deploy key generated — add the public key to your git host below');
			await load();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to generate deploy key');
		} finally {
			generatingKey = false;
		}
	}

	async function copyPublicKey() {
		if (!remote?.publicKey) return;
		await navigator.clipboard.writeText(remote.publicKey);
		toast.success('Public key copied');
	}

	async function savePat() {
		if (!projectFolder || !patToken.trim()) return;
		savingPat = true;
		try {
			await gitSavePatCredential(projectFolder, patToken.trim(), patUsername.trim() || undefined);
			toast.success('Credential saved');
			patToken = '';
			patUsername = '';
			showPatForm = false;
			await load();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to save credential');
		} finally {
			savingPat = false;
		}
	}

	async function removeCredential() {
		if (!projectFolder) return;
		try {
			await gitRemoveCredential(projectFolder);
			toast.success('Credential removed');
			await load();
		} catch (err) {
			toast.error((err as Error).message ?? 'Failed to remove credential');
		}
	}

	function hostFromRemoteUrl(url: string): { host: string; repoPath: string } | null {
		const match = url.match(/(?:git@|https:\/\/)([^/:]+)[:/](.+?)(?:\.git)?$/);
		if (!match) return null;
		return { host: match[1], repoPath: match[2] };
	}

	const deployKeySettingsUrl = $derived.by(() => {
		if (!remote) return null;
		const parsed = hostFromRemoteUrl(remote.remoteUrl);
		if (!parsed) return null;
		if (parsed.host.includes('github.com'))
			return `https://${parsed.host}/${parsed.repoPath}/settings/keys`;
		if (parsed.host.includes('gitlab.com'))
			return `https://${parsed.host}/${parsed.repoPath}/-/settings/repository`;
		return null;
	});
</script>

<div class="space-y-5">
	<div>
		<h2 class="text-sm font-semibold">Remote repository</h2>
		<p class="mt-1 text-xs leading-5 text-muted-foreground">
			Connect this project's folder to a git remote to commit, push, and pull from the Source
			control panel.
		</p>
	</div>

	{#if !projectFolder}
		<p class="text-xs text-muted-foreground">Open a project folder to configure git.</p>
	{:else if loading}
		<p class="text-xs text-muted-foreground">Loading…</p>
	{:else}
		{#if remote?.hasCredential}
			<div
				class="flex items-center gap-1.5 rounded border border-success/30 bg-success/5 px-2.5 py-1.5 text-xs text-success"
			>
				<CheckCircle2 class="h-3.5 w-3.5 shrink-0" />
				Connected to <span class="truncate font-mono">{remote.remoteUrl}</span>
				<span class="text-muted-foreground"
					>via {remote.authMethod === 'deploy-key' ? 'deploy key' : 'access token'}</span
				>
			</div>
		{/if}

		<div class="space-y-2">
			<div class="grid gap-1">
				<label class="text-xs font-medium text-muted-foreground" for="git-remote-url"
					>Remote URL</label
				>
				<Input
					id="git-remote-url"
					class="h-8 font-mono text-xs"
					placeholder="git@github.com:org/repo.git or https://github.com/org/repo.git"
					bind:value={remoteUrl}
				/>
			</div>
			<div class="grid gap-1">
				<label class="text-xs font-medium text-muted-foreground" for="git-default-branch"
					>Default branch</label
				>
				<Input
					id="git-default-branch"
					class="h-8 w-40 font-mono text-xs"
					bind:value={defaultBranch}
				/>
			</div>
			<Button
				size="sm"
				class="h-7 text-xs"
				disabled={savingRemote || !remoteUrl.trim()}
				onclick={saveRemote}
			>
				{savingRemote ? 'Saving…' : 'Save remote'}
			</Button>
		</div>

		{#if remote}
			<div class="space-y-3 border-t border-border pt-4">
				<h3 class="text-xs font-semibold">Authentication</h3>

				<div class="space-y-2 rounded-md border border-border p-3">
					<div class="flex items-center gap-1.5 text-xs font-medium">
						<KeyRound class="h-3.5 w-3.5 text-muted-foreground" /> Deploy key (recommended)
					</div>
					<p class="text-2xs leading-relaxed text-muted-foreground">
						Generates a key pair on the server and keeps only the private half. Register the public
						key on your git host with read/write access — Lunapad never sees or stores a
						broadly-scoped token.
					</p>

					{#if remote.authMethod === 'deploy-key' && remote.publicKey}
						<div class="space-y-1.5">
							<div class="flex items-center gap-1.5">
								<code class="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-2xs"
									>{remote.publicKey}</code
								>
								<Button
									variant="outline"
									size="sm"
									class="h-7 w-7 shrink-0 p-0"
									onclick={copyPublicKey}
									title="Copy"
								>
									<Copy class="h-3 w-3" />
								</Button>
							</div>
							{#if deployKeySettingsUrl}
								<a
									href={deployKeySettingsUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex items-center gap-1 text-2xs text-primary hover:underline"
								>
									<ExternalLink class="h-3 w-3" /> Open deploy key settings on your git host
								</a>
							{/if}
						</div>
					{:else}
						<Button
							size="sm"
							variant="outline"
							class="h-7 text-xs"
							disabled={generatingKey || !remoteUrl.trim()}
							onclick={generateDeployKey}
						>
							{generatingKey ? 'Generating…' : 'Generate deploy key'}
						</Button>
					{/if}
				</div>

				{#if !showPatForm && remote.authMethod !== 'pat'}
					<button
						class="text-2xs text-muted-foreground hover:text-foreground hover:underline"
						onclick={() => (showPatForm = true)}
					>
						Use a personal access token instead
					</button>
				{:else if remote.authMethod === 'pat' || showPatForm}
					<div class="space-y-2 rounded-md border border-border p-3">
						<div class="text-xs font-medium">Personal access token</div>
						<div class="grid gap-1">
							<label class="text-2xs text-muted-foreground" for="git-pat-token">Token</label>
							<Input
								id="git-pat-token"
								type="password"
								class="h-8 font-mono text-xs"
								placeholder={remote.authMethod === 'pat'
									? 'Leave blank to keep current token'
									: 'ghp_…'}
								bind:value={patToken}
							/>
						</div>
						<div class="grid gap-1">
							<label class="text-2xs text-muted-foreground" for="git-pat-username"
								>Username (optional)</label
							>
							<Input
								id="git-pat-username"
								class="h-8 text-xs"
								placeholder="x-access-token"
								bind:value={patUsername}
							/>
						</div>
						<Button
							size="sm"
							class="h-7 text-xs"
							disabled={savingPat || !patToken.trim()}
							onclick={savePat}
						>
							{savingPat ? 'Testing & saving…' : 'Test & save'}
						</Button>
					</div>
				{/if}

				{#if remote.hasCredential}
					<Button
						variant="ghost"
						size="sm"
						class="h-7 gap-1.5 text-2xs text-destructive hover:text-destructive"
						onclick={() => (removeConfirmOpen = true)}
					>
						<Trash2 class="h-3 w-3" /> Remove credential
					</Button>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<ConfirmDialog
	bind:open={removeConfirmOpen}
	title="Remove saved git credential?"
	body="You'll need to re-enter it to push or pull from this project."
	confirmLabel="Remove"
	onConfirm={removeCredential}
/>
