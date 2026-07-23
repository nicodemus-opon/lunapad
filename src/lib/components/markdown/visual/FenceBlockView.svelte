<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
	import { Button } from '$lib/components/ui/button';
	import { Trash2 } from '@lucide/svelte';
	import MarkdownModeBar from '../MarkdownModeBar.svelte';
	import MermaidDiagram from '../MermaidDiagram.svelte';
	import { watchTheme } from '$lib/services/plotly-render.svelte';
	import { parseFenceSource, buildFenceSource, monacoLanguageForFenceLang } from './fence-source';
	import { isMermaidFenceSource, mermaidCodeFromFenceSource } from './mermaid-code';

	interface Props {
		source: string;
		selected?: boolean;
		onSourceChange: (source: string) => void;
		onSelect?: () => void;
		onDelete?: () => void;
	}

	const { source, selected = false, onSourceChange, onSelect, onDelete }: Props = $props();

	const parsed = $derived(parseFenceSource(source));
	const isMermaid = $derived(isMermaidFenceSource(source));
	const mermaidCode = $derived(mermaidCodeFromFenceSource(source));

	let mode = $state<'visual' | 'source'>('visual');
	$effect(() => {
		if (!isMermaid && mode !== 'source') mode = 'source';
	});

	let container: HTMLDivElement;
	let monacoRef: typeof Monaco | null = null;
	let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
	let model: Monaco.editor.ITextModel | null = null;
	let suppressUpdate = false;
	let destroyed = false;

	let isDark = $state(false);

	$effect(() => {
		void watchTheme();
		if (typeof document !== 'undefined') {
			isDark = document.documentElement.classList.contains('dark');
		}
	});
	$effect(() => {
		if (editor) editor.updateOptions({ theme: isDark ? 'lunapad-dark' : 'lunapad-light' });
	});

	// Monaco computes 0 size while its container is display:none (mermaid "visual"
	// mode) — force a relayout whenever the editor becomes visible again.
	$effect(() => {
		if (editor && (!isMermaid || mode === 'source')) editor.layout();
	});

	// Keep the Monaco model in sync when `source` changes for a reason other than
	// this editor's own keystrokes (undo, adoption of a different block, etc.).
	$effect(() => {
		const p = parsed;
		if (!editor || !model || !p || suppressUpdate) return;
		const current = model.getValue();
		if (current !== p.code) {
			suppressUpdate = true;
			model.pushEditOperations([], [{ range: model.getFullModelRange(), text: p.code }], () => null);
			suppressUpdate = false;
		}
		const langId = monacoLanguageForFenceLang(p.lang);
		if (monacoRef && model.getLanguageId() !== langId) {
			monacoRef.editor.setModelLanguage(model, langId);
		}
	});

	onMount(async () => {
		const mod = await import('$lib/monaco');
		if (destroyed) return;
		const m = mod.setupMonaco();
		monacoRef = m;

		const p = parsed ?? { fence: '```', lang: '', code: source };
		model = m.editor.createModel(
			p.code,
			monacoLanguageForFenceLang(p.lang),
			m.Uri.parse(`inmemory://fence/${crypto.randomUUID()}`)
		);

		isDark = document.documentElement.classList.contains('dark');

		const ed = m.editor.create(container, {
			model,
			theme: isDark ? 'lunapad-dark' : 'lunapad-light',
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			automaticLayout: true,
			wordWrap: 'on',
			folding: false,
			lineNumbers: 'on',
			lineNumbersMinChars: 3,
			glyphMargin: false,
			renderLineHighlight: 'none',
			scrollbar: {
				vertical: 'hidden',
				horizontal: 'hidden',
				alwaysConsumeMouseWheel: false
			},
			overviewRulerLanes: 0,
			hideCursorInOverviewRuler: true,
			overviewRulerBorder: false,
			fontSize: 13,
			fontFamily: 'var(--font-mono, ui-monospace, monospace)',
			contextmenu: true,
			fixedOverflowWidgets: true,
			tabSize: 2,
			padding: { top: 6, bottom: 6 },
			renderWhitespace: 'none'
		});

		editor = ed;

		ed.onDidChangeModelContent(() => {
			if (suppressUpdate || !model) return;
			const nextCode = model.getValue();
			const cur = parsed;
			suppressUpdate = true;
			onSourceChange(buildFenceSource(cur?.lang ?? '', nextCode, cur?.fence ?? '```'));
			suppressUpdate = false;
		});

		ed.onDidContentSizeChange(() => {
			container.style.height = `${Math.max(60, ed.getContentHeight())}px`;
		});
		container.style.height = `${Math.max(60, ed.getContentHeight())}px`;
	});

	onDestroy(() => {
		destroyed = true;
		model?.dispose();
		editor?.dispose();
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fence-block-node group/fbv relative rounded-sm border transition-colors duration-(--motion-fast) {selected
		? 'border-ring bg-muted/10'
		: 'border-transparent hover:border-border hover:bg-muted/15'}"
>
	<div
		class="fbv-chrome absolute top-1 right-1 z-10 flex gap-0.5 opacity-0 transition-opacity group-focus-within/fbv:opacity-100 group-hover/fbv:opacity-100 {selected
			? 'opacity-100'
			: ''}"
	>
		<Button
			type="button"
			variant="ghost"
			size="icon-xs"
			class="md-action md-action--danger"
			title="Delete block"
			onclick={(e) => {
				e.stopPropagation();
				onDelete?.();
			}}
		>
			<Trash2 class="h-3 w-3" />
		</Button>
	</div>
	<div class="px-1 py-0.5">
		{#if isMermaid}
			<MarkdownModeBar {mode} onModeChange={(m) => (mode = m)} />
		{/if}
		{#if isMermaid && mode === 'visual'}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				role="button"
				tabindex="0"
				onclick={() => onSelect?.()}
				onkeydown={(e) => {
					if (e.key !== 'Enter' && e.key !== ' ') return;
					e.preventDefault();
					onSelect?.();
				}}
			>
				<MermaidDiagram code={mermaidCode} />
			</div>
		{/if}
		<!-- Kept mounted (never re-parented by an {#if}) so Monaco's model/editor
		     survive toggling the mermaid visual/source tab — just hidden via CSS. -->
		<div
			bind:this={container}
			class="fbv-monaco"
			class:hidden={isMermaid && mode === 'visual'}
		></div>
	</div>
</div>

<style>
	.fence-block-node {
		margin: 0.35rem 0;
	}
	.fbv-monaco {
		width: 100%;
		min-height: 60px;
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.fbv-monaco.hidden {
		display: none;
	}
</style>
