<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { cn } from '$lib/utils';
	import { beginChipEdit, endChipEdit } from '$lib/stores/chip-edit.svelte';

	interface Props {
		value: string;
		suggestions?: string[];
		placeholder?: string;
		class?: string;
		'data-testid'?: string;
		oninput?: (v: string) => void;
		oncommit?: (v: string) => void;
		oncancel?: () => void;
	}

	let {
		value,
		suggestions = [],
		placeholder = '…',
		class: className = '',
		'data-testid': testId,
		oninput,
		oncommit,
		oncancel
	}: Props = $props();

	let inputEl = $state<HTMLInputElement | undefined>();
	let mirror = $state<HTMLSpanElement | undefined>();
	let mirrorWidth = $state(20);
	let open = $state(false);
	let highlightedIdx = $state(-1);
	let draft = $state(untrack(() => value));
	// position:fixed coordinates — bypasses overflow:hidden on ancestor chip containers
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

	$effect(() => { draft = value; });

	const filtered = $derived(
		draft.trim()
			? suggestions.filter((s) => s.toLowerCase().includes(draft.toLowerCase()))
			: suggestions
	);

	function measureWidth() {
		if (mirror) mirrorWidth = Math.max(mirror.offsetWidth + 4, 20);
	}

	function updateDropdownPos() {
		if (inputEl) {
			const r = inputEl.getBoundingClientRect();
			dropdownTop = r.bottom + 2;
			dropdownLeft = r.left;
		}
	}

	$effect(() => {
		draft;
		requestAnimationFrame(() => measureWidth());
	});

	$effect(() => {
		if (open) updateDropdownPos();
	});

	function select(s: string) {
		draft = s;
		oninput?.(s);
		oncommit?.(s);
		open = false;
		highlightedIdx = -1;
	}

	function handleInput(e: Event) {
		draft = (e.target as HTMLInputElement).value;
		oninput?.(draft);
		open = true;
		highlightedIdx = filtered.length > 0 ? 0 : -1;
		measureWidth();
		updateDropdownPos();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') { e.preventDefault(); open = true; highlightedIdx = Math.min(highlightedIdx + 1, filtered.length - 1); return; }
		if (e.key === 'ArrowUp') { e.preventDefault(); highlightedIdx = Math.max(highlightedIdx - 1, 0); return; }
		if (e.key === 'Enter') {
			e.preventDefault();
			if (open && highlightedIdx >= 0 && highlightedIdx < filtered.length) { select(filtered[highlightedIdx]); }
			else { oncommit?.(draft); open = false; }
			return;
		}
		if (e.key === 'Escape') { open = false; oncancel?.(); return; }
		if (e.key === 'Tab') { open = false; }
	}

	// Holds autorun back while this chip is focused (see chip-edit.svelte.ts)
	let editing = false;

	function handleFocus() {
		if (!editing) {
			editing = true;
			beginChipEdit();
		}
		open = suggestions.length > 0;
		highlightedIdx = filtered.length > 0 ? 0 : -1;
		measureWidth();
		updateDropdownPos();
	}

	function handleBlur() {
		setTimeout(() => {
			open = false;
			oncommit?.(draft);
			if (editing) {
				editing = false;
				endChipEdit();
			}
		}, 80);
	}

	onDestroy(() => {
		// Stage removed mid-edit — release the counter or autorun stays blocked
		if (editing) {
			editing = false;
			endChipEdit();
		}
	});
</script>

<span class="relative inline-flex items-center">
	<span bind:this={mirror} aria-hidden="true" class={cn('absolute invisible whitespace-pre pointer-events-none', className)}>{draft || placeholder}</span>

	<input
		bind:this={inputEl}
		type="text"
		{value}
		{placeholder}
		data-testid={testId}
		style="width: {mirrorWidth}px"
		class={cn('bg-transparent outline-none min-w-4', className)}
		oninput={handleInput}
		onkeydown={handleKeydown}
		onfocus={handleFocus}
		onblur={handleBlur}
	/>

	{#if open && filtered.length > 0}
		<!-- position:fixed so overflow:hidden on ancestor chip containers doesn't clip this -->
		<div
			style="position: fixed; top: {dropdownTop}px; left: {dropdownLeft}px; z-index: 9999;"
			class="max-h-40 min-w-max max-w-52 overflow-auto rounded-md border bg-popover shadow-md"
		>
			{#each filtered as s, i (s)}
				<button
					type="button"
					class={cn('flex w-full items-center px-2 py-1 text-xs font-mono text-left hover:bg-accent hover:text-accent-foreground', i === highlightedIdx && 'bg-accent text-accent-foreground')}
					onmousedown={(e) => { e.preventDefault(); select(s); }}
				>{s}</button>
			{/each}
		</div>
	{/if}
</span>
