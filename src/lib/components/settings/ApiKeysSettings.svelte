<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { toast } from 'svelte-sonner';
	import { Copy, KeyRound, Loader2, Trash2 } from '@lucide/svelte';

	interface ApiKeyRecord {
		id: string;
		name: string;
		prefix: string;
		createdAt: string;
		lastUsedAt: string | null;
		expiresAt: string | null;
		revokedAt: string | null;
	}

	let keys = $state<ApiKeyRecord[]>([]);
	let loading = $state(true);
	let creating = $state(false);
	let newKeyName = $state('');
	let newKeyExpiry = $state<'never' | '30' | '90' | '365'>('never');
	let revealedKey = $state<string | null>(null);

	$effect(() => {
		void loadKeys();
	});

	async function loadKeys(): Promise<void> {
		loading = true;
		try {
			const res = await fetch('/api/account/api-keys');
			const body = await res.json();
			keys = body.keys ?? [];
		} finally {
			loading = false;
		}
	}

	function formatDate(value: string | null): string {
		if (!value) return 'Never';
		return new Date(value).toLocaleString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	async function createKey(): Promise<void> {
		const name = newKeyName.trim();
		if (!name) return;
		creating = true;
		try {
			const expiresInDays = newKeyExpiry === 'never' ? undefined : Number(newKeyExpiry);
			const res = await fetch('/api/account/api-keys', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name, expiresInDays })
			});
			const body = await res.json();
			if (!res.ok) {
				toast.error(body.error ?? 'Failed to create API key.');
				return;
			}
			revealedKey = body.fullKey;
			newKeyName = '';
			newKeyExpiry = 'never';
			await loadKeys();
		} finally {
			creating = false;
		}
	}

	async function revokeKey(id: string): Promise<void> {
		keys = keys.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k));
		const res = await fetch(`/api/account/api-keys/${id}`, { method: 'DELETE' });
		if (!res.ok) {
			toast.error('Failed to revoke key.');
			await loadKeys();
			return;
		}
		toast.success('API key revoked.');
	}

	function copyRevealedKey(): void {
		if (!revealedKey) return;
		void navigator.clipboard.writeText(revealedKey);
		toast.success('Key copied.');
	}
</script>

<div class="space-y-6">
	<div class="space-y-1">
		<h2 class="text-sm font-semibold">API Keys</h2>
		<p class="text-xs text-muted-foreground">
			Used to authenticate scripts, CI jobs, and MCP clients against the
			<span class="font-mono">/api/v1</span> and <span class="font-mono">/api/mcp</span> endpoints — in
			place of a browser session cookie.
		</p>
	</div>

	{#if revealedKey}
		<div class="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
			<p class="text-xs font-medium">Copy this key now — it won't be shown again.</p>
			<div class="flex gap-1.5">
				<Input readonly class="h-8 flex-1 font-mono text-xs" value={revealedKey} />
				<Button size="sm" variant="outline" class="h-8 gap-1.5 text-xs" onclick={copyRevealedKey}>
					<Copy class="h-3.5 w-3.5" /> Copy
				</Button>
			</div>
			<Button size="sm" variant="ghost" class="h-7 text-xs" onclick={() => (revealedKey = null)}
				>Done</Button
			>
		</div>
	{/if}

	<div class="space-y-2">
		<div class="flex gap-1.5">
			<Input
				class="h-8 flex-1 text-xs"
				placeholder="Key name, e.g. CI pipeline"
				bind:value={newKeyName}
				onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && createKey()}
			/>
			<Select.Root
				type="single"
				value={newKeyExpiry}
				onValueChange={(v) => (newKeyExpiry = v as typeof newKeyExpiry)}
			>
				<Select.Trigger class="h-8 w-32 text-xs">
					{newKeyExpiry === 'never' ? 'No expiry' : `${newKeyExpiry} days`}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="never" class="text-xs">No expiry</Select.Item>
					<Select.Item value="30" class="text-xs">30 days</Select.Item>
					<Select.Item value="90" class="text-xs">90 days</Select.Item>
					<Select.Item value="365" class="text-xs">365 days</Select.Item>
				</Select.Content>
			</Select.Root>
			<Button
				size="sm"
				class="h-8 gap-1.5 text-xs"
				disabled={creating || !newKeyName.trim()}
				onclick={createKey}
			>
				{#if creating}
					<Loader2 class="h-3.5 w-3.5 animate-spin" />
				{:else}
					<KeyRound class="h-3.5 w-3.5" />
				{/if}
				Create
			</Button>
		</div>
	</div>

	<div class="space-y-1">
		{#if loading}
			<div class="flex items-center justify-center py-6 text-muted-foreground">
				<Loader2 class="h-4 w-4 animate-spin" />
			</div>
		{:else if keys.length === 0}
			<p class="py-4 text-center text-xs text-muted-foreground">No API keys yet.</p>
		{:else}
			{#each keys as key (key.id)}
				<div
					class="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2 {key.revokedAt
						? 'opacity-50'
						: ''}"
				>
					<div class="min-w-0 flex-1 space-y-0.5">
						<p class="truncate text-xs font-medium">{key.name}</p>
						<p class="font-mono text-2xs text-muted-foreground">{key.prefix}••••••</p>
						<p class="text-2xs text-muted-foreground">
							Created {formatDate(key.createdAt)} · Last used {formatDate(key.lastUsedAt)} · Expires {formatDate(
								key.expiresAt
							)}
							{#if key.revokedAt}
								· Revoked
							{/if}
						</p>
					</div>
					{#if !key.revokedAt}
						<Button
							size="sm"
							variant="ghost"
							class="h-7 shrink-0 gap-1.5 text-xs text-destructive hover:text-destructive"
							onclick={() => revokeKey(key.id)}
						>
							<Trash2 class="h-3.5 w-3.5" /> Revoke
						</Button>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
