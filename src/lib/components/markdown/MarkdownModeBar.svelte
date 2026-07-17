<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs';

	interface Props {
		mode: 'visual' | 'source';
		preview?: boolean;
		onModeChange: (mode: 'visual' | 'source') => void;
		onPreviewChange?: (preview: boolean) => void;
	}

	const { mode, preview = false, onModeChange, onPreviewChange }: Props = $props();

	const activeTab = $derived(preview ? 'preview' : mode);

	function selectTab(value: string | undefined) {
		if (value === 'visual' || value === 'source') onModeChange(value);
		if (value === 'preview') onPreviewChange?.(true);
	}
</script>

<div class="markdown-mode-bar" role="toolbar" aria-label="Markdown mode">
	<Tabs.Root value={activeTab} onValueChange={selectTab}>
		<Tabs.List class="h-7">
			<Tabs.Trigger value="visual" title="Visual dashboard editor" class="h-6 px-2 text-xs">
				Visual
			</Tabs.Trigger>
			<Tabs.Trigger value="source" title="Markdoc source" class="h-6 px-2 text-xs">
				Source
			</Tabs.Trigger>
			{#if onPreviewChange}
				<Tabs.Trigger value="preview" title="Rendered preview" class="h-6 px-2 text-xs">
					Preview
				</Tabs.Trigger>
			{/if}
		</Tabs.List>
	</Tabs.Root>
</div>

<style>
	.markdown-mode-bar {
		display: flex;
		align-items: center;
		margin: 0 0 0.45rem;
		color: var(--muted-foreground);
	}
</style>
