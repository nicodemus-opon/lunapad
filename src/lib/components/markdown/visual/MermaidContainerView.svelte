<script lang="ts">
	import MarkdownModeBar from '../MarkdownModeBar.svelte';
	import MermaidDiagram from '../MermaidDiagram.svelte';

	interface Props {
		code: string;
		mode?: 'visual' | 'source';
		onModeChange?: (mode: 'visual' | 'source') => void;
	}

	const { code, mode = 'visual', onModeChange }: Props = $props();

	// Own the active mode as plain local state. The node view mounts this component
	// imperatively (mount()), where a `$bindable` prop does not reliably reflect
	// local reassignments — so we seed from `mode` once and drive the UI from here.
	let active = $state<'visual' | 'source'>('visual');

	$effect(() => {
		active = mode;
	});

	function setMode(next: 'visual' | 'source') {
		active = next;
		onModeChange?.(next);
	}
</script>

<div class="mermaid-container-view">
	<MarkdownModeBar mode={active} onModeChange={setMode} />
	{#if active === 'visual'}
		<div class="mermaid-container-preview">
			<MermaidDiagram {code} />
		</div>
	{/if}
</div>

<style>
	.mermaid-container-view {
		margin: 0.35rem 0 0.15rem;
	}
	.mermaid-container-preview {
		margin-top: 0.15rem;
	}
</style>
