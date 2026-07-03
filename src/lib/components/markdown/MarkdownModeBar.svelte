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
	<div
		class="markdown-mode-tabs"
		role="tablist"
		aria-label="Markdown editor mode"
	>
		<button
			type="button"
			class="markdown-mode-btn"
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
			class="markdown-mode-btn"
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
				class="markdown-mode-btn"
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
	.markdown-mode-tabs {
		display: inline-flex;
		align-items: center;
		gap: 0.75rem;
	}
	.markdown-mode-btn {
		position: relative;
		height: 1.25rem;
		padding: 0;
		border: none;
		background: transparent;
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--muted-foreground);
		cursor: pointer;
		transition:
			background-color var(--motion-fast) var(--motion-ease-out),
			color var(--motion-fast) var(--motion-ease-out);
	}
	.markdown-mode-btn:hover {
		color: var(--foreground);
	}
	.markdown-mode-btn.is-active {
		color: var(--foreground);
	}
	.markdown-mode-btn.is-active::after {
		position: absolute;
		right: 0;
		bottom: -0.18rem;
		left: 0;
		height: 2px;
		border-radius: 999px;
		background: var(--primary);
		content: '';
	}
	.markdown-mode-btn:focus-visible {
		outline: none;
		border-radius: var(--radius-sm);
		box-shadow: 0 0 0 2px color-mix(in oklab, var(--ring) 35%, transparent);
	}
</style>
