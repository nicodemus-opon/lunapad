<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { CheckCircle2, Circle, RefreshCw, X } from '@lucide/svelte';

	type ChecklistItem = {
		id: string;
		label: string;
		description: string;
		done: boolean;
		dismissed: boolean;
		actionHref?: string;
		actionLabel?: string;
	};

	let items = $state<ChecklistItem[]>([]);
	let loading = $state(false);
	let hidden = $state(false);
	let error = $state<string | null>(null);

	const visibleItems = $derived(items.filter((item) => !item.dismissed));
	const remaining = $derived(visibleItems.filter((item) => !item.done).length);
	const complete = $derived(visibleItems.length > 0 && remaining === 0);

	async function loadChecklist(): Promise<void> {
		loading = true;
		error = null;
		try {
			const res = await fetch('/api/onboarding/checklist');
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.error ?? 'Failed to load workspace setup.');
			items = body.items ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load workspace setup.';
		} finally {
			loading = false;
		}
	}

	async function dismiss(itemId: string): Promise<void> {
		error = null;
		const previousItems = items;
		items = items.map((item) => (item.id === itemId ? { ...item, dismissed: true } : item));
		try {
			const res = await fetch(`/api/onboarding/checklist/${encodeURIComponent(itemId)}/dismiss`, {
				method: 'POST'
			});
			if (!res.ok) throw new Error('Failed to dismiss checklist item.');
		} catch (err) {
			items = previousItems;
			error = err instanceof Error ? err.message : 'Failed to dismiss checklist item.';
		}
	}

	onMount(loadChecklist);
</script>

{#if !hidden && !loading && (visibleItems.length > 0 || error) && !complete}
	<section
		class="mb-5 rounded-md border border-border bg-muted/25 px-3 py-2.5"
		aria-label="Workspace onboarding checklist"
	>
		<div class="mb-2 flex items-center justify-between gap-3">
			<div>
				<h2 class="text-xs font-semibold text-foreground">Workspace setup</h2>
				<p class="text-2xs text-muted-foreground">{remaining} step{remaining === 1 ? '' : 's'} left</p>
			</div>
			<div class="flex items-center gap-1">
				<Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={loadChecklist} aria-label="Refresh checklist">
					<RefreshCw class="h-3.5 w-3.5" />
				</Button>
				<Button variant="ghost" size="sm" class="h-7 w-7 p-0" onclick={() => (hidden = true)} aria-label="Hide checklist">
					<X class="h-3.5 w-3.5" />
				</Button>
			</div>
		</div>
		{#if error}
			<div class="mb-2 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5">
				<p class="text-2xs text-destructive">{error}</p>
				<Button variant="outline" size="sm" class="h-6 text-2xs" onclick={loadChecklist}>Retry</Button>
			</div>
		{/if}
		<div class="grid gap-1.5 sm:grid-cols-2">
			{#each visibleItems as item (item.id)}
				<div class="flex items-start gap-2 rounded-md bg-background/70 px-2 py-2">
					{#if item.done}
						<CheckCircle2 class="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
					{:else}
						<Circle class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
					{/if}
					<div class="min-w-0 flex-1">
						<p class="text-xs font-medium text-foreground">{item.label}</p>
						<p class="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{item.description}</p>
					</div>
					{#if item.done}
						<Button variant="ghost" size="sm" class="h-6 w-6 p-0" onclick={() => dismiss(item.id)} aria-label="Dismiss checklist item">
							<X class="h-3 w-3" />
						</Button>
					{:else if item.actionHref && item.actionLabel}
						<a class="text-2xs font-medium text-primary underline-offset-2 hover:underline" href={item.actionHref}>
							{item.actionLabel}
						</a>
					{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}
