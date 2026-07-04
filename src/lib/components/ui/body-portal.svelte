<script lang="ts">
	import { browser } from '$app/environment';
	import type { Snippet } from 'svelte';
	import { onDestroy, onMount } from 'svelte';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();

	let host = $state<HTMLDivElement | null>(null);

	onMount(() => {
		if (host) document.body.appendChild(host);
	});

	onDestroy(() => {
		host?.remove();
	});
</script>

{#if browser}
	<div bind:this={host}>
		{@render children()}
	</div>
{/if}
