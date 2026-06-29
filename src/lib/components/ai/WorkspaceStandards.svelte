<script lang="ts">
	import { Plus, Trash2 } from '@lucide/svelte';
	import { getWorkspaceStandards, setWorkspaceStandards } from '$lib/stores/ai-chat.svelte.js';
	import { scheduleSave, getProjectFolder, getIsDbtProject } from '$lib/stores/notebook.svelte.js';
	import { readAIMemory, removeAIMemoryEntry, writeAIConventions, type AIMemoryEntry } from '$lib/services/project-client.js';
	import type { WorkspaceNamingRule } from '$lib/types/ai-chat.js';

	const MATERIALIZE_OPTIONS = ['ephemeral', 'view', 'table', 'incremental'] as const;

	let standards = $derived(getWorkspaceStandards());
	let memoryEntries = $state<AIMemoryEntry[]>([]);
	let lastLoadedFolder: string | null = null;
	let conventionsSaveTimer: ReturnType<typeof setTimeout> | undefined;

	// Reload the persisted memory list whenever the open project folder changes (including to/from
	// no project). loadProjectMemoryIfNeeded() in ai-chat-client.ts already seeds customInstructions
	// into the store on a folder switch — this just keeps the entries list in this panel in sync.
	$effect(() => {
		const folder = getProjectFolder();
		const isDbt = getIsDbtProject();
		if (folder === lastLoadedFolder) return;
		lastLoadedFolder = folder;
		if (!folder || !isDbt) {
			memoryEntries = [];
			return;
		}
		readAIMemory(folder)
			.then((res) => {
				memoryEntries = res.entries;
			})
			.catch(() => {
				memoryEntries = [];
			});
	});

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

		// Disk write is debounced separately from the instant localStorage write above — this
		// fires on every keystroke and a network round-trip per keystroke would be wasteful.
		const folder = getProjectFolder();
		if (!folder || !getIsDbtProject()) return;
		clearTimeout(conventionsSaveTimer);
		conventionsSaveTimer = setTimeout(() => {
			writeAIConventions(folder, value).catch((err) =>
				console.error('[ai-memory] failed to persist conventions:', err)
			);
		}, 500);
	}

	async function deleteMemoryEntry(slug: string) {
		const folder = getProjectFolder();
		if (!folder) return;
		try {
			memoryEntries = await removeAIMemoryEntry(folder, slug);
		} catch (err) {
			console.error('[ai-memory] failed to remove entry:', err);
		}
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

	{#if memoryEntries.length > 0}
		<div class="flex flex-col gap-1">
			<span class="text-2xs font-medium text-muted-foreground/70">
				Memory — decisions &amp; discoveries recorded by the AI, persisted to this project
			</span>
			{#each memoryEntries as entry (entry.slug)}
				<div class="flex items-start gap-1.5">
					<span
						class="mt-0.5 shrink-0 rounded px-1 py-0.5 text-2xs font-medium {entry.type === 'discovery'
							? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
							: 'bg-primary/15 text-primary'}"
					>
						{entry.type}
					</span>
					<span class="min-w-0 flex-1 text-2xs text-foreground/80">{entry.description}</span>
					<button
						class="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
						onclick={() => deleteMemoryEntry(entry.slug)}
						aria-label="Delete memory entry"
					>
						<Trash2 size={11} />
					</button>
				</div>
			{/each}
		</div>
	{/if}
</div>
