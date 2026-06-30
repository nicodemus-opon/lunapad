<script lang="ts">
	import { tick } from 'svelte';
	import type { SlashCommand } from '$lib/services/markdown-format';
	import { SLASH_COMMANDS } from '$lib/services/markdown-format';

	interface Props {
		token: string;
		onSelect: (command: SlashCommand) => void;
		onDismiss: () => void;
	}

	const { token, onSelect, onDismiss }: Props = $props();

	let selectedIndex = $state(0);
	let listEl: HTMLDivElement | null = $state(null);

	const filtered = $derived.by(() => {
		const q = token.toLowerCase();
		if (!q) return SLASH_COMMANDS;
		return SLASH_COMMANDS.filter(
			(c) => c.id.includes(q) || c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
		);
	});

	$effect(() => {
		// Reset selection when filter changes
		filtered;
		selectedIndex = 0;
	});

	function pick(cmd: SlashCommand) {
		onSelect(cmd);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			e.stopPropagation();
			selectedIndex = (selectedIndex + 1) % (filtered.length || 1);
			scrollToSelected();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopPropagation();
			selectedIndex = (selectedIndex - 1 + (filtered.length || 1)) % (filtered.length || 1);
			scrollToSelected();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			if (filtered[selectedIndex]) pick(filtered[selectedIndex]);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onDismiss();
		}
	}

	function scrollToSelected() {
		tick().then(() => {
			listEl?.querySelectorAll<HTMLButtonElement>('.slash-item')[selectedIndex]?.scrollIntoView({ block: 'nearest' });
		});
	}

	const groupLabels: Record<string, string> = { heading: 'Heading', structure: 'Structure', widget: 'Widget' };

	function groupedFiltered() {
		const groups: { group: string; items: SlashCommand[] }[] = [];
		let lastGroup = '';
		for (const cmd of filtered) {
			if (cmd.group !== lastGroup) {
				groups.push({ group: cmd.group, items: [] });
				lastGroup = cmd.group;
			}
			groups[groups.length - 1].items.push(cmd);
		}
		return groups;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="slash-palette md-slash-palette" onkeydown={handleKeydown}>
	{#if filtered.length === 0}
		<div class="slash-empty">No commands match "{token}"</div>
	{:else}
		<div class="slash-list" bind:this={listEl}>
			{#each groupedFiltered() as group}
				<div class="slash-group-label">{groupLabels[group.group] ?? group.group}</div>
				{#each group.items as cmd}
					{@const idx = filtered.indexOf(cmd)}
					<button
						type="button"
						class="slash-item"
						class:slash-item--selected={idx === selectedIndex}
						onmousedown={(e) => { e.preventDefault(); pick(cmd); }}
						onmouseenter={() => (selectedIndex = idx)}
					>
						<span class="slash-id">/{cmd.id}</span>
						<span class="slash-label">{cmd.label}</span>
						<span class="slash-desc">{cmd.description}</span>
					</button>
				{/each}
			{/each}
		</div>
	{/if}
</div>

<style>
	.slash-palette {
		position: absolute;
		left: 0;
		top: calc(100% + 4px);
		z-index: 50;
		width: 22rem;
		max-width: calc(100vw - 2rem);
		background: var(--popover, var(--background));
		border: 1px solid color-mix(in oklch, currentColor 12%, transparent);
		border-radius: 0.5rem;
		box-shadow: 0 4px 16px color-mix(in oklch, currentColor 12%, transparent);
		overflow: hidden;
	}
	.slash-list {
		max-height: 18rem;
		overflow-y: auto;
		padding: 0.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
	}
	.slash-group-label {
		font-size: 0.65rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted-foreground);
		padding: 0.35rem 0.5rem 0.15rem;
	}
	.slash-item {
		display: grid;
		grid-template-columns: 4rem 1fr auto;
		align-items: baseline;
		gap: 0.4rem;
		width: 100%;
		padding: 0.3rem 0.5rem;
		border-radius: 0.35rem;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		transition: background 80ms;
	}
	.slash-item--selected,
	.slash-item:hover {
		background: color-mix(in oklch, currentColor 6%, transparent);
	}
	.slash-id {
		font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
		font-size: 0.72rem;
		color: var(--primary);
		font-weight: 500;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.slash-label {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--foreground);
	}
	.slash-desc {
		font-size: 0.72rem;
		color: var(--muted-foreground);
		text-align: right;
	}
	.slash-empty {
		padding: 0.6rem 0.75rem;
		font-size: 0.78rem;
		color: var(--muted-foreground);
	}
</style>
