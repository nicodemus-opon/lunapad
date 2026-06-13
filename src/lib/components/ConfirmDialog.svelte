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
	<Dialog.Content class="max-w-sm">
		<div class="px-4 pt-4">
			<p class="text-sm font-semibold">{title}</p>
			{#if body}
				<p class="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
			{/if}
		</div>
		<div class="flex justify-end gap-2 px-4 py-3">
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
		</div>
	</Dialog.Content>
</Dialog.Root>
