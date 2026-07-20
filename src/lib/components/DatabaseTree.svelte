<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getDatabaseCatalog } from '$lib/services/duckdb';
	import {
		getTables,
		getExternalSchemaTables,
		getConnections,
		setExternalConnectionSchema,
		insertIntoActiveCell,
		getAttachedDatabases,
		removeAttachedDatabase
	} from '$lib/stores/notebook.svelte';
	import { fetchConnectionSchema } from '$lib/services/connections';
	import {
		Columns3,
		Copy,
		CornerDownLeft,
		Database,
		LayoutGrid,
		Loader2,
		RefreshCw,
		Table2,
		Unplug
	} from '@lucide/svelte';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import EmptyState from '$lib/components/sidebar/EmptyState.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as ContextMenu from '$lib/components/ui/context-menu';

	const tables = $derived(getTables());
	const externalSchemaTables = $derived(getExternalSchemaTables());
	const attachedDatabases = $derived(getAttachedDatabases());
	const attachedAliases = $derived(new Set(attachedDatabases.map((d) => d.alias)));

	// Row-count lookup by table name for store-tracked tables (uploaded files)
	const uploadedRowCounts = $derived(new Map(tables.map((t) => [t.name, t.rowCount])));

	let catalog = $state<Awaited<ReturnType<typeof getDatabaseCatalog>>>([]);
	let expandedDb = $state<Record<string, boolean>>({});
	let expandedSchema = $state<Record<string, boolean>>({});
	let expandedTable = $state<Record<string, boolean>>({});
	let loading = $state(true);
	let refreshingIds = $state(new Set<string>());

	const externalCatalog = $derived.by(() => {
		const grouped = new Map<
			string,
			{ id: string; name: string; schemas: Map<string, typeof externalSchemaTables> }
		>();
		for (const table of externalSchemaTables) {
			let entry = grouped.get(table.connectionId);
			if (!entry) {
				entry = { id: table.connectionId, name: table.connectionName, schemas: new Map() };
				grouped.set(table.connectionId, entry);
			}
			const schema = table.schema || 'public';
			const list = entry.schemas.get(schema) ?? [];
			entry.schemas.set(schema, [...list, table]);
		}
		return [...grouped.values()]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((entry) => ({
				...entry,
				schemas: [...entry.schemas.entries()]
					.sort((a, b) => a[0].localeCompare(b[0]))
					.map(
						([schema, schemaTables]) =>
							[schema, [...schemaTables].sort((a, b) => a.name.localeCompare(b.name))] as const
					)
			}));
	});

	async function loadCatalog() {
		try {
			const next = await getDatabaseCatalog();
			// Auto-expand databases and schemas that are new
			for (const db of next) {
				const dbKey = `duckdb:${db.name}`;
				if (!(dbKey in expandedDb)) expandedDb[dbKey] = true;
				for (const schema of db.schemas) {
					const schemaKey = `${dbKey}.${schema.name}`;
					if (!(schemaKey in expandedSchema)) expandedSchema[schemaKey] = true;
				}
			}
			catalog = next;
		} catch {
			catalog = [];
		} finally {
			loading = false;
		}
	}

	// Re-fetch whenever the uploaded tables list or attached databases change
	$effect(() => {
		void tables.length;
		void attachedDatabases.length;
		loadCatalog();
	});

	async function refreshExternalSchema(connectionId: string): Promise<void> {
		const connection = getConnections().find((c) => c.id === connectionId);
		if (!connection || connection.type === 'duckdb-wasm') return;
		refreshingIds = new Set([...refreshingIds, connectionId]);
		try {
			const result = await fetchConnectionSchema(connection);
			setExternalConnectionSchema(connection.id, connection.name, result.tables);
		} catch {
			// stale schema stays visible
		} finally {
			refreshingIds = new Set([...refreshingIds].filter((id) => id !== connectionId));
		}
	}

	function toggleDatabase(key: string) {
		expandedDb[key] = !(expandedDb[key] ?? false);
		if (key.startsWith('external:')) {
			void refreshExternalSchema(key.slice('external:'.length));
		} else {
			void loadCatalog();
		}
	}

	function toggleSchema(dbKey: string, schema: string) {
		const key = `${dbKey}.${schema}`;
		expandedSchema[key] = !(expandedSchema[key] ?? true);
	}

	function toggleTable(key: string) {
		expandedTable[key] = !(expandedTable[key] ?? false);
	}

	// Chunk long expanded levels (a schema with hundreds of tables, a very wide
	// table) instead of rendering every child row at once.
	const TREE_CHUNK = 200;
	let chunkLimits = $state<Record<string, number>>({});
	function limitFor(key: string): number {
		return chunkLimits[key] ?? TREE_CHUNK;
	}
	function showMore(key: string) {
		chunkLimits[key] = limitFor(key) + TREE_CHUNK;
	}

	function fmtRows(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
		return String(n);
	}

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text).catch(() => {});
	}

	// Refresh all external schemas — debounced to at most once per 30s
	let lastFocusRefresh = 0;
	async function refreshAllExternalSchemas(): Promise<void> {
		const now = Date.now();
		if (now - lastFocusRefresh < 30_000) return;
		lastFocusRefresh = now;
		const connections = getConnections().filter((c) => c.type !== 'duckdb-wasm');
		for (const connection of connections) {
			try {
				const result = await fetchConnectionSchema(connection);
				setExternalConnectionSchema(connection.id, connection.name, result.tables);
			} catch {
				// keep stale schema
			}
		}
	}

	function handleVisibilityChange() {
		if (document.visibilityState === 'visible') {
			void refreshAllExternalSchemas();
		}
	}

	onMount(() => {
		document.addEventListener('visibilitychange', handleVisibilityChange);
	});

	onDestroy(() => {
		document.removeEventListener('visibilitychange', handleVisibilityChange);
	});
