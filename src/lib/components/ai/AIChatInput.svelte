<script lang="ts">
	import { Send, Square, X, ChevronDown } from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		getContextCellIds,
		removeContextCell,
		getIsGenerating,
		abortGeneration,
		getPendingSuggestion,
		clearPendingSuggestion
	} from '$lib/stores/ai-chat.svelte.js';
	import { getCells } from '$lib/stores/notebook.svelte.js';
	import { submitAIMessage } from '$lib/services/ai-chat-client.js';

	type ChatMode = 'auto' | 'build' | 'sprint' | 'fix' | 'dashboard' | 'explore';

	const SLASH_COMMANDS: Record<string, Exclude<ChatMode, 'auto'>> = {
		fix: 'fix',
		optimize: 'build',
		explain: 'explore',
		build: 'build',
		sprint: 'sprint',
		dashboard: 'dashboard'
	};

	const MODE_OPTIONS: { value: ChatMode; label: string; description?: string }[] = [
		{ value: 'auto', label: 'Auto' },
		{ value: 'build', label: 'Build', description: 'Create models and queries' },
		{ value: 'sprint', label: 'Sprint', description: 'Plan tasks before running' },
		{ value: 'fix', label: 'Fix', description: 'Debug errors in cells' },
		{ value: 'dashboard', label: 'Visualize', description: 'Build charts and dashboards' },
		{ value: 'explore', label: 'Explore', description: 'Analyze and explain data' }
	];

	function parseSlashCommand(value: string): {
		mode: Exclude<ChatMode, 'auto'> | null;
		rest: string;
	} {
		const match = value.match(/^\/(\w+)\s*/);
		if (!match) return { mode: null, rest: value };
		const mode = SLASH_COMMANDS[match[1].toLowerCase()];
		if (!mode) return { mode: null, rest: value };
		return { mode, rest: value.slice(match[0].length) };
	}

	let text = $state('');
	let selectedMode = $state<ChatMode>('auto');
	let isGenerating = $derived(getIsGenerating());
	let contextCellIds = $derived(getContextCellIds());
	let cells = $derived(getCells());
	let textareaEl: HTMLTextAreaElement | undefined = $state();

	let modeLabel = $derived(MODE_OPTIONS.find((m) => m.value === selectedMode)?.label ?? 'Auto');

	function contextPills() {
		return contextCellIds.map((id) => {
			const cell = cells.find((c) => c.id === id);
			return { id, name: cell?.outputName ?? id };
		});
	}

	async function submit() {
		const value = text.trim();
		if (!value || isGenerating) return;
		text = '';
		adjustHeight();
		const { mode: slashMode, rest } = parseSlashCommand(value);
		const effectiveMode = slashMode ?? (selectedMode === 'auto' ? undefined : selectedMode);
		const effectiveText = slashMode ? rest.trim() : value;
		await submitAIMessage(effectiveText || value, effectiveMode);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void submit();
		}
	}

	function adjustHeight() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 160)}px`;
	}

	function selectMode(mode: ChatMode) {
		selectedMode = mode;
	}

	$effect(() => {
		const suggestion = getPendingSuggestion();
		if (suggestion !== null) {
			text = suggestion;
			clearPendingSuggestion();
			Promise.resolve().then(() => {
				adjustHeight();
				textareaEl?.focus();
			});
		}
	});
</script>

<div class="ai-chat-input shrink-0 border-t border-border p-2.5">
	<div
		class="rounded-xl border border-border bg-muted/30 focus-within:border-primary focus-within:bg-background"
	>
		{#if contextCellIds.length > 0}
			<div class="flex flex-wrap gap-1 border-b border-border px-2.5 pt-2 pb-1.5">
				{#each contextPills() as pill}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/8 px-2 py-0.5 text-xs text-primary"
					>
						<span class="font-mono">{pill.name}</span>
						<button
							class="rounded-full hover:text-destructive"
							onclick={() => removeContextCell(pill.id)}
							aria-label="Remove context"
						>
							<X class="h-3 w-3" />
						</button>
					</span>
				{/each}
			</div>
		{/if}

		<textarea
			bind:this={textareaEl}
			bind:value={text}
			oninput={adjustHeight}
			onkeydown={onKeydown}
			rows={1}
			placeholder="Ask anything… (/build, /sprint, /fix)"
			disabled={isGenerating}
			class="w-full resize-none bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
			style="height: 36px; overflow-y: hidden;"
			data-testid="ai-input"
		></textarea>

		<div class="flex items-center justify-end gap-1 px-2 pb-2">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					disabled={isGenerating}
					class="flex h-7 items-center gap-0.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
					aria-label="AI mode"
				>
					{modeLabel}
					<ChevronDown class="h-3 w-3 opacity-50" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-48">
					{#each MODE_OPTIONS as opt}
						<DropdownMenu.Item
							onclick={() => selectMode(opt.value)}
							class="flex flex-col items-start gap-0.5"
						>
							<span class={selectedMode === opt.value ? 'font-medium text-foreground' : ''}
								>{opt.label}</span
							>
							{#if opt.description}
								<span class="text-xs text-muted-foreground">{opt.description}</span>
							{/if}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			{#if isGenerating}
				<button
					class="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
					onclick={abortGeneration}
					title="Stop generation"
					data-testid="ai-stop"
				>
					<Square class="h-3.5 w-3.5" />
				</button>
			{:else}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<button
								{...props}
								class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
								disabled={!text.trim()}
								onclick={submit}
								data-testid="ai-send"
							>
								<Send class="h-3.5 w-3.5" />
							</button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="top" class="text-xs"
						>Enter to send · Shift+Enter for new line</Tooltip.Content
					>
				</Tooltip.Root>
			{/if}
		</div>
	</div>
</div>
