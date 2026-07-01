<script lang="ts">
	import { untrack } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		value: string;
		suggestions?: string[];
		initialEditing?: boolean;
		placeholder?: string;
		oncommit: (v: string) => void;
		oncancel?: () => void;
		class?: string;
	}

	let {
		value,
		suggestions = [],
		initialEditing = false,
		placeholder = '…',
		oncommit,
		oncancel,
		class: className = ''
	}: Props = $props();

	let editing = $state(false);
	let draft = $state(untrack(() => value)); // initialize from prop so initialEditing pre-fills correctly

	$effect(() => {
		if (initialEditing) editing = true;
	});
	$effect(() => {
		if (!editing) draft = value;
	}); // sync when not editing (e.g. external value change)

	let inputEl = $state<HTMLInputElement | undefined>();
	let mirror = $state<HTMLSpanElement | undefined>();
	let mirrorWidth = $state(20);
	let open = $state(false);
	let highlightedIdx = $state(-1);
	// position: fixed coordinates so overflow:hidden on ancestors doesn't clip the dropdown
	let dropdownTop = $state(0);
	let dropdownLeft = $state(0);

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
		if (editing && inputEl) {
			inputEl.focus();
			inputEl.select();
			requestAnimationFrame(() => {
				measureWidth();
				updateDropdownPos();
			});
		}
	});

	$effect(() => {
		draft;
		requestAnimationFrame(() => measureWidth());
	});

	$effect(() => {
		if (open) updateDropdownPos();
	});

	function startEdit() {
		draft = value;
		editing = true;
		open = suggestions.length > 0;
		highlightedIdx = filtered.length > 0 ? 0 : -1;
	}

	function commit() {
		const trimmed = draft.trim();
		if (trimmed) {
			oncommit(trimmed);
		} else {
			oncancel?.();
		}
		editing = false;
		open = false;
	}

	function cancel() {
		editing = false;
		open = false;
		draft = value;
		oncancel?.();
	}

	function selectSuggestion(s: string) {
		draft = s;
		oncommit(s);
		editing = false;
		open = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			open = true;
			highlightedIdx = Math.min(highlightedIdx + 1, filtered.length - 1);
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightedIdx = Math.max(highlightedIdx - 1, 0);
			return;
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (open && highlightedIdx >= 0 && highlightedIdx < filtered.length) {
				selectSuggestion(filtered[highlightedIdx]);
			} else {
				commit();
			}
			return;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			cancel();
			return;
		}
		if (e.key === 'Tab') {
			commit();
		}
	}

	function handleInput(e: Event) {
		draft = (e.target as HTMLInputElement).value;
		open = true;
		highlightedIdx = filtered.length > 0 ? 0 : -1;
		measureWidth();
		updateDropdownPos();
	}

	function handleBlur() {
		setTimeout(() => {
			if (editing) commit();
		}, 120);
	}
</script>

<span class="relative inline-flex items-center" data-editing={editing}>
	<span
		bind:this={mirror}
		aria-hidden="true"
		class={cn('pointer-events-none invisible absolute whitespace-pre', className)}
		>{draft || placeholder}</span
	>

	{#if editing}
		<input
			bind:this={inputEl}
			type="text"
			value={draft}
			{placeholder}
			style="width: {mirrorWidth}px"
			class={cn('min-w-4 bg-transparent outline-none', className)}
			oninput={handleInput}
			onkeydown={handleKeydown}
			onblur={handleBlur}
		/>
		{#if open && filtered.length > 0}
			<!-- position:fixed so overflow:hidden on ancestor chip containers doesn't clip this -->
			<div
				style="position: fixed; top: {dropdownTop}px; left: {dropdownLeft}px; z-index: 9999;"
				class="max-h-48 max-w-56 min-w-max overflow-auto rounded-md border bg-popover shadow-md"
			>
				{#each filtered as s, i (s)}
					<button
						type="button"
						class={cn(
							'flex w-full items-center px-2 py-1 text-left font-mono text-xs hover:bg-accent hover:text-accent-foreground',
							i === highlightedIdx && 'bg-accent text-accent-foreground'
						)}
						onmousedown={(e) => {
							e.preventDefault();
							selectSuggestion(s);
						}}>{s}</button
					>
				{/each}
			</div>
		{/if}
	{:else}
		<button
			type="button"
			class={cn('cursor-text bg-transparent text-left', className)}
			onclick={startEdit}
		>
			{value || placeholder}
		</button>
	{/if}
</span>
