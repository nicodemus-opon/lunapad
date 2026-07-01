<script lang="ts">
	import {
		getTables,
		openTableViewTab,
		openProfileTab,
		type UploadedTable
	} from '$lib/stores/notebook.svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import {
		Table2,
		ChevronRight,
		Hash,
		Type,
		ToggleLeft,
		Calendar,
		Clock,
		List,
		Braces,
		Binary,
		Copy,
		Eye,
		BarChart2
	} from '@lucide/svelte';

	const tables = $derived(getTables());

	let {
		showHeader = true,
		showFooter = true
	}: {
		showHeader?: boolean;
		showFooter?: boolean;
	} = $props();

	// Which tables are expanded
	let expanded = $state<Record<string, boolean>>({});

	function toggle(name: string) {
		expanded[name] = !expanded[name];
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text).catch(() => {});
	}

	function columnTypeIcon(type: string) {
		const t = type.toUpperCase();
		if (t.includes('INT') || t.includes('HUGEINT') || t.includes('UBIGINT')) return Hash;
		if (
			t.includes('FLOAT') ||
			t.includes('DOUBLE') ||
			t.includes('DECIMAL') ||
			t.includes('NUMERIC') ||
			t.includes('REAL')
		)
			return Hash;
		if (t.includes('BOOL')) return ToggleLeft;
		if (t.startsWith('DATE')) return Calendar;
		if (t.includes('TIMESTAMP') || t.includes('TIME')) return Clock;
		if (
			t.includes('VARCHAR') ||
			t.includes('TEXT') ||
			t.includes('CHAR') ||
			t.includes('STRING') ||
			t.includes('BLOB')
		)
			return Type;
		if (t.includes('LIST') || t.includes('ARRAY')) return List;
		if (t.includes('STRUCT') || t.includes('JSON') || t.includes('MAP')) return Braces;
		if (t.includes('BINARY') || t.includes('BIT')) return Binary;
		return Type;
	}

	function columnTypeLabel(type: string): string {
		const t = type.toUpperCase();
		if (t.startsWith('VARCHAR')) return 'varchar';
		if (t.startsWith('INTEGER')) return 'int';
		if (t.startsWith('BIGINT')) return 'bigint';
		if (t.startsWith('HUGEINT')) return 'hugeint';
		if (t.startsWith('DOUBLE')) return 'double';
		if (t.startsWith('FLOAT')) return 'float';
		if (t.startsWith('DECIMAL')) return 'decimal';
		if (t.startsWith('BOOLEAN')) return 'bool';
		if (t.startsWith('TIMESTAMP')) return 'timestamp';
		if (t.startsWith('DATE')) return 'date';
		if (t.startsWith('TIME')) return 'time';
		return type.toLowerCase().split('(')[0];
	}
</script>

<aside class="flex h-full flex-col overflow-hidden border-r bg-background">
	<!-- Header -->
	{#if showHeader}
		<div class="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
			<Table2 class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase">Tables</span>
		</div>
	{/if}

	<!-- Tree body -->
	<div class="flex-1 overflow-y-auto py-1">
		{#if tables.length === 0}
			<p class="px-3 py-4 text-center text-xs text-muted-foreground italic">
				No tables loaded.<br />Upload a CSV to get started.
			</p>
		{:else}
			{#each tables as table (table.name)}
				<!-- Table row -->
				<ContextMenu.Root>
					<ContextMenu.Trigger>
						<div
							class="group mx-1 flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 select-none hover:bg-accent/60"
							onclick={() => toggle(table.name)}
							role="treeitem"
							aria-expanded={expanded[table.name] ?? false}
							aria-selected="false"
							tabindex="0"
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') toggle(table.name);
							}}
						>
							<ChevronRight
								class="h-3 w-3 shrink-0 text-muted-foreground transition-transform {expanded[
									table.name
								]
									? 'rotate-90'
									: ''}"
							/>
							<Table2 class="h-3.5 w-3.5 shrink-0 text-primary/70" />
							<span class="min-w-0 flex-1 truncate font-mono text-xs font-medium">{table.name}</span
							>
							<span class="shrink-0 text-[10px] text-muted-foreground tabular-nums">
								{table.rowCount.toLocaleString()}r
							</span>
						</div>
					</ContextMenu.Trigger>
					<ContextMenu.Content class="w-48">
						<ContextMenu.Item onclick={() => copyToClipboard(table.name)}>
							<Copy class="mr-2 h-3.5 w-3.5" />
							Copy name
						</ContextMenu.Item>
						<ContextMenu.Separator />
						<ContextMenu.Item onclick={() => openTableViewTab(table.name)}>
							<Eye class="mr-2 h-3.5 w-3.5" />
							View table
						</ContextMenu.Item>
						<ContextMenu.Item onclick={() => openProfileTab(table.name)}>
							<BarChart2 class="mr-2 h-3.5 w-3.5" />
							Profile table
						</ContextMenu.Item>
					</ContextMenu.Content>
				</ContextMenu.Root>

				<!-- Columns (expanded) -->
				{#if expanded[table.name]}
					{#each table.columns as col, i (col)}
						{@const Icon = columnTypeIcon(table.columnTypes?.[i] ?? '')}
						<ContextMenu.Root>
							<ContextMenu.Trigger>
								<div
									class="mx-1 flex cursor-pointer items-center gap-1.5 rounded-sm py-0.5 pr-2 pl-7 select-none hover:bg-accent/40"
									role="treeitem"
									aria-selected="false"
									tabindex="0"
								>
									<Icon class="h-3 w-3 shrink-0 text-muted-foreground/70" />
									<span class="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80"
										>{col}</span
									>
									<span class="shrink-0 font-mono text-[10px] text-muted-foreground/60">
										{columnTypeLabel(table.columnTypes?.[i] ?? '')}
									</span>
								</div>
							</ContextMenu.Trigger>
							<ContextMenu.Content class="w-40">
								<ContextMenu.Item onclick={() => copyToClipboard(col)}>
									<Copy class="mr-2 h-3.5 w-3.5" />
									Copy name
								</ContextMenu.Item>
							</ContextMenu.Content>
						</ContextMenu.Root>
					{/each}
				{/if}
			{/each}
		{/if}
	</div>

	<!-- Footer hint -->
	{#if showFooter}
		<div class="shrink-0 border-t px-3 py-2">
			<p class="text-[10px] leading-relaxed text-muted-foreground/60">Right-click for options</p>
		</div>
	{/if}
</aside>
