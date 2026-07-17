<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { NativeSelect } from '$lib/components/ui/native-select';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
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
			<NativeSelect bind:value={kind} class="h-7 text-xs">
				<option value="dropdown">Dropdown</option>
				<option value="text-input">Text input</option>
				<option value="date-range">Date range</option>
				<option value="button-group">Button group</option>
			</NativeSelect>
		</div>
		<Input
			bind:value={param}
			placeholder="param name (e.g. region)"
			class="h-7 text-xs"
			autofocus
		/>
		<Input bind:value={label} placeholder="label (optional)" class="h-7 text-xs" />

		{#if showOptions}
			<ToggleGroup.Root bind:value={optionsMode} type="single" class="inline-flex gap-1">
				<ToggleGroup.Item value="static">Static list</ToggleGroup.Item>
				<ToggleGroup.Item value="cell">From cell column</ToggleGroup.Item>
			</ToggleGroup.Root>
			{#if optionsMode === 'static'}
				<Input bind:value={staticOptions} placeholder="US, EU, APAC" class="h-7 text-xs" />
			{:else}
				<NativeSelect bind:value={optionsCell} class="h-7 text-xs">
					<option value="">Select cell…</option>
					{#each entries as entry (entry.cellName)}
						<option value={entry.cellName}>{entry.cellName}</option>
					{/each}
				</NativeSelect>
				{#if optionsCell}
					<NativeSelect bind:value={optionsColumn} class="h-7 text-xs">
						<option value="">Select column…</option>
						{#each cellColumns as col (col.name)}
							<option value={col.name}>{col.name}</option>
						{/each}
					</NativeSelect>
				{/if}
			{/if}
		{/if}

		<Button variant="default" size="sm" class="w-full" disabled={!param.trim()} onclick={insert}
			>Insert</Button
		>
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
</style>
