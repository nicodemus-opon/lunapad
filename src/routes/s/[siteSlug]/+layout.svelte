<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	const { data, children }: { data: LayoutData; children: Snippet } = $props();

	const accentStyle = $derived(
		data.site.accentColor ? `--site-accent: ${data.site.accentColor};` : ''
	);
</script>

<div class="site-shell" style={accentStyle}>
	<nav class="site-nav no-print">
		<div class="site-nav-brand">
			{#if data.site.logoUrl}
				<img src={data.site.logoUrl} alt="" class="site-logo" />
			{/if}
			<a href="/s/{data.site.slug}/{data.site.homePageSlug ?? data.site.pages[0]?.pageSlug}">
				{data.site.name}
			</a>
		</div>
		<div class="site-nav-links">
			{#each data.site.pages as navPage (navPage.pageSlug)}
				<a
					href={`/s/${data.site.slug}/${navPage.pageSlug}`}
					class:is-active={data.currentPageSlug === navPage.pageSlug}
				>
					{navPage.navLabel}
				</a>
			{/each}
		</div>
	</nav>
	{@render children()}
	{#if data.site.showFooter}
		<footer class="site-footer no-print">
			<span>Powered by Lunapad</span>
		</footer>
	{/if}
</div>

<style>
	.site-shell {
		min-height: 100vh;
		background: var(--background);
		display: flex;
		flex-direction: column;
	}
	.site-nav {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		padding: 0.75rem 1.5rem;
		border-bottom: 1px solid var(--border);
		font-size: 0.85rem;
		flex-wrap: wrap;
	}
	.site-nav-brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 600;
	}
	.site-nav-brand a {
		color: var(--foreground);
		text-decoration: none;
	}
	.site-logo {
		height: 1.25rem;
		width: auto;
	}
	.site-nav-links {
		display: flex;
		gap: 1.25rem;
		flex-wrap: wrap;
	}
	.site-nav-links a {
		color: var(--muted-foreground);
		text-decoration: none;
		padding-bottom: 0.15rem;
		border-bottom: 2px solid transparent;
	}
	.site-nav-links a:hover,
	.site-nav-links a.is-active {
		color: var(--site-accent, var(--foreground));
		border-bottom-color: var(--site-accent, var(--foreground));
	}
	.site-footer {
		margin-top: auto;
		padding: 1rem 1.5rem;
		border-top: 1px solid var(--border);
		font-size: 0.72rem;
		color: var(--muted-foreground);
		text-align: center;
	}
	@media print {
		:global(.no-print) {
			display: none !important;
		}
	}
</style>
