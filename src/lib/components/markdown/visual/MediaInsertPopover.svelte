<script lang="ts">
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
	<div class="flex gap-1 border-b border-border pb-1.5">
		<button
			type="button"
			class="media-tab {tab === 'url' ? 'is-active' : ''}"
			onmousedown={(e) => {
				e.preventDefault();
				tab = 'url';
				error = '';
			}}
		>
			URL
		</button>
		<button
			type="button"
			class="media-tab {tab === 'upload' ? 'is-active' : ''}"
			onmousedown={(e) => {
				e.preventDefault();
				tab = 'upload';
				error = '';
			}}
		>
			Upload
		</button>
	</div>

	{#if tab === 'url'}
		<div class="flex items-center gap-1">
			<input
				bind:this={inputEl}
				type="url"
				class="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs"
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
			<button
				type="button"
				class="rounded px-2 py-1 text-xs hover:bg-muted/60"
				onmousedown={(e) => {
					e.preventDefault();
					applyUrl();
				}}
			>
				Insert
			</button>
		</div>
	{:else}
		<button
			type="button"
			class="rounded border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground hover:bg-muted/40"
			onclick={() => fileInputEl?.click()}
		>
			Choose a {kind} file…
		</button>
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

<style>
	.media-tab {
		border-radius: var(--radius-sm);
		padding: 0.2rem 0.55rem;
		font-size: var(--text-2xs);
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.media-tab:hover {
		background: color-mix(in oklab, var(--muted) 40%, transparent);
	}
	.media-tab.is-active {
		background: var(--accent);
		color: var(--accent-foreground);
	}
</style>
