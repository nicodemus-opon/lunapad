<script lang="ts">
	import { buildDiff } from '$lib/utils/code-diff.js';

	interface Props {
		oldCode: string;
		newCode: string;
		class?: string;
	}

	let { oldCode, newCode, class: className = '' }: Props = $props();
</script>

<div class="font-mono text-2xs overflow-x-auto {className}">
	{#each buildDiff(oldCode, newCode) as line}
		{#if line.kind === 'same'}
			<div class="px-2.5 py-px text-foreground/40 whitespace-pre">{line.line}</div>
		{:else if line.kind === 'removed'}
			<div class="bg-destructive/8 px-2.5 py-px text-destructive/70 whitespace-pre">- {line.line}</div>
		{:else}
			<div class="bg-success/8 px-2.5 py-px text-success/80 whitespace-pre">+ {line.line}</div>
		{/if}
	{/each}
</div>
