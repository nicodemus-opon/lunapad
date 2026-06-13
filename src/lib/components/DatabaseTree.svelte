<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getDatabaseCatalog } from '$lib/services/duckdb';
	import {
		getTables,
		getExternalSchemaTables,
		getConnections,
		getConnectionSecret,
		setExternalConnectionSchema
	} from '$lib/stores/notebook.svelte';
	import { fetchConnectionSchema } from '$lib/services/connections';
	import { Columns3, Database, LayoutGrid, RefreshCw, Table2 } from '@lucide/svelte';
	import TreeRow from '$lib/components/sidebar/TreeRow.svelte';
	import EmptyState from '$lib/components/sidebar/EmptyState.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton';

	const tables = $derived(getTables());
	const externalSchemaTables = $derived(getExternalSchemaTables());

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

	// Re-fetch whenever the uploaded tables list changes
	$effect(() => {
		void tables.length;
		loadCatalog();
	});

	async function refreshExternalSchema(connectionId: string): Promise<void> {
		const connection = getConnections().find((c) => c.id === connectionId);
		if (!connection || connection.type === 'duckdb-wasm') return;
		refreshingIds = new Set([...refreshingIds, connectionId]);
		try {
			const secret = getConnectionSecret(connectionId);
			const result = await fetchConnectionSchema(connection, secret);
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

	function fmtRows(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
		return String(n);
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
				const secret = getConnectionSecret(connection.id);
				const result = await fetchConnectionSchema(connection, secret);
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
	refreshing: boolean = false
)}
	<TreeRow depth={0} expandable {expanded} onActivate={onToggle}>
		{#snippet icon()}
			<Database class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
		{/snippet}
		{#snippet label()}
			<span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">{name}</span>
		{/snippet}
		{#snippet trailing()}
			{#if refreshing}
				<RefreshCw class="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
			{:else if meta}
				<span class="shrink-0 text-2xs text-muted-foreground">{meta}</span>
			{/if}
		{/snippet}
	</TreeRow>
{/snippet}

{#snippet schemaRow(name: string, count: number, expanded: boolean, onToggle: () => void)}
	<TreeRow depth={1} expandable {expanded} onActivate={onToggle}>
		{#snippet icon()}
			<LayoutGrid class="h-3 w-3 shrink-0 text-muted-foreground" />
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
{/snippet}

{#snippet tableRow(name: string, meta: string | undefined, expanded: boolean, onToggle: () => void)}
	<TreeRow depth={2} expandable {expanded} onActivate={onToggle}>
		{#snippet icon()}
			<Table2 class="h-3 w-3 shrink-0 text-muted-foreground" />
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
{/snippet}

{#snippet columnRow(name: string, type?: string)}
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
{/snippet}

<div class="flex h-full flex-col overflow-hidden">
	<div class="flex-1 overflow-y-auto py-1">
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
					() => toggleDatabase(dbKey)
				)}

				{#if dbExpanded}
					{#each db.schemas as schema (schema.name)}
						{@const schemaKey = `${dbKey}.${schema.name}`}
						{@const schemaExpanded = expandedSchema[schemaKey] ?? true}
						{@render schemaRow(schema.name, schema.tables.length, schemaExpanded, () =>
							toggleSchema(dbKey, schema.name)
						)}

						{#if schemaExpanded}
							{#if schema.tables.length === 0}
								<p class="py-0.5 pl-14 text-2xs text-muted-foreground/70 italic">Empty</p>
							{/if}
							{#each schema.tables as table (table.name)}
								{@const tableKey = `${schemaKey}.${table.name}`}
								{@const tableExpanded = expandedTable[tableKey] ?? false}
								{@const rowCount = uploadedRowCounts.get(table.name)}
								{@render tableRow(
									table.name,
									rowCount !== undefined ? fmtRows(rowCount) : undefined,
									tableExpanded,
									() => toggleTable(tableKey)
								)}

								{#if tableExpanded}
									{#each table.columns as col (col.name)}
										{@render columnRow(col.name, col.type)}
									{/each}
								{/if}
							{/each}
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
					isRefreshing
				)}

				{#if dbExpanded}
					{#each entry.schemas as [schema, schemaTables] (schema)}
						{@const schemaKey = `${dbKey}.${schema}`}
						{@const schemaExpanded = expandedSchema[schemaKey] ?? true}
						{@render schemaRow(schema, schemaTables.length, schemaExpanded, () =>
							toggleSchema(dbKey, schema)
						)}

						{#if schemaExpanded}
							{#each schemaTables as table (table.name)}
								{@const rawName =
									table.schema && table.name.startsWith(`${table.schema}.`)
										? table.name.slice(table.schema.length + 1)
										: table.name}
								{@const tableNodeKey = `${entry.id}:${schema}:${table.name}`}
								{@const tableExpanded = expandedTable[tableNodeKey] ?? false}
								{@render tableRow(rawName, undefined, tableExpanded, () =>
									toggleTable(tableNodeKey)
								)}

								{#if tableExpanded}
									{#each table.columns as column, colIdx (column)}
										{@render columnRow(column, table.columnTypes[colIdx])}
									{/each}
								{/if}
							{/each}
						{/if}
					{/each}
				{/if}
			{/each}
		{/if}
	</div>
</div>
