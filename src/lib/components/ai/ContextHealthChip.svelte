<script lang="ts">
	import { onMount } from 'svelte';
	import { AlertTriangle } from '@lucide/svelte';
	import type { ContextHealthResponse } from '$lib/agent/types/context-health.js';

	let health = $state<ContextHealthResponse | null>(null);
	let dismissed = $state(false);

	const degraded = $derived(
		health !== null && (!health.rag || !health.memory || (health.issues?.length ?? 0) > 0)
	);

	onMount(() => {
		void fetch('/api/ai/context-health')
			.then((r) => (r.ok ? r.json() : null))
			.then((data: ContextHealthResponse | null) => {
				if (data) health = data;
			})
			.catch(() => {});
	});
</script>

{#if degraded && !dismissed && health}
	<div
		class="mx-2 mb-1 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-900 dark:text-amber-200"
		role="status"
	>
		<AlertTriangle size={12} class="mt-0.5 shrink-0 opacity-70" />
		<div class="min-w-0 flex-1">
			<span class="font-medium">Limited context</span>
			{#if (health.issues?.length ?? 0) > 0}
				<span class="text-amber-800/80 dark:text-amber-300/80">
					— {health.issues![0]}
				</span>
			{/if}
		</div>
		<button
			type="button"
			class="shrink-0 text-amber-700/60 hover:text-amber-900 dark:text-amber-300/60 dark:hover:text-amber-100"
			onclick={() => (dismissed = true)}
			aria-label="Dismiss context health notice"
		>
			×
		</button>
	</div>
{/if}
