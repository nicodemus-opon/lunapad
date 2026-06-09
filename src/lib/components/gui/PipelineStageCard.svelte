<script lang="ts">
	import type { GUIPipelineStage, StageType } from '$lib/types/gui-pipeline';
	import type { PRQLStageError } from '$lib/services/gui-prql';
	import { Button } from '$lib/components/ui/button';
	import { X, Play, Loader2, GripVertical, ChevronDown, ChevronRight, AlertCircle, Eye, EyeOff } from '@lucide/svelte';
	import InlineResultView from '$lib/components/InlineResultView.svelte';
	import { slide } from 'svelte/transition';
	import {
		getNextStageRecommendations,
		getStageEvidenceSummary,
		getStageSummary,
		presentStageErrors
	} from './stage-card-utils';

	interface StagePreviewResult {
		rows: Record<string, unknown>[];
		columns: string[];
	}

	interface Props {
		stage: GUIPipelineStage;
		index: number;
		active?: boolean;
		children: import('svelte').Snippet;
		draggable?: boolean;
		/** 'strip' = single horizontal row (default); 'card' = header + expanded body */
		variant?: 'strip' | 'card';
		isLast?: boolean;
		collapsed?: boolean;
		onCollapsedChange?: (collapsed: boolean) => void;
		onRemove?: () => void;
		onToggleDisabled?: () => void;
		onRun?: () => Promise<StagePreviewResult | { error: string }>;
		onAddSort?: (column: string, dir: 'asc' | 'desc') => void;
		onAddFilter?: (column: string) => void;
		onAddSuggestedStage?: (stage: Exclude<GUIPipelineStage, { type: 'raw' }>) => void;
		onActivate?: () => void;
		resultCollapsed?: boolean;
		onResultCollapsedChange?: (collapsed: boolean) => void;
		stageErrors?: PRQLStageError[];
	}

	let { stage, index, active = false, children, draggable = true, variant = 'strip', isLast = false, collapsed = false, onCollapsedChange, onRemove, onToggleDisabled, onRun, onAddSort, onAddFilter, onAddSuggestedStage, onActivate, resultCollapsed = false, onResultCollapsedChange, stageErrors = [] }: Props = $props();

	const hasErrors = $derived(stageErrors.length > 0);
	const presentedStageErrors = $derived(presentStageErrors(stage, stageErrors));

	type PreviewState =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'result'; rows: Record<string, unknown>[]; columns: string[] }
		| { kind: 'error'; message: string };

	let preview = $state<PreviewState>({ kind: 'idle' });
	const hasEvidence = $derived(preview.kind !== 'idle');

	async function handleRun() {
		if (!onRun) return;
		preview = { kind: 'loading' };
		const result = await onRun();
		if ('error' in result) {
			preview = { kind: 'error', message: result.error };
		} else {
			preview = { kind: 'result', rows: result.rows, columns: result.columns };
		}
	}

	const STAGE_META: Record<StageType, { label: string }> = {
		append: { label: 'append' },
		from: { label: 'from' },
		filter: { label: 'filter' },
		select: { label: 'select' },
		derive: { label: 'derive' },
		group: { label: 'group' },
		window: { label: 'window' },
		loop: { label: 'loop' },
		sort: { label: 'sort' },
		take: { label: 'take' },
		join: { label: 'join' },
		raw: { label: 'prql' }
	};

	const meta = $derived(stage ? (STAGE_META[stage.type] ?? { label: stage.type }) : { label: '' });
	const evidenceSummary = $derived(getStageEvidenceSummary(preview));

	const chipCount = $derived.by(() => {
		if (!stage) return undefined;
		if (stage.type === 'select') return stage.columns.length || undefined;
		if (stage.type === 'filter') return stage.conditions.length || undefined;
		if (stage.type === 'derive') return stage.columns.length || undefined;
		if (stage.type === 'sort') return stage.keys.length || undefined;
		if (stage.type === 'group') return (stage.aggregations.length + stage.by.length) || undefined;
		if (stage.type === 'join') return stage.conditions.length || undefined;
		return undefined;
	});
	const nextStageRecommendations = $derived(getNextStageRecommendations(stage.type, preview));
</script>

