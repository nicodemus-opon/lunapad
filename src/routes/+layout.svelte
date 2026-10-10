<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { Toaster } from '$lib/components/ui/sonner';
	import { TooltipProvider } from '$lib/components/ui/tooltip';
	import { getTheme } from '$lib/stores/notebook.svelte';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import AnalyticsConsent from '$lib/components/AnalyticsConsent.svelte';
	import { initAnalytics, startAnalyticsNavigationTracking } from '$lib/services/analytics';
	import {
		applyWorkspaceTheme,
		cacheWorkspaceTheme,
		fetchWorkspaceThemeResult,
		readCachedWorkspaceTheme
	} from '$lib/services/workspace-theme.svelte';

	let { children } = $props();

	if (browser) {
		initAnalytics();
		startAnalyticsNavigationTracking();
	}

	// app.html already injects the cached workspace brand theme's override
	// <style> tag before first paint (see the early-paint script there). This is
	// a belt-and-suspenders fallback for any environment where app.html didn't
	// run (e.g. tests, storybook, direct component import).
	if (browser && !document.getElementById('workspace-theme-override')) {
		applyWorkspaceTheme(readCachedWorkspaceTheme());
	}

	const theme = $derived(getTheme());
	let systemPrefersDark = $state(
		browser && window.matchMedia('(prefers-color-scheme: dark)').matches
	);
	const resolvedTheme = $derived(
		theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme
	);

	$effect(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
		document.documentElement.classList.toggle('light', resolvedTheme === 'light');
	});

	onMount(() => {
		const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
		const onColorSchemeChange = (event: MediaQueryListEvent) => {
			systemPrefersDark = event.matches;
		};
		colorScheme.addEventListener('change', onColorSchemeChange);

		// Reconcile the early-painted cached theme with the server's current
		// value. This cannot depend on isServerWorkspaceMode(): +page.svelte
		// initializes that flag after this root layout has already mounted.
		void fetchWorkspaceThemeResult().then((result) => {
			if (!result.ok) return;
			applyWorkspaceTheme(result.theme);
			cacheWorkspaceTheme(result.theme);
		});

		return () => colorScheme.removeEventListener('change', onColorSchemeChange);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class={resolvedTheme}>
	<TooltipProvider>
		<div class="min-h-screen bg-background text-foreground">
			{@render children()}
		</div>
	</TooltipProvider>
	<Toaster richColors theme={resolvedTheme === 'dark' ? 'dark' : 'light'} />
	<AnalyticsConsent />
</div>
