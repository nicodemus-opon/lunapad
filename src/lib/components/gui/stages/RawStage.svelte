<script lang="ts">
	import type { RawStage } from '$lib/types/gui-pipeline';

	interface Props {
		stage: RawStage;
	}

	let { stage }: Props = $props();
</script>

<pre
	class="py-0.5 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-muted-foreground">{stage.prql}</pre>
