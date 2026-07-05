<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { SlidersHorizontal } from '@lucide/svelte';
	import type { MarkdownRefEntry } from '$lib/services/markdoc-catalog';

	interface Props {
		entries: MarkdownRefEntry[];
		onInsert: (snippet: string) => void;
	}

	const { entries, onInsert }: Props = $props();

	type FilterKind = 'dropdown' | 'text-input' | 'date-range' | 'button-group';

	let open = $state(false);
	let kind = $state<FilterKind>('dropdown');
	let param = $state('');
	let label = $state('');
	let optionsMode = $state<'static' | 'cell'>('static');
	let staticOptions = $state('');
	let optionsCell = $state('');
	let optionsColumn = $state('');

	const showOptions = $derived(kind === 'dropdown' || kind === 'button-group');
	const cellColumns = $derived(entries.find((e) => e.cellName === optionsCell)?.columns ?? []);

	function escapeAttr(value: string): string {
		return value.replace(/"/g, '\\"');
	}

	function buildSnippet(): string {
		const attrs = [`kind="${kind}"`, `param="${escapeAttr(param)}"`];
		if (label) attrs.push(`label="${escapeAttr(label)}"`);
		if (showOptions) {
			if (optionsMode === 'static' && staticOptions.trim()) {
				const list = staticOptions
					.split(',')
					.map((v) => v.trim())
					.filter(Boolean)
					.map((v) => `"${escapeAttr(v)}"`)
					.join(',');
				attrs.push(`options=[${list}]`);
			} else if (optionsMode === 'cell' && optionsCell) {
				attrs.push(`options=$${optionsCell}.rows`);
				if (optionsColumn) attrs.push(`optionsColumn="${escapeAttr(optionsColumn)}"`);
			}
		}
		return `{% filter ${attrs.join(' ')} /%}`;
	}

	function insert() {
		if (!param.trim()) return;
		onInsert(buildSnippet());
		open = false;
		param = '';
		label = '';
		staticOptions = '';
		optionsCell = '';
		optionsColumn = '';
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="md-refpicker-trigger"
		title="Insert a filter widget"
		aria-label="Insert a filter widget"
	>
		<SlidersHorizontal size={12} />
		<span>Insert filter</span>
	</Popover.Trigger>
	<Popover.Content class="md-filterpicker-content" align="start">
		<div class="flex items-center gap-1.5">
			<select bind:value={kind} class="md-filterpicker-select">
				<option value="dropdown">Dropdown</option>
				<option value="text-input">Text input</option>
				<option value="date-range">Date range</option>
				<option value="button-group">Button group</option>
			</select>
		</div>
		<Input
			bind:value={param}
			placeholder="param name (e.g. region)"
			class="h-7 text-xs"
			autofocus
		/>
		<Input bind:value={label} placeholder="label (optional)" class="h-7 text-xs" />

		{#if showOptions}
			<div class="flex items-center gap-1 text-[11px] text-muted-foreground">
				<button
					type="button"
					class:md-filterpicker-tab-active={optionsMode === 'static'}
					class="md-filterpicker-tab"
					onclick={() => (optionsMode = 'static')}>Static list</button
				>
				<button
					type="button"
					class:md-filterpicker-tab-active={optionsMode === 'cell'}
					class="md-filterpicker-tab"
					onclick={() => (optionsMode = 'cell')}>From cell column</button
				>
			</div>
			{#if optionsMode === 'static'}
				<Input bind:value={staticOptions} placeholder="US, EU, APAC" class="h-7 text-xs" />
			{:else}
				<select bind:value={optionsCell} class="md-filterpicker-select">
					<option value="">Select cell…</option>
					{#each entries as entry (entry.cellName)}
						<option value={entry.cellName}>{entry.cellName}</option>
					{/each}
				</select>
				{#if optionsCell}
					<select bind:value={optionsColumn} class="md-filterpicker-select">
						<option value="">Select column…</option>
						{#each cellColumns as col (col.name)}
							<option value={col.name}>{col.name}</option>
						{/each}
					</select>
				{/if}
			{/if}
		{/if}

		<Button size="sm" class="w-full" disabled={!param.trim()} onclick={insert}>Insert</Button>
	</Popover.Content>
</Popover.Root>

<style>
	:global(.md-filterpicker-content) {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.4rem;
		width: 16rem;
	}
	.md-filterpicker-select {
		width: 100%;
		height: 1.75rem;
		border-radius: 0.35rem;
		border: 1px solid var(--border);
		background: color-mix(in oklch, currentColor 3%, transparent);
		padding: 0 0.4rem;
		font-size: 0.78rem;
	}
	.md-filterpicker-tab {
		padding: 0.15rem 0.4rem;
		border-radius: 0.3rem;
		border: 1px solid transparent;
		background: none;
		cursor: pointer;
	}
	.md-filterpicker-tab-active {
		border-color: var(--border);
		color: var(--foreground);
	}
</style>
