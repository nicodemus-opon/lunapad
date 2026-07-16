<script lang="ts">
	interface Props {
		mode: 'visual' | 'source';
		preview?: boolean;
		onModeChange: (mode: 'visual' | 'source') => void;
		onPreviewChange?: (preview: boolean) => void;
	}

	const { mode, preview = false, onModeChange, onPreviewChange }: Props = $props();
</script>

<div class="markdown-mode-bar" role="toolbar" aria-label="Markdown mode">
	<div class="notebook-tabs" role="tablist" aria-label="Markdown editor mode">
		<button
			type="button"
			class="notebook-tab"
			class:is-active={!preview && mode === 'visual'}
			role="tab"
			aria-selected={!preview && mode === 'visual'}
			title="Visual dashboard editor"
			onclick={() => onModeChange('visual')}
		>
			Visual
		</button>
		<button
			type="button"
			class="notebook-tab"
			class:is-active={!preview && mode === 'source'}
			role="tab"
			aria-selected={!preview && mode === 'source'}
			title="Markdoc source"
			onclick={() => onModeChange('source')}
		>
			Source
		</button>
		{#if onPreviewChange}
			<button
				type="button"
				class="notebook-tab"
				class:is-active={preview}
				role="tab"
				aria-selected={preview}
				title="Rendered preview"
				onclick={() => onPreviewChange(true)}
			>
				Preview
			</button>
		{/if}
	</div>
</div>

<style>
	.markdown-mode-bar {
		display: flex;
		align-items: center;
		margin: 0 0 0.45rem;
		color: var(--muted-foreground);
	}
</style>
