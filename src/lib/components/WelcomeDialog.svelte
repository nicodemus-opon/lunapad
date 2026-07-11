<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { FlaskConical } from '@lucide/svelte';

	let {
		open = $bindable(false),
		onBrowseTemplates,
		onStartBlank
	}: {
		open?: boolean;
		onBrowseTemplates: () => void;
		onStartBlank: () => void;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<div class="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
				<FlaskConical class="h-4 w-4 text-primary" />
			</div>
			<Dialog.Title>Welcome to Lunapad</Dialog.Title>
			<Dialog.Description class="leading-relaxed">
				Lunapad is a notebook-style SQL/PRQL IDE. Browse starter templates to see charts, PRQL
				pipelines, and live dashboards — or begin with a blank notebook.
			</Dialog.Description>
		</Dialog.Header>
		<div class="px-4 py-3">
			<p class="text-2xs text-muted-foreground">
				You can always browse templates later from <strong>File → Browse templates</strong>.
			</p>
		</div>
		<Dialog.Footer>
			<Button
				variant="ghost"
				size="sm"
				onclick={() => {
					open = false;
					onStartBlank();
				}}
			>
				Start blank
			</Button>
			<Button
				size="sm"
				onclick={() => {
					open = false;
					onBrowseTemplates();
				}}
			>
				Browse templates
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
