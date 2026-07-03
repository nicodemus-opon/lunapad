<script lang="ts">
	import { Plus, Trash2 } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { getWorkspaceStandards, setWorkspaceStandards } from '$lib/stores/ai-chat.svelte.js';
	import { scheduleSave, getProjectFolder, getIsDbtProject } from '$lib/stores/notebook.svelte.js';
	import {
		readAIMemory,
		removeAIMemoryEntry,
		writeAIConventions,
		type AIMemoryEntry
	} from '$lib/services/project-client.js';
	import type { WorkspaceNamingRule } from '$lib/types/ai-chat.js';

	const MATERIALIZE_OPTIONS = ['ephemeral', 'view', 'table', 'incremental'] as const;

	let {
		open = $bindable(false)
	}: {
		open?: boolean;
	} = $props();

	let standards = $derived(getWorkspaceStandards());
	let memoryEntries = $state<AIMemoryEntry[]>([]);
	let lastLoadedFolder: string | null = null;
	let conventionsSaveTimer: ReturnType<typeof setTimeout> | undefined;

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
			namingRules: [
				...standards.namingRules,
				{ prefix: '', description: '', materialization: 'ephemeral' }
			]
		});
		scheduleSave();
	}

	function removeRule(i: number) {
		const next = standards.namingRules.filter((_, idx) => idx !== i);
		setWorkspaceStandards({ ...standards, namingRules: next });
		scheduleSave();
	}

	function updateRule(i: number, field: keyof WorkspaceNamingRule, value: string) {
		const next = standards.namingRules.map((r, idx) => (idx === i ? { ...r, [field]: value } : r));
		setWorkspaceStandards({ ...standards, namingRules: next });
		scheduleSave();
	}

	function updateInstructions(value: string) {
		setWorkspaceStandards({ ...standards, customInstructions: value });
		scheduleSave();

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

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[80vh] max-w-md gap-0 overflow-y-auto p-0">
		<div class="flex flex-col gap-3 px-4 py-4">
			<div class="space-y-1">
				<h2 class="text-sm font-medium">Modeling Standards</h2>
				<p class="text-xs text-muted-foreground">
					Naming rules and custom instructions the AI follows when building models.
				</p>
			</div>

			<div class="flex items-center justify-end">
				<button
					class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					onclick={addRule}
				>
					<Plus size={11} />
					Add rule
				</button>
			</div>

			{#if standards.namingRules.length > 0}
				<div class="flex flex-col gap-1.5">
					{#each standards.namingRules as rule, i}
						<div class="flex items-center gap-1.5">
							<input
								class="w-20 shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
								placeholder="dim_"
								value={rule.prefix}
								oninput={(e) => updateRule(i, 'prefix', (e.target as HTMLInputElement).value)}
							/>
							<input
								class="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
								placeholder="description"
								value={rule.description}
								oninput={(e) => updateRule(i, 'description', (e.target as HTMLInputElement).value)}
							/>
							<select
								class="w-24 shrink-0 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground focus:border-primary focus:outline-none"
								value={rule.materialization}
								onchange={(e) =>
									updateRule(i, 'materialization', (e.target as HTMLSelectElement).value)}
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
				<p class="text-xs text-muted-foreground/60">
					No rules defined — conventions will be inferred from existing cell names.
				</p>
			{/if}

			<textarea
				class="min-h-[52px] w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
				placeholder="Custom instructions (e.g. always use UTC timestamps, surrogate keys for dimensions…)"
				value={standards.customInstructions}
				oninput={(e) => updateInstructions((e.target as HTMLTextAreaElement).value)}
				rows={2}
			></textarea>

			{#if memoryEntries.length > 0}
				<div class="flex flex-col gap-1">
					<span class="text-xs font-medium text-muted-foreground/70">
						Memory — decisions and discoveries recorded by the AI
					</span>
					{#each memoryEntries as entry (entry.slug)}
						<div class="flex items-start gap-1.5">
							<span
								class="mt-0.5 shrink-0 rounded px-1 py-0.5 text-xs font-medium {entry.type ===
								'discovery'
									? 'bg-warning/15 text-warning'
									: 'bg-primary/15 text-primary'}"
							>
								{entry.type}
							</span>
							<span class="min-w-0 flex-1 text-xs text-foreground/80">{entry.description}</span>
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
	</Dialog.Content>
</Dialog.Root>
