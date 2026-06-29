<script lang="ts">
	import { Sparkles, X, Loader2 } from '@lucide/svelte';
	import {
		editCellWithAI,
		cancelActiveCellEdit,
		type InlineCellEditResult,
		type InlineCellEditColumn
	} from '$lib/services/inline-cell-ai';
	import { getLLMConfig } from '$lib/stores/notebook.svelte';

	interface Props {
		open?: boolean;
		cellId: string;
		cellType: 'query' | 'python';
		language?: 'prql' | 'sql';
		code: string;
		outputName?: string;
		pythonAvailable: boolean;
		sourceTable?: string;
		columns?: InlineCellEditColumn[];
		otherTables?: Array<{ name: string; columns: string[]; columnTypes: string[] }>;
		onApply: (code: string) => void;
		onCreateAlternative?: (alt: {
			cellType: 'query' | 'python';
			language?: 'sql' | 'prql';
			code: string;
		}) => void;
		onContinueInChat?: (instruction: string) => void;
		/** Set (alongside open=true) to pre-fill and immediately submit — e.g. "Fix with AI"
		 *  from the error popover skipping the extra click of typing the same instruction.
		 *  Caller should clear this (via onAutoSubmitConsumed) so a later manual open doesn't
		 *  silently replay a stale instruction. */
		autoSubmitInstruction?: string | null;
		onAutoSubmitConsumed?: () => void;
	}

	let {
		open = $bindable(false),
		cellId,
		cellType,
		language,
		code,
		outputName,
		pythonAvailable,
		sourceTable,
		columns = [],
		otherTables = [],
		onApply,
		onCreateAlternative,
		onContinueInChat,
		autoSubmitInstruction = null,
		onAutoSubmitConsumed
	}: Props = $props();

	let instruction = $state('');
	let inputEl: HTMLInputElement | undefined = $state();
	let generating = $state(false);
	let statusMessage = $state<string | null>(null);
	let result = $state<InlineCellEditResult | null>(null);
	let errorMessage = $state<string | null>(null);

	$effect(() => {
		if (!open) return;
		if (autoSubmitInstruction) {
			instruction = autoSubmitInstruction;
			onAutoSubmitConsumed?.();
			void submit();
			return;
		}
		queueMicrotask(() => inputEl?.focus());
	});

	function close() {
		cancelActiveCellEdit();
		open = false;
		instruction = '';
		generating = false;
		statusMessage = null;
		result = null;
		errorMessage = null;
	}

	async function submit() {
		const value = instruction.trim();
		if (!value || generating) return;
		generating = true;
		statusMessage = null;
		result = null;
		errorMessage = null;
		try {
			const res = await editCellWithAI(
				{
					instruction: value,
					cellType,
					language,
					existingCode: code,
					cellId,
					sourceTable,
					columns: columns.length > 0 ? columns : undefined,
					otherTables: otherTables.length > 0 ? otherTables : undefined,
					llmConfig: getLLMConfig()
				},
				(msg) => {
					statusMessage = msg;
				}
			);
			result = res;
			if (!res) errorMessage = 'AI did not return a result.';
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'AI cell edit failed.';
		} finally {
			generating = false;
			statusMessage = null;
		}
	}

	function apply() {
		if (!result) return;
		onApply(result.code);
		close();
	}

	function createAlternative() {
		if (!result?.suggestedAlternative) return;
		onCreateAlternative?.({
			cellType: result.suggestedAlternative.cellType,
			language: result.suggestedAlternative.language,
			code: result.code
		});
	}

	function continueInChat() {
		const value = instruction.trim();
		close();
		onContinueInChat?.(
			value
				? `For cell \`${outputName ?? cellId}\`: ${value}`
				: `Help me with cell \`${outputName ?? cellId}\``
		);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			close();
		} else if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void submit();
		}
	}
</script>

{#if open}
	<div class="mb-1.5 rounded-lg border border-primary/30 bg-primary/5 p-2">
		<div class="flex items-center gap-1.5">
			<Sparkles class="h-3.5 w-3.5 shrink-0 text-primary" />
			<input
				bind:this={inputEl}
				bind:value={instruction}
				disabled={generating}
				onkeydown={onKeydown}
				placeholder="Tell AI what to do with this cell…"
				class="h-7 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
			/>
			{#if generating}
				<Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
			{/if}
			<button
				class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
				onclick={close}
				aria-label="Dismiss"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>

		{#if statusMessage}
			<p class="mt-1.5 px-0.5 text-2xs text-muted-foreground">{statusMessage}</p>
		{/if}

		{#if errorMessage}
			<p class="mt-1.5 px-0.5 text-2xs text-destructive">{errorMessage}</p>
		{/if}

		{#if result}
			<div class="mt-2 rounded-md border border-primary/20 bg-background/60 p-2">
				<pre
					class="max-h-48 overflow-auto font-mono text-2xs leading-relaxed whitespace-pre text-foreground">{result.code}</pre>
				{#if result.reasoning}
					<p class="mt-1.5 text-2xs text-muted-foreground">{result.reasoning}</p>
				{/if}
				{#if result.trialError}
					<p class="mt-1.5 text-2xs text-destructive">
						⚠ Still failed when tested: {result.trialError}
					</p>
				{/if}
				<div class="mt-2 flex items-center gap-2">
					<button
						class="h-6 rounded border border-primary/30 px-2 text-2xs font-medium text-primary transition-colors hover:bg-primary/15"
						onclick={apply}
					>
						Apply
					</button>
					<button
						class="h-6 rounded px-2 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
						onclick={close}
					>
						Discard
					</button>
					{#if onContinueInChat}
						<button
							class="ml-auto h-6 rounded px-2 text-2xs text-muted-foreground transition-colors hover:text-foreground"
							onclick={continueInChat}
						>
							Continue in AI chat →
						</button>
					{/if}
				</div>
				{#if result.suggestedAlternative && (result.suggestedAlternative.cellType !== 'python' || pythonAvailable)}
					<div
						class="mt-2 flex items-center gap-1.5 border-t border-primary/15 pt-1.5 text-2xs text-muted-foreground"
					>
						<Sparkles class="h-3 w-3 shrink-0 text-primary/70" />
						<span class="min-w-0 flex-1 truncate">
							This might work better as a {result.suggestedAlternative.cellType === 'python'
								? 'Python'
								: 'SQL'} cell — {result.suggestedAlternative.reason}
						</span>
						{#if onCreateAlternative}
							<button
								class="shrink-0 rounded px-1.5 py-0.5 font-medium text-primary transition-colors hover:bg-primary/15"
								onclick={createAlternative}
							>
								Create it
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
