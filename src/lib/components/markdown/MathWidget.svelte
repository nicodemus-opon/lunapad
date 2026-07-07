<script lang="ts">
	import katex from 'katex';

	interface Props {
		latex?: string;
		display?: boolean;
	}

	const { latex = '', display = false }: Props = $props();

	const html = $derived.by(() => {
		if (!latex.trim()) return '';
		try {
			return katex.renderToString(latex, { throwOnError: false, displayMode: Boolean(display) });
		} catch {
			return '';
		}
	});
</script>

{#if html}
	<span class="md-math" class:md-math--display={display}>{@html html}</span>
{:else}
	<span class="md-datatable-empty">Math: invalid or empty LaTeX</span>
{/if}

<style>
	.md-math {
		display: inline-block;
	}
	.md-math--display {
		display: block;
		margin: 0.5rem 0;
		overflow-x: auto;
		text-align: center;
	}
</style>
