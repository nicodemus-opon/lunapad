<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';

	let {
		open = $bindable(false),
		title,
		body,
		confirmLabel = 'Delete',
		onConfirm
	}: {
		open?: boolean;
		title: string;
		body?: string;
		confirmLabel?: string;
		onConfirm: () => void;
	} = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-sm gap-0 overflow-hidden p-0">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			{#if body}
				<Dialog.Description class="leading-relaxed">{body}</Dialog.Description>
			{/if}
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="ghost" size="sm" onclick={() => (open = false)}>Cancel</Button>
			<Button
				variant="destructive"
				size="sm"
				onclick={() => {
					open = false;
					onConfirm();
				}}
			>
				{confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
