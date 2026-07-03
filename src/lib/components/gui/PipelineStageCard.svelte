<script lang="ts">
	import type { GUIPipelineStage, StageType } from '$lib/types/gui-pipeline';
	import type { PRQLStageError } from '$lib/services/gui-prql';
	import {
		X,
		Play,
		Loader2,
		GripVertical,
		ChevronDown,
		ChevronRight,
		AlertCircle,
		Eye,
		EyeOff
	} from '@lucide/svelte';
	import InlineResultView from '$lib/components/InlineResultView.svelte';
	import { slide } from 'svelte/transition';
	import { SECTION_LABEL } from './chip-styles';
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

	let {
		stage,
		index,
		active = false,
		children,
		draggable = true,
		isLast = false,
		collapsed = false,
		onCollapsedChange,
		onRemove,
		onToggleDisabled,
		onRun,
		onAddSort,
		onAddFilter,
		onAddSuggestedStage,
		onActivate,
		resultCollapsed = false,
		onResultCollapsedChange,
		stageErrors = []
	}: Props = $props();

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
		if (stage.type === 'group') return stage.aggregations.length + stage.by.length || undefined;
		if (stage.type === 'join') return stage.conditions.length || undefined;
		return undefined;
	});
	const nextStageRecommendations = $derived(getNextStageRecommendations(stage.type, preview));
</script>

<div
	class="stage-block group/card relative rounded-md transition-colors duration-(--motion-fast) outline-none hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset {active
		? 'bg-muted/40'
		: ''} {stage?.disabled ? 'opacity-60' : ''}"
	data-testid="stage-card"
	data-stage-index={index}
	data-stage-active={active ? 'true' : 'false'}
	data-stage-type={stage?.type}
	data-running={preview.kind === 'loading'}
	tabindex="0"
	role="button"
	aria-pressed={active}
	aria-label={`Stage ${index + 1}: ${meta.label}`}
	title={onRemove
		? 'Keyboard: j/k navigate · ⇧J/⇧K move · / add stage · r run · x remove · c collapse · v disable · ⇧D duplicate · Esc exit'
		: 'Keyboard: j/k navigate · / add stage · r run · c collapse · Esc exit'}
	onfocusin={onActivate}
	onclick={onActivate}
	onkeydown={(event) => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		onActivate?.();
	}}
