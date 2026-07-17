<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { sanitizeUrl } from '$lib/services/safe-url';

	interface Props {
		kind: 'image' | 'video';
		onInsert: (src: string) => void;
		onCancel: () => void;
	}

	const { kind, onInsert, onCancel }: Props = $props();

	let tab = $state<'url' | 'upload'>('url');
	let url = $state('https://');
	let error = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (tab === 'url') inputEl?.focus();
	});

	function applyUrl() {
		const safe = sanitizeUrl(url.trim());
		if (!safe) {
			error = 'Enter a valid http(s) URL';
			return;
		}
		onInsert(safe);
	}

	function onFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const expectedType = kind === 'video' ? 'video/' : 'image/';
		if (!file.type.startsWith(expectedType)) {
			error = `Choose a ${kind} file`;
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const src = reader.result;
			if (typeof src === 'string') onInsert(src);
		};
		reader.readAsDataURL(file);
	}
</script>

<div
	class="media-popover flex w-72 flex-col gap-2 rounded-md border bg-popover p-2 shadow-lg"
	role="menu"
	tabindex="-1"
	onmousedown={(e) => e.stopPropagation()}
>
	<ToggleGroup.Root
		bind:value={tab}
		type="single"
		class="flex gap-1 border-b border-border pb-1.5"
		onValueChange={() => (error = '')}
	>
		<ToggleGroup.Item value="url">URL</ToggleGroup.Item>
		<ToggleGroup.Item value="upload">Upload</ToggleGroup.Item>
	</ToggleGroup.Root>

	{#if tab === 'url'}
		<div class="flex items-center gap-1">
			<Input
				bind:ref={inputEl}
				type="url"
				class="h-7 min-w-0 flex-1 text-xs"
				placeholder="https://"
				bind:value={url}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						applyUrl();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						onCancel();
					}
				}}
			/>
			<Button
				type="button"
				variant="default"
				size="sm"
				class="h-7 px-2 text-xs"
				onmousedown={(e) => {
					e.preventDefault();
					applyUrl();
				}}
			>
				Insert
			</Button>
		</div>
	{:else}
		<Button
			type="button"
			variant="outline"
			class="h-auto border-dashed px-3 py-4 text-xs text-muted-foreground"
			onclick={() => fileInputEl?.click()}
		>
			Choose a {kind} file…
		</Button>
		<input
			bind:this={fileInputEl}
			type="file"
			accept={kind === 'video' ? 'video/*' : 'image/*'}
			class="hidden"
			onchange={onFileChange}
		/>
	{/if}

	{#if error}
		<p class="text-2xs text-destructive">{error}</p>
	{/if}
</div>
