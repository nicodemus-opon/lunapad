<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		value: string;
		suggestions: string[];
		placeholder?: string;
		class?: string;
		'data-testid'?: string;
		onchange: (v: string) => void;
	}

	let {
		value,
		suggestions,
		placeholder = 'column…',
		class: className = '',
		'data-testid': testId,
		onchange
	}: Props = $props();

	let open = $state(false);
	let focused = $state(false);
	let draft = $state('');
	let highlightedIndex = $state(-1);

	const query = $derived(focused ? draft : value);

	const normalizedSuggestions = $derived.by(() => {
		const out: string[] = [];
		for (const suggestion of suggestions) {
			const normalized = suggestion.trim();
			if (!normalized || out.includes(normalized)) continue;
			out.push(normalized);
		}
		return out;
	});

	const filtered = $derived(
		query.trim()
			? normalizedSuggestions.filter((s) => s.toLowerCase().includes(query.toLowerCase()))
			: normalizedSuggestions
	);

	function select(col: string) {
		draft = col;
		onchange(col);
		open = false;
		highlightedIndex = -1;
	}

	function handleInput(e: Event) {
		draft = (e.target as HTMLInputElement).value;
		onchange(draft);
		open = true;
		highlightedIndex = normalizedSuggestions.length > 0 ? 0 : -1;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			open = true;
			if (highlightedIndex >= filtered.length) {
				highlightedIndex = filtered.length - 1;
			}
			if (filtered.length > 0) {
				highlightedIndex = Math.min(highlightedIndex + 1, filtered.length - 1);
			}
			return;
		}

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (highlightedIndex >= filtered.length) {
				highlightedIndex = filtered.length - 1;
			}
			if (filtered.length > 0) {
				highlightedIndex = Math.max(highlightedIndex - 1, 0);
			}
			return;
		}

		if (e.key === 'Escape') {
			open = false;
			highlightedIndex = -1;
			focused = false;
		} else if (e.key === 'Enter') {
			if (open && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
				e.preventDefault();
				select(filtered[highlightedIndex]);
				return;
			}
			onchange(draft);
			open = false;
			highlightedIndex = -1;
		} else if (e.key === 'Tab') {
			open = false;
			highlightedIndex = -1;
		}
	}

	function handleBlur() {
		focused = false;
		open = false;
	}
</script>

<div class="relative">
	<input
		type="text"
		value={query}
		{placeholder}
		data-testid={testId}
		class={cn(
			'flex h-7 w-full rounded-md border border-input bg-background px-2 py-0.5 font-mono text-xs shadow-sm',
			'ring-offset-background placeholder:text-muted-foreground',
			'focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
			'disabled:cursor-not-allowed disabled:opacity-50',
			className
		)}
		oninput={handleInput}
		onkeydown={handleKeydown}
		onfocus={() => {
			focused = true;
			draft = value;
			open = true;
			highlightedIndex = filtered.length > 0 ? 0 : -1;
		}}
		onblur={handleBlur}
	/>
	{#if open}
		<div
			data-suggestion-list
			class="absolute top-full left-0 z-50 mt-0.5 max-h-48 min-w-full overflow-auto rounded-md border bg-popover shadow-md"
		>
			{#if filtered.length === 0}
				<div class="px-2 py-1 text-xs text-muted-foreground">No matches</div>
			{:else}
				{#each filtered as col, i (col)}
					<button
						type="button"
						class={cn(
							'flex w-full items-center px-2 py-1 text-left font-mono text-xs hover:bg-accent hover:text-accent-foreground',
							i === highlightedIndex && 'bg-accent text-accent-foreground'
						)}
						onmousedown={(e) => {
							e.preventDefault(); // prevent input blur before click
							select(col);
						}}
					>
						{col}
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