>
	<div data-testid="stage-header" class="flex items-start gap-1 px-2 py-1">
		<!-- gutter: hover-revealed drag handle -->
		<div class="flex h-6 w-6 shrink-0 items-center justify-center">
			{#if draggable}
				<button
					data-drag-handle
					class="flex h-6 w-6 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity duration-(--motion-fast) group-hover/card:opacity-100 hover:bg-muted/60 hover:text-muted-foreground"
					aria-label="Drag to reorder"
					tabindex="-1"
				>
					<GripVertical class="h-3.5 w-3.5" />
				</button>
			{/if}
		</div>

		<!-- keyword: lowercase mono, click to collapse -->
		<button
			class="flex h-6 min-w-14 shrink-0 items-center gap-1.5 font-mono text-xs lowercase transition-colors duration-(--motion-fast) {hasErrors
				? 'text-destructive'
				: stage?.disabled
					? 'text-muted-foreground/50 line-through'
					: 'text-muted-foreground hover:text-foreground'}"
			onclick={(e) => {
				e.stopPropagation();
				onCollapsedChange?.(!collapsed);
			}}
			title={collapsed ? 'Expand stage' : 'Collapse stage'}
		>
			{meta.label}
			{#if hasErrors}
				<AlertCircle class="h-3 w-3" />
			{/if}
			{#if chipCount}
				<span class="text-2xs font-normal text-muted-foreground/40 tabular-nums">{chipCount}</span>
			{/if}
			{#if preview.kind === 'result'}
				<span class="rounded bg-muted/50 px-1 text-2xs text-muted-foreground/50 tabular-nums"
					>{preview.rows.length.toLocaleString()} rows</span
				>
			{/if}
		</button>

		<!-- chips / collapsed summary -->
		{#if collapsed}
			<div class="flex min-h-6 min-w-0 flex-1 items-center" transition:slide={{ duration: 150 }}>
				<span class="font-mono text-xs text-muted-foreground/60 italic"
					>{getStageSummary(stage)}</span
				>
			</div>
		{:else}
			<div
				class="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-1.5 py-0.5"
				class:err-chips={hasErrors && stage.type !== 'derive'}
				transition:slide={{ duration: 150 }}
			>
				{@render children()}
			</div>
		{/if}

		<!-- controls: run / disable / remove -->
		<div class="flex shrink-0 items-center gap-0.5">
			{#if onRun}
				<button
					class="flex h-6 w-6 items-center justify-center rounded transition-[opacity,color,background-color] duration-(--motion-fast) disabled:opacity-30
						{preview.kind === 'loading'
						? 'text-muted-foreground'
						: 'text-muted-foreground/60 opacity-0 group-hover/card:opacity-100 hover:bg-muted/60 hover:text-foreground'}"
					onclick={handleRun}
					disabled={preview.kind === 'loading'}
					aria-label="Run pipeline up to this stage"
				>
					{#if preview.kind === 'loading'}
						<Loader2 class="h-3.5 w-3.5 animate-spin" />
					{:else}
						<Play class="h-3.5 w-3.5 fill-current" />
					{/if}
				</button>
			{:else}
				<div class="h-6 w-6"></div>
			{/if}

			{#if onToggleDisabled}
				<button
					class="flex h-6 w-6 items-center justify-center rounded transition-[opacity,color,background-color] duration-(--motion-fast) {stage?.disabled
						? 'bg-muted/60 text-muted-foreground opacity-100!'
						: 'text-muted-foreground/60 opacity-0 group-hover/card:opacity-100 hover:bg-muted/60 hover:text-foreground'}"
					onclick={onToggleDisabled}
					aria-label={stage?.disabled ? 'Enable stage' : 'Disable stage'}
				>
					{#if stage?.disabled}
						<EyeOff class="h-3.5 w-3.5" />
					{:else}
						<Eye class="h-3.5 w-3.5" />
					{/if}
				</button>
			{:else}
				<div class="h-6 w-6"></div>
			{/if}

			{#if onRemove}
				<button
					class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 opacity-0 transition-[opacity,color,background-color] duration-(--motion-fast) group-hover/card:opacity-100 hover:bg-destructive/10 hover:text-destructive"
					onclick={onRemove}
					aria-label="Remove stage"
				>
					<X class="h-3.5 w-3.5" />
				</button>
			{/if}
		</div>
	</div>

	<!-- Compile errors from cell-level PRQL compilation -->
	{#if hasErrors}
		<div class="mx-2 mb-1 ml-9 space-y-0.5 border-l border-destructive py-0.5 pl-3">
			{#each presentedStageErrors as err, errIdx (`${err.reason}-${err.hint ?? ''}-${errIdx}`)}
				<p class="text-xs leading-snug text-destructive">
					{#if err.lineLabel}<span class="font-medium text-destructive/90"
							>[{err.lineLabel}]
						</span>{/if}<span class="font-mono">{err.reason}</span>{#if err.hint}<span
							class="text-destructive/80">: {err.hint}</span
						>{/if}
				</p>
			{/each}
		</div>
	{/if}

	<!-- Stage evidence panel (loading, error, or result) -->
	{#if hasEvidence}
		<div class="mx-2 mb-1.5 ml-9 border-l border-border pl-3" data-testid="stage-evidence-panel">
			<div class="flex items-center justify-between gap-2 py-0.5">
				<div class="flex min-w-0 items-center gap-2">
					<span class="{SECTION_LABEL} text-muted-foreground/70">evidence</span>
					<span class="truncate text-2xs text-muted-foreground/50">{evidenceSummary}</span>
				</div>
				{#if preview.kind !== 'loading'}
					<button
						class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 transition-colors duration-(--motion-fast) hover:bg-muted/60 hover:text-foreground"
						onclick={() => onResultCollapsedChange?.(!resultCollapsed)}
						aria-label={resultCollapsed ? 'Expand evidence panel' : 'Collapse evidence panel'}
					>
						{#if resultCollapsed}
							<ChevronRight class="h-3 w-3" />
						{:else}
							<ChevronDown class="h-3 w-3" />
						{/if}
					</button>
				{/if}
			</div>

			{#if preview.kind === 'loading'}
				<div class="inline-flex items-center gap-1.5 py-1 text-2xs text-muted-foreground">
					<Loader2 class="h-3 w-3 animate-spin" />
					running stage preview...
				</div>
			{:else if !resultCollapsed}
				{#if preview.kind === 'error'}
					<div class="py-1.5 font-mono text-xs text-destructive">{preview.message}</div>
				{:else if preview.kind === 'result'}
					{#if onAddSuggestedStage && nextStageRecommendations.length > 0}
						<div class="flex flex-wrap items-center gap-1.5 pt-1">
							<span class={SECTION_LABEL}>next</span>
							{#each nextStageRecommendations as suggestion (`${suggestion.type}-${suggestion.reason}`)}
								<button
									class="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-2xs text-muted-foreground transition-colors duration-(--motion-fast) hover:bg-muted/40 hover:text-foreground"
									onclick={() => onAddSuggestedStage?.(suggestion.stage)}
									title={suggestion.reason}
								>
									<span class="font-medium">+ {suggestion.type}</span>
									<span class="text-muted-foreground/60">{suggestion.reason}</span>
								</button>
							{/each}
						</div>
					{/if}

					<div class="py-2">
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
	.stage-block[data-running='true'] {
		background: color-mix(in oklab, var(--muted) 30%, transparent);
	}

	/* Tint value chips inside an errored stage (stage-chip marker from chip-styles.ts) */
	.err-chips :global(.stage-chip:not(.border-dashed)) {
		border-color: var(--destructive) !important;
		background-color: color-mix(in oklab, var(--destructive) 8%, transparent) !important;
		color: var(--destructive) !important;
	}
</style>
