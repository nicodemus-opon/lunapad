<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { Toaster } from '$lib/components/ui/sonner';
	import { TooltipProvider } from '$lib/components/ui/tooltip';
	import { getTheme } from '$lib/stores/notebook.svelte';
	import { initPlatform, platform, platformOS } from '$lib/services/platform.svelte';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	let { children } = $props();

	// app.html already stamps data-platform/data-os and CSS vars before first paint.
	// This is a belt-and-suspenders fallback for any environment where app.html
	// didn't run (e.g. tests, storybook, direct component import).
	if (browser && !document.documentElement.dataset.platform) {
		const root = document.documentElement;
		root.dataset.platform = platform;
		root.dataset.os = platformOS.value;
		if (platform === 'tauri') {
			if (platformOS.value === 'macos') {
				root.style.setProperty('--titlebar-inset-left', '96px');
			} else if (platformOS.value === 'windows' || platformOS.value === 'linux') {
				root.style.setProperty('--titlebar-inset-right', '138px');
			}
		}
	}

	const theme = $derived(getTheme());
	const resolvedTheme = $derived(
		theme === 'system'
			? typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
				? 'dark'
				: 'light'
			: theme
	);

	$effect(() => {
		if (typeof document === 'undefined') return;
		document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
		document.documentElement.classList.toggle('light', resolvedTheme === 'light');
	});

	// Keep data-os in sync if async Tauri plugin overrides the navigator-based detection
	$effect(() => {
		if (!browser) return;
		document.documentElement.dataset.os = platformOS.value;
	});

	onMount(async () => {
		try {
			await initPlatform();
		} catch {
			// Tauri OS plugin unavailable; navigator-based detection stays in effect
		}
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
</div>
