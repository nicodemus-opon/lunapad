<script lang="ts">
	import { browser } from '$app/environment';
	import { tick } from 'svelte';
	import { X } from '@lucide/svelte';
	import BodyPortal from '$lib/components/ui/body-portal.svelte';
	import VisualBlockInspector from './VisualBlockInspector.svelte';
	import { nodeConfigTitle, type MarkdocSelectedNode } from './markdoc-node-selection';
	import type { VisualBlock } from '$lib/services/markdoc-ast';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';
	import type { FilterUsage } from '$lib/services/markdoc-visual-analysis';
	import {
		clampMenuPosition,
		editorNodeAnchorRect,
		type MenuPosition
	} from './menu-utils';

	interface Props {
		open: boolean;
		editor: import('@tiptap/core').Editor | null;
		selected: MarkdocSelectedNode | null;
		block: VisualBlock | null;
		refEntries?: MarkdownRefEntry[];
		filterUsages?: Record<string, FilterUsage[]>;
		onPatch: (patch: { attrs?: Record<string, unknown>; body?: string; source?: string }) => void;
		onClose: () => void;
	}

	const {
		open,
		editor,
		selected,
		block,
		refEntries = [],
		filterUsages = {},
		onPatch,
		onClose
	}: Props = $props();

	const title = $derived(nodeConfigTitle(selected));

	let panelPos = $state<MenuPosition | null>(null);
	let popoverEl = $state<HTMLDivElement | null>(null);

	function popoverSize(): { width: number; height: number } {
		if (popoverEl) {
			const rect = popoverEl.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				return { width: rect.width, height: rect.height };
			}
		}
		// Match CSS: w-[min(20rem,calc(100vw-2rem))], max-h-[min(70vh,28rem)]
		const vw = typeof window !== 'undefined' ? window.innerWidth : 320;
		const vh = typeof window !== 'undefined' ? window.innerHeight : 448;
		return {
			width: Math.min(320, vw - 32),
			height: Math.min(vh * 0.7, 448)
		};
	}

	async function refreshPanelPos() {
		if (!open || !editor || !selected) {
			panelPos = null;
			return;
		}
		const anchor = editorNodeAnchorRect(editor, selected.pos);
		if (!anchor) {
			panelPos = { top: 80, left: 80 };
			return;
		}
		panelPos = clampMenuPosition(anchor, popoverSize(), { placement: 'beside', gap: 12 });
		await tick();
		if (popoverEl) {
			panelPos = clampMenuPosition(anchor, popoverSize(), { placement: 'beside', gap: 12 });
		}
	}

	$effect(() => {
		open;
		editor;
		selected?.pos;
		refreshPanelPos();
	});

	$effect(() => {
		if (!browser || !open) return;
		const onLayout = () => refreshPanelPos();
		window.addEventListener('scroll', onLayout, true);
		window.addEventListener('resize', onLayout);
		return () => {
			window.removeEventListener('scroll', onLayout, true);
			window.removeEventListener('resize', onLayout);
		};
	});
</script>

{#if open && selected && panelPos}
	<BodyPortal>
		<button
			type="button"
			class="node-config-backdrop fixed inset-0 z-(--z-overlay) cursor-default bg-transparent"
			aria-label="Close properties"
			tabindex={-1}
			onclick={onClose}
		></button>
		<div
			bind:this={popoverEl}
			class="node-config-popover fixed z-(--z-dropdown) flex max-h-[min(70vh,28rem)] w-[min(20rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-xl shadow-black/10"
			style="top: {panelPos.top}px; left: {panelPos.left}px;"
			role="dialog"
			aria-label="{title} properties"
		>
			<header class="flex shrink-0 items-start justify-between gap-2 border-b border-border/80 px-3 py-2.5">
				<div class="min-w-0">
					<p class="truncate text-sm font-medium text-foreground">{title}</p>
					<p class="text-2xs text-muted-foreground">Block properties</p>
				</div>
				<button
					type="button"
					class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
					title="Close"
					aria-label="Close properties"
					onclick={onClose}
				>
					<X class="h-3.5 w-3.5" />
				</button>
			</header>
			<div class="node-config-scroll min-h-0 flex-1 overflow-y-auto px-1 py-2">
				<VisualBlockInspector {block} {refEntries} {filterUsages} {onPatch} variant="popover" />
			</div>
		</div>
	</BodyPortal>
{/if}
