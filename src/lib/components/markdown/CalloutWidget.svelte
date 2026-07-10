<script lang="ts">
	import { Info, CheckCircle2, TriangleAlert, CircleX } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { resolveDashboardIcon } from './icon-map';

	interface Props {
		type?: 'info' | 'success' | 'warning' | 'error';
		title?: string;
		/** Allowlisted lucide icon name — overrides the type's default icon. */
		icon?: string;
		children?: Snippet;
	}

	const { type = 'info', title, icon, children }: Props = $props();

	const icons = { info: Info, success: CheckCircle2, warning: TriangleAlert, error: CircleX };
	const Icon = $derived(resolveDashboardIcon(icon) ?? icons[type] ?? Info);
</script>

<div class="md-callout md-callout--{type}">
	<Icon class="md-callout-icon" size={16} />
	<div class="md-callout-body">
		{#if title}<p class="md-callout-title-text">{title}</p>{/if}
		<div class="md-callout-content">
			{@render children?.()}
		</div>
	</div>
</div>

<style>
	.md-callout {
		display: flex;
		gap: 0.55rem;
		align-items: flex-start;
	}
	:global(.md-callout-icon) {
		flex-shrink: 0;
		margin-top: 0.1rem;
	}
	.md-callout--info :global(.md-callout-icon) {
		color: var(--chart-1);
	}
	.md-callout--success :global(.md-callout-icon) {
		color: var(--success);
	}
	.md-callout--warning :global(.md-callout-icon) {
		color: var(--warning);
	}
	.md-callout--error :global(.md-callout-icon) {
		color: var(--destructive);
	}
	.md-callout-body {
		min-width: 0;
		flex: 1;
	}
	.md-callout-title-text {
		margin: 0 0 0.15rem;
		font-weight: 600;
	}
	.md-callout-content :global(> *:first-child) {
		margin-top: 0;
	}
	.md-callout-content :global(> *:last-child) {
		margin-bottom: 0;
	}
</style>