<div
	class="stage-card group/card border rounded {hasErrors ? 'ring-1 ring-inset ring-destructive/55' : ''} {stage?.disabled ? 'opacity-60' : ''} {active ? 'stage-card-active' : ''}"
	data-testid="stage-card"
	data-stage-index={index}
	data-stage-active={active ? 'true' : 'false'}
	data-stage-type={stage?.type}
	data-running={preview.kind === 'loading'}
	tabindex="0"
	role="button"
	aria-pressed={active}
	aria-label={`Stage ${index + 1}: ${meta.label}`}
	title={onRemove ? "Keyboard: j/k navigate · ⇧J/⇧K move · / add stage · r run · x remove · c collapse · v disable · ⇧D duplicate · Esc exit" : "Keyboard: j/k navigate · / add stage · r run · c collapse · Esc exit"}
	onfocusin={onActivate}
	onclick={onActivate}
	onkeydown={(event) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		onActivate?.();
	}}
>
	{#if variant === 'strip'}
		<div data-testid="stage-header">
			<div class="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
				{#if draggable}
					<button
						data-drag-handle
						class="cursor-grab opacity-20 group-hover/card:opacity-60 text-muted-foreground/60 hover:text-muted-foreground transition-[opacity,color,transform] duration-200 ease-(--motion-ease-out) hover:-translate-y-px touch-none shrink-0"
						aria-label="Drag to reorder"
						tabindex="-1"
					>
						<GripVertical class="w-3.5 h-3.5" />
					</button>
				{:else}
					<div class="w-3.5 shrink-0"></div>
				{/if}

				<button
					class="text-[10px] font-semibold shrink-0 uppercase tracking-[0.24em] flex items-center gap-1.5 transition-colors {hasErrors ? 'text-destructive' : stage?.disabled ? 'text-muted-foreground/50 line-through' : 'text-muted-foreground hover:text-foreground'}"
					onclick={(e) => { e.stopPropagation(); onCollapsedChange?.(!collapsed); }}
					title={collapsed ? 'Expand stage' : 'Collapse stage'}
				>
					{meta.label}
					{#if hasErrors}
						<AlertCircle class="w-3 h-3" />
					{/if}
					{#if chipCount}
						<span class="text-[9px] tabular-nums font-normal normal-case tracking-normal text-muted-foreground/50 leading-none">({chipCount})</span>
					{/if}
					{#if preview.kind === 'result'}
						<span class="text-[9px] tabular-nums font-normal normal-case tracking-normal text-muted-foreground/50 rounded px-1 bg-muted/50 leading-none">{preview.rows.length.toLocaleString()} rows</span>
					{/if}
				</button>

				<div class="flex-1"></div>

				<div class="flex items-center justify-end gap-0.5 min-w-0">
					{#if onRun}
						<button
							class="h-6 w-6 inline-flex items-center justify-center rounded-full transition-[opacity,color,transform,background-color] duration-200 ease-(--motion-ease-out) shrink-0 disabled:opacity-30 disabled:translate-y-0
								{preview.kind === 'loading'
								? 'text-muted-foreground'
								: 'opacity-0 translate-y-0.5 group-hover/card:opacity-100 group-hover/card:translate-y-0 text-muted-foreground/50 hover:text-foreground hover:bg-accent/60'}"
							onclick={handleRun}
							disabled={preview.kind === 'loading'}
							aria-label="Run pipeline up to this stage"
						>
							{#if preview.kind === 'loading'}
								<Loader2 class="w-3.5 h-3.5 animate-spin" />
							{:else}
								<Play class="w-3.5 h-3.5 fill-current" />
							{/if}
						</button>
					{:else}
						<div class="h-6 w-6"></div>
					{/if}

					{#if onToggleDisabled}
						<button
							class="h-6 w-6 inline-flex items-center justify-center rounded-full shrink-0 transition-[opacity,color,transform,background-color] duration-200 ease-(--motion-ease-out) opacity-0 translate-y-0.5 group-hover/card:opacity-100 group-hover/card:translate-y-0 {stage?.disabled ? 'text-muted-foreground opacity-100! translate-y-0! bg-accent/50' : 'text-muted-foreground/50 hover:text-foreground hover:bg-accent/50'}"
							onclick={onToggleDisabled}
							aria-label={stage?.disabled ? 'Enable stage' : 'Disable stage'}
						>
							{#if stage?.disabled}
								<EyeOff class="w-3.5 h-3.5" />
							{:else}
								<Eye class="w-3.5 h-3.5" />
							{/if}
						</button>
					{:else}
						<div class="h-6 w-6"></div>
					{/if}

					{#if onRemove}
					<Button
						variant="ghost"
						size="sm"
						class="h-6 w-6 rounded-full p-0 transition-[opacity,color,transform,background-color] duration-200 ease-(--motion-ease-out) opacity-0 translate-y-0.5 group-hover/card:opacity-100 group-hover/card:translate-y-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
						onclick={onRemove}
						aria-label="Remove stage"
					>
						<X class="w-3.5 h-3.5" />
					</Button>
					{/if}
				</div>
			</div>

			{#if collapsed}
				<div class="flex items-center px-3.5 pb-2.5 pl-9" transition:slide={{ duration: 150 }}>
					<span class="text-xs text-muted-foreground/60 italic font-mono">{getStageSummary(stage)}</span>
				</div>
			{:else}
				<div class="flex items-center gap-1.5 flex-wrap min-w-0 px-3.5 pb-3 pl-9" class:err-chips={hasErrors && stage.type !== 'derive'} transition:slide={{ duration: 150 }}>
					{@render children()}
				</div>
			{/if}
		</div>
	{:else}
		<!-- ── Card layout: header + expanded body (DeriveStage) ──────── -->
		<div
			class="flex items-center gap-2 px-3.5 py-3 bg-muted/30 select-none border-b border-border/60"
			data-testid="stage-header"
		>
			{#if draggable}
				<button
					data-drag-handle
					class="cursor-grab opacity-20 group-hover/card:opacity-60 text-muted-foreground/60 hover:text-muted-foreground transition-all touch-none"
					aria-label="Drag to reorder"
					tabindex="-1"
				>
					<GripVertical class="w-3.5 h-3.5" />
				</button>
			{:else}
				<div class="w-3.5"></div>
			{/if}

			<span class="flex-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground/90">
				{meta.label}
			</span>

			{#if onRun}
				<button
					class="flex items-center gap-1 rounded-full px-2.5 py-1 transition-[opacity,color,transform,background-color] duration-200 ease-(--motion-ease-out) disabled:opacity-30 disabled:translate-y-0
						{preview.kind === 'loading'
						? 'text-muted-foreground'
							: 'opacity-0 translate-y-0.5 group-hover/card:opacity-100 group-hover/card:translate-y-0 text-muted-foreground/50 hover:text-foreground hover:bg-accent/50'}"
					onclick={handleRun}
					disabled={preview.kind === 'loading'}
					aria-label="Run pipeline up to this stage"
				>
					{#if preview.kind === 'loading'}
						<Loader2 class="w-3.5 h-3.5 animate-spin" />
					{:else}
						<Play class="w-3.5 h-3.5 fill-current" />
					{/if}
				</button>
			{/if}

			{#if onRemove}
			<Button
				variant="ghost"
				size="sm"
				class="h-6 w-6 rounded-full p-0 transition-[opacity,color,transform,background-color] duration-200 ease-(--motion-ease-out) opacity-0 translate-y-0.5 group-hover/card:opacity-100 group-hover/card:translate-y-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
				onclick={onRemove}
				aria-label="Remove stage"
			>
				<X class="w-3.5 h-3.5" />
			</Button>
			{/if}
		</div>

		<div class="px-3.5 py-3.5">
			{@render children()}
		</div>
	{/if}

	<!-- Compile errors from cell-level PRQL compilation -->
	{#if hasErrors}
		<div class="border-t border-destructive/20 bg-destructive/5 px-3.5 py-2 space-y-0.5">
			{#each presentedStageErrors as err, errIdx (`${err.reason}-${err.hint ?? ''}-${errIdx}`)}
			<p class="text-xs text-destructive leading-snug">
				{#if err.lineLabel}<span class="font-medium text-destructive/90">[{err.lineLabel}] </span>{/if}<span class="font-mono">{err.reason}</span>{#if err.hint}<span class="text-destructive/80">: {err.hint}</span>{/if}
			</p>
			{/each}
		</div>
	{/if}

	<!-- Stage evidence panel (loading, error, or result) -->
	{#if hasEvidence}
		<div class="border-t border-border/60 bg-muted/15" data-testid="stage-evidence-panel">
			<div class="flex items-center justify-between gap-3 px-3.5 py-1.5">
				<div class="flex items-center gap-1.5 min-w-0">
					<span class="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">evidence</span>
					<span class="text-[10px] text-muted-foreground/80 uppercase tracking-wide font-medium truncate">{evidenceSummary}</span>
				</div>
				{#if preview.kind !== 'loading'}
					<button
						class="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
						onclick={() => onResultCollapsedChange?.(!resultCollapsed)}
						aria-label={resultCollapsed ? 'Expand evidence panel' : 'Collapse evidence panel'}
					>
						{#if resultCollapsed}
							<ChevronRight class="w-3 h-3" />
						{:else}
							<ChevronDown class="w-3 h-3" />
						{/if}
					</button>
				{/if}
			</div>

			{#if preview.kind === 'loading'}
				<div class="px-3.5 py-2.5 text-xs text-muted-foreground inline-flex items-center gap-1.5">
					<Loader2 class="w-3 h-3 animate-spin" />
					running stage preview...
				</div>
			{:else if !resultCollapsed}
				{#if preview.kind === 'error'}
					<div class="px-3.5 py-2.5 text-xs text-destructive font-mono">{preview.message}</div>
				{:else if preview.kind === 'result'}
					{#if onAddSuggestedStage && nextStageRecommendations.length > 0}
						<div class="px-3 pt-2 flex flex-wrap items-center gap-1.5">
							<span class="text-[10px] uppercase tracking-wide text-muted-foreground/75">next</span>
							{#each nextStageRecommendations as suggestion (`${suggestion.type}-${suggestion.reason}`)}
								<button
									class="inline-flex items-center gap-1 rounded-full border border-border bg-background/75 px-2 py-0.5 text-[10px] text-foreground hover:bg-accent/50 transition-colors"
									onclick={() => onAddSuggestedStage?.(suggestion.stage)}
									title={suggestion.reason}
								>
									<span class="font-medium">+ {suggestion.type}</span>
									<span class="text-muted-foreground">{suggestion.reason}</span>
								</button>
							{/each}
						</div>
					{/if}

					<div class="px-3 py-3">
						<InlineResultView
							rows={preview.rows}
							columns={preview.columns}
							name={`stage-${index}`}
							compact
							{onAddSort}
							{onAddFilter}
						/>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.stage-card {
		position: relative;
		isolation: isolate;
		
		box-shadow:
			0 1px 0 0 hsl(var(--border) / 0.55),
			0 10px 26px hsl(var(--foreground) / 0.04);
		transition:
			border-color var(--motion-fast) var(--motion-ease-out),
			box-shadow var(--motion-medium) var(--motion-ease-out);
	}

	.stage-card:hover {
		/* No transform here — CSS transforms create a containing block for position:fixed
		   children (autocomplete dropdowns), breaking their viewport-relative positioning. */
		box-shadow:
			0 1px 0 0 hsl(var(--border) / 0.65),
			0 16px 34px hsl(var(--foreground) / 0.07),
			0 0 0 1px hsl(var(--border) / 0.12);
	}

	.stage-card:focus-visible,
	.stage-card-active {
		outline: none;
		border-color: var(--foreground);
		
		box-shadow:
			0 0 0 2px hsl(var(--primary) / 0.2),
			0 1px 0 0 hsl(var(--border) / 0.55),
			0 14px 30px hsl(var(--foreground) / 0.06);
	}

	.stage-card[data-running='true'] {
		border-color: hsl(var(--primary) / 0.45);
		box-shadow: 0 0 0 1px hsl(var(--primary) / 0.35);
		animation: gui-soft-pulse 1.6s var(--motion-ease-flow) infinite;
	}

	.stage-card::before {
		content: '';
		position: absolute;
		inset: 0 auto auto 0;
		height: 1px;
		width: 100%;
		border-radius: inherit;
		background: linear-gradient(90deg, transparent, hsl(var(--primary) / 0.22), transparent);
		pointer-events: none;
	}

	.stage-card[data-running='true']::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: linear-gradient(105deg, transparent 38%, var(--gui-flow-glow) 50%, transparent 62%);
		animation: gui-flow-shimmer 1.15s var(--motion-ease-flow) infinite;
	}

	/* Tint all solid chips (rounded-full, non-dashed) inside an errored stage */
	.err-chips :global(.rounded-full:not(.border-dashed)) {
		border-color: hsl(var(--destructive) / 0.4) !important;
		background-color: hsl(var(--destructive) / 0.08) !important;
		color: hsl(var(--destructive)) !important;
	}
</style>