</script>

{#snippet dbRow(
	name: string,
	meta: string | undefined,
	expanded: boolean,
	onToggle: () => void,
	refreshing: boolean = false,
	onRefresh: (() => void) | undefined = undefined,
	attached: boolean = false
)}
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			<TreeRow depth={0} expandable {expanded} onActivate={onToggle}>
				{#snippet icon()}
					<Database class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				{/snippet}
				{#snippet label()}
					<span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">{name}</span>
				{/snippet}
				{#snippet trailing()}
					{#if refreshing}
						<Loader2 class="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
					{:else if meta}
						<span class="shrink-0 text-2xs text-muted-foreground">{meta}</span>
					{/if}
				{/snippet}
			</TreeRow>
		</ContextMenu.Trigger>
		<ContextMenu.Content class="w-44">
			<ContextMenu.Item onclick={() => (onRefresh ?? loadCatalog)()} disabled={refreshing}>
				<RefreshCw class="h-3.5 w-3.5" />
				Refresh
			</ContextMenu.Item>
			<ContextMenu.Separator />
			<ContextMenu.Item onclick={() => copyToClipboard(name)}>
				<Copy class="h-3.5 w-3.5" />
				Copy name
			</ContextMenu.Item>
			{#if attached}
				<ContextMenu.Separator />
				<ContextMenu.Item onclick={() => removeAttachedDatabase(name)} class="text-destructive">
					<Unplug class="h-3.5 w-3.5" />
					Detach database
				</ContextMenu.Item>
			{/if}
		</ContextMenu.Content>
	</ContextMenu.Root>
{/snippet}

{#snippet schemaRow(
	name: string,
	count: number,
	expanded: boolean,
	onToggle: () => void,
	dbName: string
)}
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			<TreeRow depth={1} expandable {expanded} onActivate={onToggle}>
				{#snippet icon()}
					<LayoutGrid class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				{/snippet}
				{#snippet label()}
					<span class="min-w-0 flex-1 truncate text-xs text-foreground/80">{name}</span>
				{/snippet}
				{#snippet trailing()}
					{#if count > 0}
						<span class="shrink-0 text-2xs text-muted-foreground">{count}</span>
					{/if}
				{/snippet}
			</TreeRow>
		</ContextMenu.Trigger>
		<ContextMenu.Content class="w-48">
			<ContextMenu.Item onclick={() => copyToClipboard(name)}>
				<Copy class="h-3.5 w-3.5" />
				Copy schema name
			</ContextMenu.Item>
			<ContextMenu.Item onclick={() => copyToClipboard(`${dbName}.${name}`)}>
				<Copy class="h-3.5 w-3.5" />
				Copy qualified name
			</ContextMenu.Item>
		</ContextMenu.Content>
	</ContextMenu.Root>
{/snippet}

{#snippet tableRow(
	name: string,
	meta: string | undefined,
	expanded: boolean,
	onToggle: () => void,
	qualifiedName: string
)}
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			<TreeRow depth={2} expandable {expanded} onActivate={onToggle}>
				{#snippet icon()}
					<Table2 class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				{/snippet}
				{#snippet label()}
					<span class="min-w-0 flex-1 truncate text-xs text-foreground/80">{name}</span>
				{/snippet}
				{#snippet trailing()}
					{#if meta}
						<span class="shrink-0 text-2xs text-muted-foreground">{meta}</span>
					{/if}
				{/snippet}
			</TreeRow>
		</ContextMenu.Trigger>
		<ContextMenu.Content class="w-56">
			<ContextMenu.Label class="pb-0.5 text-2xs text-muted-foreground/70"
				>{qualifiedName}</ContextMenu.Label
			>
			<ContextMenu.Separator />
			<ContextMenu.Item onclick={() => insertIntoActiveCell(qualifiedName)}>
				<CornerDownLeft class="h-3.5 w-3.5" />
				Insert reference
			</ContextMenu.Item>
			<ContextMenu.Item
				onclick={() => insertIntoActiveCell(`SELECT *\nFROM ${qualifiedName}\nLIMIT 100`)}
			>
				<CornerDownLeft class="h-3.5 w-3.5" />
				Insert SELECT *
			</ContextMenu.Item>
			<ContextMenu.Item onclick={() => insertIntoActiveCell(`from ${qualifiedName}\ntake 100`)}>
				<CornerDownLeft class="h-3.5 w-3.5" />
				Insert PRQL from
			</ContextMenu.Item>
			<ContextMenu.Separator />
			<ContextMenu.Item onclick={() => copyToClipboard(name)}>
				<Copy class="h-3.5 w-3.5" />
				Copy table name
			</ContextMenu.Item>
			<ContextMenu.Item onclick={() => copyToClipboard(qualifiedName)}>
				<Copy class="h-3.5 w-3.5" />
				Copy qualified name
			</ContextMenu.Item>
		</ContextMenu.Content>
	</ContextMenu.Root>
{/snippet}

{#snippet columnRow(name: string, type?: string, qualifiedCol?: string)}
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			<TreeRow depth={3} class="cursor-default hover:bg-transparent" tabindex={-1}>
				{#snippet icon()}
					<Columns3 class="h-3 w-3 shrink-0 text-muted-foreground/70" />
				{/snippet}
				{#snippet label()}
					<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">{name}</span>
				{/snippet}
				{#snippet trailing()}
					{#if type}
						<span class="shrink-0 font-mono text-2xs text-muted-foreground/70">{type}</span>
					{/if}
				{/snippet}
			</TreeRow>
		</ContextMenu.Trigger>
		<ContextMenu.Content class="w-48">
			<ContextMenu.Item onclick={() => insertIntoActiveCell(name)}>
				<CornerDownLeft class="h-3.5 w-3.5" />
				Insert column name
			</ContextMenu.Item>
			{#if qualifiedCol}
				<ContextMenu.Item onclick={() => insertIntoActiveCell(qualifiedCol)}>
					<CornerDownLeft class="h-3.5 w-3.5" />
					Insert qualified
				</ContextMenu.Item>
			{/if}
			<ContextMenu.Separator />
			<ContextMenu.Item onclick={() => copyToClipboard(name)}>
				<Copy class="h-3.5 w-3.5" />
				Copy column name
			</ContextMenu.Item>
			{#if type}
				<ContextMenu.Item onclick={() => copyToClipboard(type)}>
					<Copy class="h-3.5 w-3.5" />
					Copy type
				</ContextMenu.Item>
			{/if}
		</ContextMenu.Content>
	</ContextMenu.Root>
{/snippet}

{#snippet showMoreRow(key: string, total: number, depth: number)}
	{#if total > limitFor(key)}
		<button
			type="button"
			class="w-full py-0.5 text-left text-2xs text-muted-foreground/80 transition-colors hover:text-foreground {depth ===
			3
				? 'pl-14'
				: 'pl-10'}"
			onclick={() => showMore(key)}
		>
			Show {Math.min(TREE_CHUNK, total - limitFor(key))} more ({(
				total - limitFor(key)
			).toLocaleString()} hidden)
		</button>
	{/if}
{/snippet}

<div class="flex h-full flex-col overflow-hidden">
	<div class="sidebar-tree-scroll">
		{#if loading}
			{#each [80, 60, 72, 48, 64] as width, i (i)}
				<div class="mx-1 flex h-7 items-center gap-1.5 px-2">
					<Skeleton class="h-3 w-3 shrink-0 rounded-sm" />
					<Skeleton class="h-3 rounded-sm" style="width: {width}%" />
				</div>
			{/each}
		{:else if catalog.length === 0 && externalCatalog.length === 0}
			<EmptyState description="Upload a file or add a connection to browse tables here.">
				{#snippet icon()}<Database class="h-4 w-4" />{/snippet}
			</EmptyState>
		{:else}
			<!-- DuckDB databases from catalog -->
			{#each catalog as db (db.name)}
				{@const dbKey = `duckdb:${db.name}`}
				{@const dbExpanded = expandedDb[dbKey] ?? true}
				{@const tableCount = db.schemas.reduce((n, s) => n + s.tables.length, 0)}
				{@render dbRow(
					db.name,
					`${tableCount} ${tableCount === 1 ? 'table' : 'tables'}`,
					dbExpanded,
					() => toggleDatabase(dbKey),
					false,
					loadCatalog,
					attachedAliases.has(db.name)
				)}

				{#if dbExpanded}
					{#each db.schemas as schema (schema.name)}
						{@const schemaKey = `${dbKey}.${schema.name}`}
						{@const schemaExpanded = expandedSchema[schemaKey] ?? true}
						{@render schemaRow(
							schema.name,
							schema.tables.length,
							schemaExpanded,
							() => toggleSchema(dbKey, schema.name),
							db.name
						)}

						{#if schemaExpanded}
							{#if schema.tables.length === 0}
								<p class="py-0.5 pl-14 text-2xs text-muted-foreground/70 italic">Empty</p>
							{/if}
							{#each schema.tables.slice(0, limitFor(schemaKey)) as table (table.name)}
								{@const tableKey = `${schemaKey}.${table.name}`}
								{@const tableExpanded = expandedTable[tableKey] ?? false}
								{@const rowCount = uploadedRowCounts.get(table.name)}
								{@render tableRow(
									table.name,
									rowCount !== undefined ? fmtRows(rowCount) : undefined,
									tableExpanded,
									() => toggleTable(tableKey),
									schema.name === 'main' ? table.name : `${schema.name}.${table.name}`
								)}

								{#if tableExpanded}
									{#each table.columns.slice(0, limitFor(tableKey)) as col (col.name)}
										{@render columnRow(col.name, col.type, `${table.name}.${col.name}`)}
									{/each}
									{@render showMoreRow(tableKey, table.columns.length, 3)}
								{/if}
							{/each}
							{@render showMoreRow(schemaKey, schema.tables.length, 2)}
						{/if}
					{/each}
				{/if}
			{/each}

			<!-- External database connections -->
			{#each externalCatalog as entry (entry.id)}
				{@const dbKey = `external:${entry.id}`}
				{@const dbExpanded = expandedDb[dbKey] ?? true}
				{@const isRefreshing = refreshingIds.has(entry.id)}
				{@render dbRow(
					entry.name,
					undefined,
					dbExpanded,
					() => toggleDatabase(dbKey),
					isRefreshing,
					() => refreshExternalSchema(entry.id)
				)}

				{#if dbExpanded}
					{#each entry.schemas as [schema, schemaTables] (schema)}
						{@const schemaKey = `${dbKey}.${schema}`}
						{@const schemaExpanded = expandedSchema[schemaKey] ?? true}
						{@render schemaRow(
							schema,
							schemaTables.length,
							schemaExpanded,
							() => toggleSchema(dbKey, schema),
							entry.name
						)}

						{#if schemaExpanded}
							{#each schemaTables.slice(0, limitFor(schemaKey)) as table (table.name)}
								{@const rawName =
									table.schema && table.name.startsWith(`${table.schema}.`)
										? table.name.slice(table.schema.length + 1)
										: table.name}
								{@const tableNodeKey = `${entry.id}:${schema}:${table.name}`}
								{@const tableExpanded = expandedTable[tableNodeKey] ?? false}
								{@render tableRow(
									rawName,
									undefined,
									tableExpanded,
									() => toggleTable(tableNodeKey),
									`${schema}.${rawName}`
								)}

								{#if tableExpanded}
									{#each table.columns.slice(0, limitFor(tableNodeKey)) as column, colIdx (column)}
										{@render columnRow(column, table.columnTypes[colIdx], `${rawName}.${column}`)}
									{/each}
									{@render showMoreRow(tableNodeKey, table.columns.length, 3)}
								{/if}
							{/each}
							{@render showMoreRow(schemaKey, schemaTables.length, 2)}
						{/if}
					{/each}
				{/if}
			{/each}
		{/if}
	</div>
</div>
