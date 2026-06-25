<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	const { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<div class="site-shell">
	<nav class="site-nav">
		<span class="site-nav-name">{data.site.name}</span>
		<div class="site-nav-links">
			{#each data.site.pages as page (page.pageSlug)}
				<a href={`/s/${data.site.slug}/${page.pageSlug}`}>{page.navLabel}</a>
			{/each}
		</div>
	</nav>
	{@render children()}
</div>

<style>
	.site-shell {
		min-height: 100vh;
		background: var(--background);
	}
	.site-nav {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.85rem;
	}
	.site-nav-name {
		font-weight: 600;
	}
	.site-nav-links {
		display: flex;
		gap: 1.25rem;
	}
	.site-nav-links a {
		color: var(--muted-foreground);
		text-decoration: none;
	}
	.site-nav-links a:hover {
		color: var(--foreground);
	}
</style>
