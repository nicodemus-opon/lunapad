<script lang="ts">
	import { onMount } from 'svelte';
	import { watchTheme } from '$lib/services/plotly-render.svelte';
	import { normalizeMermaidCode } from '$lib/services/markdoc-interp';
	import { buildMermaidThemeVars, themeMermaidSvg } from '$lib/services/mermaid-theme';

	interface Props {
		code: string;
	}

	const { code }: Props = $props();

	let svgHtml = $state('');
	let error = $state<string | null>(null);
	let mermaidLoaded = $state(false);
	let mermaidInstance: (typeof import('mermaid'))['default'] | null = null;
	const uniqueId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
	let renderCount = 0;

	function isDarkMode(): boolean {
		return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
	}

	async function render(src: string) {
		const normalized = normalizeMermaidCode(src);
		if (!mermaidInstance || !normalized.trim()) {
			svgHtml = '';
			return;
		}
		const id = `mermaid-${uniqueId}-${renderCount++}`;
		try {
			error = null;
			mermaidInstance.initialize({
				startOnLoad: false,
				theme: 'base',
				securityLevel: 'strict',
				// Stop Mermaid from injecting its full-page "bomb" error diagram into
				// the DOM — that SVG, combined with our width:100% rule, blows up and
				// breaks the surrounding UI. We render our own compact error instead.
				suppressErrorRendering: true,
				themeVariables: buildMermaidThemeVars(isDarkMode())
			});
			const parsed = await mermaidInstance.parse(normalized.trim(), {
				suppressErrors: true
			});
			if (!parsed) {
				error = 'Invalid diagram syntax';
				svgHtml = '';
				return;
			}
			const { svg } = await mermaidInstance.render(id, normalized.trim());
			// Defensive: if an error graphic slips through, treat it as a failure
			// rather than rendering the oversized bomb SVG. Mermaid embeds a
			// `.error-icon{...}` CSS rule in *every* SVG, so match the error
			// diagram's aria role or an actual `class="error-icon"` element —
			// never the bare substring, which is always present.
			if (
				svg.includes('aria-roledescription="error"') ||
				/class="[^"]*\berror-icon\b/.test(svg)
			) {
				error = 'Invalid diagram syntax';
				svgHtml = '';
				return;
			}
			svgHtml = themeMermaidSvg(svg);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			svgHtml = '';
		} finally {
			// Mermaid can leave an orphaned render container (esp. on error) that
			// carries the bomb SVG; remove any stray node it created for this id.
			document.getElementById(id)?.remove();
			document.getElementById(`d${id}`)?.remove();
		}
	}

	onMount(async () => {
		const mod = await import('mermaid');
		mermaidInstance = mod.default;
		mermaidLoaded = true;
	});

	$effect(() => {
		void watchTheme();
		const src = code;
		if (!mermaidLoaded) return;
		void render(src);
	});
</script>

{#if error}
	<div class="mermaid-error">{error}</div>
{:else}
	<div class="mermaid-wrap">{@html svgHtml}</div>
{/if}

<style>
	.mermaid-wrap {
		display: block;
		overflow: auto;
		margin: 0.5rem 0;
	}
	.mermaid-wrap :global(svg) {
		width: 100%;
		height: auto;
		max-width: 100%;
		max-height: 70vh;
	}
	.mermaid-error {
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius);
		border: 1px solid;
		font-size: 0.75rem;
		font-family: var(--font-mono, ui-monospace, monospace);
		background: color-mix(in oklch, var(--destructive, #dc2626) 8%, transparent);
		border-color: color-mix(in oklch, var(--destructive, #dc2626) 25%, transparent);
		color: var(--destructive, #dc2626);
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
