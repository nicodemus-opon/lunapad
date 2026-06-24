<script lang="ts">
	import { Plus, Trash2 } from '@lucide/svelte';
	import { getWorkspaceStandards, setWorkspaceStandards } from '$lib/stores/ai-chat.svelte.js';
	import { scheduleSave } from '$lib/stores/notebook.svelte.js';
	import type { WorkspaceNamingRule } from '$lib/types/ai-chat.js';

	const MATERIALIZE_OPTIONS = ['ephemeral', 'view', 'table', 'incremental'] as const;

	let standards = $derived(getWorkspaceStandards());

	function addRule() {
		setWorkspaceStandards({
			...standards,
			namingRules: [...standards.namingRules, { prefix: '', description: '', materialization: 'ephemeral' }]
		});
		scheduleSave();
	}

	function removeRule(i: number) {
		const next = standards.namingRules.filter((_, idx) => idx !== i);
		setWorkspaceStandards({ ...standards, namingRules: next });
		scheduleSave();
	}

	function updateRule(i: number, field: keyof WorkspaceNamingRule, value: string) {
		const next = standards.namingRules.map((r, idx) => idx === i ? { ...r, [field]: value } : r);
		setWorkspaceStandards({ ...standards, namingRules: next });
		scheduleSave();
	}

	function updateInstructions(value: string) {
		setWorkspaceStandards({ ...standards, customInstructions: value });
		scheduleSave();
	}
</script>

<div class="flex flex-col gap-3 border-b border-border/40 bg-muted/20 px-3 py-3">
	<div class="flex items-center justify-between">
		<span class="text-xs font-medium text-foreground/70">Modeling Standards</span>
		<button
			class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			onclick={addRule}
		>
			<Plus size={11} />
			Add rule
		</button>
	</div>

	{#if standards.namingRules.length > 0}
		<div class="flex flex-col gap-1">
			{#each standards.namingRules as rule, i}
				<div class="flex items-center gap-1.5">
					<input
						class="w-20 shrink-0 rounded border border-border/50 bg-background px-1.5 py-0.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
						placeholder="dim_"
						value={rule.prefix}
						oninput={(e) => updateRule(i, 'prefix', (e.target as HTMLInputElement).value)}
					/>
					<input
						class="min-w-0 flex-1 rounded border border-border/50 bg-background px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
						placeholder="description"
						value={rule.description}
						oninput={(e) => updateRule(i, 'description', (e.target as HTMLInputElement).value)}
					/>
					<select
						class="w-24 shrink-0 rounded border border-border/50 bg-background px-1 py-0.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
						value={rule.materialization}
						onchange={(e) => updateRule(i, 'materialization', (e.target as HTMLSelectElement).value)}
					>
						{#each MATERIALIZE_OPTIONS as opt}
							<option value={opt}>{opt}</option>
						{/each}
					</select>
					<button
						class="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
						onclick={() => removeRule(i)}
						aria-label="Remove rule"
					>
						<Trash2 size={11} />
					</button>
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-xs text-muted-foreground/60">No rules defined — conventions will be inferred from existing cell names.</p>
	{/if}

	<textarea
		class="min-h-[52px] w-full resize-none rounded border border-border/50 bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
		placeholder="Custom instructions (e.g. always use UTC timestamps, surrogate keys for dimensions…)"
		value={standards.customInstructions}
		oninput={(e) => updateInstructions((e.target as HTMLTextAreaElement).value)}
		rows={2}
	></textarea>
</div>
