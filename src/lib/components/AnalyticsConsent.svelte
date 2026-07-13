<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { getAnalyticsConsent, initAnalytics, setAnalyticsConsent } from '$lib/services/analytics';

	let visible = $state(false);

	onMount(() => {
		const consent = getAnalyticsConsent();
		visible = consent === null;
		if (consent === 'accepted') initAnalytics();
	});

	function acceptAnalytics() {
		setAnalyticsConsent('accepted');
		visible = false;
	}

	function declineAnalytics() {
		setAnalyticsConsent('declined');
		visible = false;
	}
</script>

{#if visible}
	<div class="fixed inset-x-3 bottom-3 z-(--z-popover) sm:inset-x-auto sm:right-4 sm:max-w-md">
		<div
			class="rounded-lg border border-border bg-background/95 p-4 text-sm shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/90"
		>
			<p class="font-medium text-foreground">Help improve Lunapad</p>
			<p class="mt-1 leading-5 text-muted-foreground">
				Share privacy-minded product analytics so we can see which workflows are working. We do not
				collect notebook contents, query text, table data, names, or emails.
			</p>
			<div class="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button variant="ghost" size="sm" onclick={declineAnalytics}>Not now</Button>
				<Button size="sm" onclick={acceptAnalytics}>Allow analytics</Button>
			</div>
		</div>
	</div>
{/if}
