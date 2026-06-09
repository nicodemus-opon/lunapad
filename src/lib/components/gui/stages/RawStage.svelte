<script lang="ts">
	import type { RawStage } from '$lib/types/gui-pipeline';

	interface Props {
		stage: RawStage;
	}

	let { stage }: Props = $props();
</script>

<pre class="text-xs text-muted-foreground font-mono whitespace-pre-wrap break-all leading-relaxed py-0.5">{stage.prql}</pre>
