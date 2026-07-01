<script lang="ts">
	import { Sparkles, X, Loader2 } from '@lucide/svelte';
	import {
		editCellWithAI,
		cancelActiveCellEdit,
		CellEditCancelledError,
		type InlineCellEditResult,
		type InlineCellEditColumn
	} from '$lib/services/inline-cell-ai';
	import { getLLMConfig } from '$lib/stores/notebook.svelte';
	import type Editor from '$lib/components/Editor.svelte';

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
		editorRef?: Editor;
		onApply: (code: string) => void;
		onCreateAlternative?: (alt: {
			cellType: 'query' | 'python';
			language?: 'sql' | 'prql';
			code: string;
		}) => void;
		onContinueInChat?: (instruction: string) => void;
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
		editorRef,
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
	let originalCode = $state<string | null>(null);

	function unescapeJsonString(raw: string): string {
		return raw
			.replace(/\\n/g, '\n')
			.replace(/\\t/g, '\t')
			.replace(/\\r/g, '\r')
			.replace(/\\\\/g, '\\')
			.replace(/\\"/g, '"');
	}

	function extractPartialCode(raw: string): string | null {
		const jsonStart = raw.indexOf('{');
		if (jsonStart >= 0) {
			const tail = raw.slice(jsonStart);
			try {
				const parsed = JSON.parse(tail) as { code?: string };
				if (typeof parsed.code === 'string') return parsed.code;
			} catch {
				// partial JSON while streaming
			}
		}
		const match = /"code"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw);
		if (!match) return null;
		return unescapeJsonString(match[1]);
	}

	function previewCode(next: string): void {
		if (editorRef) editorRef.setPreviewCode(next);
		else onApply(next);
	}

	function restorePreview(): void {
		if (originalCode !== null) previewCode(originalCode);
	}

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

	function finishClose(): void {
		cancelActiveCellEdit();
		editorRef?.setInlineEditActive(false);
		editorRef?.clearPreviewLock();
		open = false;
		instruction = '';
		generating = false;
		statusMessage = null;
		result = null;
		errorMessage = null;
		originalCode = null;
	}

	function close() {
		restorePreview();
		finishClose();
	}

	function discard() {
		if (originalCode !== null) {
			previewCode(originalCode);
			onApply(originalCode);
		}
		finishClose();
	}

	async function submit() {
		const value = instruction.trim();
		if (!value || generating) return;

		const llmConfig = getLLMConfig();
		if (!llmConfig.baseUrl?.trim() || !llmConfig.model?.trim()) {
			errorMessage = 'Configure an LLM in Settings → AI.';
			return;
		}

		generating = true;
		statusMessage = null;
		result = null;
		errorMessage = null;
		originalCode = code;
		editorRef?.setInlineEditActive(true);
		let accumulated = '';
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
					llmConfig
				},
				(msg) => {
					statusMessage = msg;
				},
				(chunk) => {
					accumulated += chunk;
					const partial = extractPartialCode(accumulated);
					if (partial !== null) previewCode(partial);
				}
			);
			if (res) {
				previewCode(res.code);
				result = res;
			} else {
				restorePreview();
				errorMessage = 'AI did not return a result.';
			}
		} catch (err) {
			restorePreview();
			if (err instanceof CellEditCancelledError) return;
			errorMessage = err instanceof Error ? err.message : 'AI cell edit failed.';
		} finally {
			editorRef?.setInlineEditActive(false);
			generating = false;
			statusMessage = null;
		}
	}

	function apply() {
		if (result) onApply(result.code);
		finishClose();
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
		finishClose();
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
				data-testid="inline-prompt-input"
				class="h-7 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
			/>
			{#if generating}
				<Loader2 class="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
			{/if}
			<button
				class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
				onclick={originalCode !== null ? discard : close}
				aria-label="Dismiss"
			>
				<X class="h-3.5 w-3.5" />
			</button>
		</div>

		{#if statusMessage}
			<p class="mt-1.5 px-0.5 text-2xs text-muted-foreground">{statusMessage}</p>
		{/if}

		{#if errorMessage}
			<p data-testid="inline-prompt-error" class="mt-1.5 px-0.5 text-2xs text-destructive">
				{errorMessage}
			</p>
		{/if}

		{#if result}
			<div class="mt-2 rounded-md border border-primary/20 bg-background/60 p-2">
				{#if result.reasoning}
					<p class="text-2xs text-muted-foreground">{result.reasoning}</p>
				{/if}
				{#if result.trialError}
					<p class="mt-1 text-2xs text-destructive">
						⚠ Still failed when tested: {result.trialError}
					</p>
				{/if}
				<div class="mt-2 flex items-center gap-2">
					<button
						data-testid="inline-prompt-accept"
						class="h-6 rounded border border-primary/30 px-2 text-2xs font-medium text-primary transition-colors hover:bg-primary/15"
						onclick={apply}
					>
						Accept
					</button>
					<button
						data-testid="inline-prompt-discard"
						class="h-6 rounded px-2 text-2xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
						onclick={discard}
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
