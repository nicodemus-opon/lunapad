<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { untrack } from 'svelte';

	interface Props {
		initialUrl?: string;
		onApply: (url: string) => void;
		onCancel: () => void;
	}

	const { initialUrl = 'https://', onApply, onCancel }: Props = $props();

	// Popover is remounted fresh each time it opens (guarded by an #if block in the
	// caller), so this is intentionally a one-time snapshot, not a live binding.
	let url = $state(untrack(() => initialUrl));
	let inputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		inputEl?.focus();
		inputEl?.select();
	});
</script>

<div
	class="link-popover flex min-w-52 items-center gap-1 rounded-md border bg-popover p-1 shadow-lg"
	role="menu"
	tabindex="-1"
	onmousedown={(e) => e.stopPropagation()}
>
	<Input
		bind:ref={inputEl}
		type="url"
		class="h-7 min-w-0 flex-1 text-xs"
		placeholder="https://"
		bind:value={url}
		onkeydown={(e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				onApply(url.trim());
			} else if (e.key === 'Escape') {
				e.preventDefault();
				onCancel();
			}
		}}
	/>
	<Button
		type="button"
		variant="ghost"
		size="sm"
		class="h-7 px-2 text-xs"
		onmousedown={(e) => {
			e.preventDefault();
			onApply(url.trim());
		}}
	>
		Apply
	</Button>
</div>
