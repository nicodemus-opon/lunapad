<script lang="ts">
	import { marked } from 'marked';
	import { GripVertical, X, Info, AlertTriangle, AlertCircle, CheckCircle } from '@lucide/svelte';
	import type { CalloutBlock, DashboardPanelWidth } from '$lib/types/gui-pipeline';
	import { interpolate, type QueryResults } from '$lib/services/dashboard-interpolate';
	import WidthPicker from './WidthPicker.svelte';

	interface Props {
		block: CalloutBlock;
		results: QueryResults;
		onUpdate: (patch: Partial<Pick<CalloutBlock, 'markdown' | 'title' | 'variant'>>) => void;
		onRemove: () => void;
		onSetWidth: (w: DashboardPanelWidth) => void;
	}

	const { block, results, onUpdate, onRemove, onSetWidth }: Props = $props();

	type Variant = CalloutBlock['variant'];

	const VARIANT_CYCLE: Variant[] = ['info', 'warning', 'error', 'success'];

	const VARIANT_STYLES: Record<Variant, { border: string; bg: string; text: string; icon: typeof Info }> = {
		info:    { border: 'border-blue-500',   bg: 'bg-blue-50 dark:bg-blue-950/20',   text: 'text-blue-700 dark:text-blue-300',   icon: Info },
		warning: { border: 'border-yellow-500', bg: 'bg-yellow-50 dark:bg-yellow-950/20', text: 'text-yellow-700 dark:text-yellow-300', icon: AlertTriangle },
		error:   { border: 'border-red-500',    bg: 'bg-red-50 dark:bg-red-950/20',    text: 'text-red-700 dark:text-red-300',    icon: AlertCircle },
		success: { border: 'border-green-500',  bg: 'bg-green-50 dark:bg-green-950/20',  text: 'text-green-700 dark:text-green-300',  icon: CheckCircle }
	};

	let editing = $state(false);
	let draft = $state('');

	const styles = $derived(VARIANT_STYLES[block.variant]);
	const Icon = $derived(styles.icon);

	const rendered = $derived(() => {
		const interpolated = interpolate(block.markdown, results);
		return marked.parse(interpolated) as string;
	});

	function cycleVariant() {
		const idx = VARIANT_CYCLE.indexOf(block.variant);
		onUpdate({ variant: VARIANT_CYCLE[(idx + 1) % VARIANT_CYCLE.length] });
	}

	function startEdit() {
		draft = block.markdown;
		editing = true;
	}

	function commit() {
		if (draft !== block.markdown) onUpdate({ markdown: draft });
		editing = false;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') editing = false;
	}
</script>

<div class="group/block relative rounded-lg border-l-4 {styles.border} {styles.bg} overflow-hidden">
	<!-- Hover controls -->
	<div class="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
		<button
			class="text-[10px] px-1.5 h-5 rounded border border-border/60 text-muted-foreground hover:text-foreground transition-colors bg-background/90"
			onclick={cycleVariant}
			title="Cycle variant"
		>{block.variant}</button>
		<WidthPicker width={block.width} {onSetWidth} />
		<button
			class="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors bg-background/90"
			onclick={onRemove}
			title="Remove block"
		><X class="w-3 h-3" /></button>
	</div>

	<button class="drag-handle absolute left-1 top-1 cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover/block:opacity-100 transition-opacity z-10">
		<GripVertical class="w-3.5 h-3.5" />
	</button>

	{#if editing}
		<div class="p-3">
			<!-- svelte-ignore a11y_autofocus -->
			<textarea
				class="w-full min-h-16 rounded border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y"
				bind:value={draft}
				onblur={commit}
				onkeydown={onKey}
				placeholder="Callout text (markdown supported)…"
				autofocus
			></textarea>
			<div class="flex justify-end gap-2 mt-1">
				<button class="text-xs text-muted-foreground hover:text-foreground" onclick={() => (editing = false)}>Cancel</button>
				<button class="text-xs text-primary hover:text-primary/80" onclick={commit}>Done</button>
			</div>
		</div>
	{:else}
		<button
			class="w-full text-left pl-8 pr-4 py-3 min-h-10 cursor-text flex gap-2 items-start"
			onclick={startEdit}
			title="Click to edit"
		>
			<Icon class="w-4 h-4 shrink-0 mt-0.5 {styles.text}" />
			<div class="flex-1 min-w-0">
				{#if block.title}
					<p class="font-semibold text-sm {styles.text} mb-1">{block.title}</p>
				{/if}
				{#if block.markdown.trim()}
					<div class="prose prose-sm dark:prose-invert max-w-none {styles.text} **:text-inherit">
						{@html rendered()}
					</div>
				{:else}
					<span class="text-xs opacity-50">Click to add text…</span>
				{/if}
			</div>
		</button>
	{/if}
</div>
