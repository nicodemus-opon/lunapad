<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { FlaskConical } from '@lucide/svelte';

	let {
		open = $bindable(false),
		onTryDemo,
		onStartBlank
	}: {
		open?: boolean;
		onTryDemo: () => void | Promise<void>;
		onStartBlank: () => void;
	} = $props();

	let loading = $state(false);

	async function handleTryDemo() {
		loading = true;
		try {
			open = false;
			await onTryDemo();
		} finally {
			loading = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<div class="px-4 pt-4">
			<div class="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
				<FlaskConical class="h-4 w-4 text-primary" />
			</div>
			<p class="text-base font-semibold">Welcome to Lunapad</p>
			<p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">
				Lunapad is a notebook-style SQL/PRQL IDE. Start with the interactive demo to see charts,
				PRQL pipelines, and live dashboards — or begin with a blank notebook.
			</p>
			<p class="mt-3 text-2xs text-muted-foreground">
				You can always load the demo later from <strong>File → Explore demo notebook</strong>.
			</p>
		</div>
		<div class="flex justify-end gap-2 px-4 py-3">
			<Button
				variant="ghost"
				size="sm"
				disabled={loading}
				onclick={() => {
					open = false;
					onStartBlank();
				}}
			>
				Start blank
			</Button>
			<Button size="sm" disabled={loading} onclick={() => void handleTryDemo()}>
				Try the demo
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
