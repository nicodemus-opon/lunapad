<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getDatabaseCatalog, type CatalogTable } from '$lib/services/duckdb';
	import { getTables, getExternalSchemaTables, getConnections, getConnectionSecret, setExternalConnectionSchema } from '$lib/stores/notebook.svelte';
	import { fetchConnectionSchema } from '$lib/services/connections';
	import { ChevronRight, Columns3, Database, LayoutGrid, RefreshCw, Table2 } from '@lucide/svelte';

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
		const grouped = new Map<string, { id: string; name: string; schemas: Map<string, typeof externalSchemaTables> }>();
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
					.map(([schema, schemaTables]) => [
						schema,
						[...schemaTables].sort((a, b) => a.name.localeCompare(b.name))
					] as const)
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

<div class="flex h-full flex-col overflow-hidden">
	<div class="flex-1 overflow-y-auto py-1">
		{#if loading}
			<p class="px-3 py-3 text-xs text-muted-foreground italic">Loading…</p>
		{:else if catalog.length === 0 && externalCatalog.length === 0}
			<p class="px-3 py-4 text-xs text-muted-foreground italic text-center">No databases found.</p>
		{:else}

			<!-- DuckDB databases from catalog -->
			{#each catalog as db (db.name)}
				{@const dbKey = `duckdb:${db.name}`}
				{@const dbExpanded = expandedDb[dbKey] ?? true}
				<!-- Database row -->
				<div
					class="mx-1 flex cursor-pointer select-none items-center gap-1.5 rounded-sm py-1 pl-2 pr-2 hover:bg-muted/50 transition-colors"
					role="treeitem"
					aria-expanded={dbExpanded}
					aria-selected="false"
					tabindex="0"
					onclick={() => toggleDatabase(dbKey)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleDatabase(dbKey); }}
				>
					<ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground transition-transform {dbExpanded ? 'rotate-90' : ''}" />
					<Database class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
					<span class="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90">{db.name}</span>
					<span class="shrink-0 text-[10px] text-muted-foreground/40">{db.schemas.reduce((n, s) => n + s.tables.length, 0)} tables</span>
				</div>

				{#if dbExpanded}
					{#each db.schemas as schema (schema.name)}
						{@const schemaKey = `${dbKey}.${schema.name}`}
						{@const schemaExpanded = expandedSchema[schemaKey] ?? true}
						<!-- Schema row -->
						<div
							class="mx-1 flex cursor-pointer select-none items-center gap-1.5 rounded-sm py-0.5 pr-2 hover:bg-muted/40 transition-colors"
							style="padding-left: 22px"
							role="treeitem"
							aria-expanded={schemaExpanded}
							aria-selected="false"
							tabindex="0"
							onclick={() => toggleSchema(dbKey, schema.name)}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSchema(dbKey, schema.name); }}
						>
							<span class="h-4 w-px shrink-0 bg-border/70 mr-0.5" aria-hidden="true"></span>
							<ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground transition-transform {schemaExpanded ? 'rotate-90' : ''}" />
							<LayoutGrid class="h-3 w-3 shrink-0 text-muted-foreground/60" />
							<span class="min-w-0 flex-1 truncate text-[12px] text-foreground/80">{schema.name}</span>
							{#if schema.tables.length > 0}
								<span class="shrink-0 text-[10px] text-muted-foreground/40">{schema.tables.length}</span>
							{/if}
						</div>

						{#if schemaExpanded}
							{#if schema.tables.length === 0}
								<p class="text-[11px] text-muted-foreground/40 italic" style="padding-left: 58px; padding-top: 2px; padding-bottom: 4px;">Empty</p>
							{/if}
							{#each schema.tables as table (table.name)}
								{@const tableKey = `${schemaKey}.${table.name}`}
								{@const tableExpanded = expandedTable[tableKey] ?? false}
								{@const rowCount = uploadedRowCounts.get(table.name)}
								<!-- Table row -->
								<div
									class="mx-1 flex cursor-pointer select-none items-center gap-1.5 rounded-sm py-0.5 pr-2 hover:bg-muted/35 transition-colors"
									style="padding-left: 42px"
									role="treeitem"
									aria-expanded={tableExpanded}
									aria-selected="false"
									tabindex="0"
									onclick={() => toggleTable(tableKey)}
									onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleTable(tableKey); }}
								>
									<span class="h-4 w-px shrink-0 bg-border/50 mr-0.5" aria-hidden="true"></span>
									<ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground transition-transform {tableExpanded ? 'rotate-90' : ''}" />
									<Table2 class="h-3 w-3 shrink-0 text-muted-foreground/60" />
									<span class="min-w-0 flex-1 truncate text-xs text-foreground/80">{table.name}</span>
									{#if rowCount !== undefined}
										<span class="shrink-0 text-[10px] text-muted-foreground/40">{fmtRows(rowCount)}</span>
									{/if}
								</div>

								{#if tableExpanded}
									{#each table.columns as col (col.name)}
										<div
											class="mx-1 flex select-none items-center gap-1.5 rounded-sm py-0.5 pr-2"
											style="padding-left: 62px"
											role="treeitem"
											aria-selected="false"
											tabindex="-1"
										>
											<span class="h-4 w-px shrink-0 bg-border/40 mr-0.5" aria-hidden="true"></span>
											<Columns3 class="h-3 w-3 shrink-0 text-muted-foreground/50" />
											<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground/80">{col.name}</span>
											<span class="shrink-0 text-[10px] text-muted-foreground/40 font-mono">{col.type}</span>
										</div>
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
				<div
					class="mx-1 flex cursor-pointer select-none items-center gap-1.5 rounded-sm py-1 pl-2 pr-2 hover:bg-muted/50 transition-colors"
					role="treeitem"
					aria-expanded={dbExpanded}
					aria-selected="false"
					tabindex="0"
					onclick={() => toggleDatabase(dbKey)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleDatabase(dbKey); }}
				>
					<ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground transition-transform {dbExpanded ? 'rotate-90' : ''}" />
					<Database class="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
					<span class="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/90">{entry.name}</span>
					{#if isRefreshing}
						<RefreshCw class="h-3 w-3 shrink-0 text-muted-foreground/50 animate-spin" />
					{/if}
				</div>

				{#if dbExpanded}
					{#each entry.schemas as [schema, schemaTables] (schema)}
						{@const schemaKey = `${dbKey}.${schema}`}
						{@const schemaExpanded = expandedSchema[schemaKey] ?? true}
						<div
							class="mx-1 flex cursor-pointer select-none items-center gap-1.5 rounded-sm py-0.5 pr-2 hover:bg-muted/40 transition-colors"
							style="padding-left: 22px"
							role="treeitem"
							aria-expanded={schemaExpanded}
							aria-selected="false"
							tabindex="0"
							onclick={() => toggleSchema(dbKey, schema)}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSchema(dbKey, schema); }}
						>
							<span class="h-4 w-px shrink-0 bg-border/70 mr-0.5" aria-hidden="true"></span>
							<ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground transition-transform {schemaExpanded ? 'rotate-90' : ''}" />
							<LayoutGrid class="h-3 w-3 shrink-0 text-muted-foreground/60" />
							<span class="min-w-0 flex-1 truncate text-[12px] text-foreground/80">{schema}</span>
							{#if schemaTables.length > 0}
								<span class="shrink-0 text-[10px] text-muted-foreground/40">{schemaTables.length}</span>
							{/if}
						</div>

						{#if schemaExpanded}
							{#each schemaTables as table (table.name)}
								{@const rawName = table.schema && table.name.startsWith(`${table.schema}.`)
									? table.name.slice(table.schema.length + 1)
									: table.name}
								{@const tableNodeKey = `${entry.id}:${schema}:${table.name}`}
								{@const tableExpanded = expandedTable[tableNodeKey] ?? false}
								<div
									class="mx-1 flex cursor-pointer select-none items-center gap-1.5 rounded-sm py-0.5 pr-2 hover:bg-muted/35 transition-colors"
									style="padding-left: 42px"
									role="treeitem"
									aria-expanded={tableExpanded}
									aria-selected="false"
									tabindex="0"
									onclick={() => toggleTable(tableNodeKey)}
									onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleTable(tableNodeKey); }}
								>
									<span class="h-4 w-px shrink-0 bg-border/50 mr-0.5" aria-hidden="true"></span>
									<ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground transition-transform {tableExpanded ? 'rotate-90' : ''}" />
									<Table2 class="h-3 w-3 shrink-0 text-muted-foreground/60" />
									<span class="min-w-0 flex-1 truncate text-xs text-foreground/80">{rawName}</span>
								</div>

								{#if tableExpanded}
									{#each table.columns as column, colIdx (column)}
										<div
											class="mx-1 flex select-none items-center gap-1.5 rounded-sm py-0.5 pr-2"
											style="padding-left: 62px"
											role="treeitem"
											aria-selected="false"
											tabindex="-1"
										>
											<span class="h-4 w-px shrink-0 bg-border/40 mr-0.5" aria-hidden="true"></span>
											<Columns3 class="h-3 w-3 shrink-0 text-muted-foreground/50" />
											<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground/80">{column}</span>
											{#if table.columnTypes[colIdx]}
												<span class="shrink-0 text-[10px] text-muted-foreground/40 font-mono">{table.columnTypes[colIdx]}</span>
											{/if}
										</div>
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
