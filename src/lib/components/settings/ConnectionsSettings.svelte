<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import {
		testConnection,
		fetchConnectionSchema,
		removeConnectionSource
	} from '$lib/services/connections';
	import {
		getConnections,
		setExternalConnectionSchema,
		removeConnection,
		setConnectionSecret,
		upsertConnection
	} from '$lib/stores/notebook.svelte';
	import {
		BUILTIN_DUCKDB_CONNECTION_ID,
		slugifyCatalogName,
		type ClickHouseConnection,
		type Connection,
		type MySQLDataSource,
		type PostgresConnection,
		type PostgresSSLMode
	} from '$lib/types/connection';
	import { toast } from 'svelte-sonner';
	import { Save, PlugZap, Trash2, CheckCircle2 } from '@lucide/svelte';

	type FormType = 'postgres' | 'clickhouse' | 'mysql';

	interface ConnectionForm {
		id: string | null;
		type: FormType;
		name: string;
		catalogName: string;
		host: string;
		port: string;
		database: string;
		username: string;
		/** For Postgres: 'disable' | 'require' | 'verify-full'. For ClickHouse/MySQL: 'false' | 'true'. */
		secure: 'false' | 'true' | PostgresSSLMode;
		password: string;
	}

	const connections = $derived(getConnections());
	const externalConnections = $derived(
		connections.filter((connection) => connection.id !== BUILTIN_DUCKDB_CONNECTION_ID)
	);

	let editingId = $state<string | null>(null);
	let saving = $state(false);
	let testing = $state(false);
	let loadingSchema = $state(false);

	let form = $state<ConnectionForm>({
		id: null,
		type: 'postgres',
		name: 'Local Postgres',
		catalogName: 'local_postgres',
		host: 'localhost',
		port: '5432',
		database: 'postgres',
		username: 'postgres',
		secure: 'disable',
		password: ''
	});

	// Auto-populate catalogName from name when creating a new source
	$effect(() => {
		if (!editingId) {
			form.catalogName = slugifyCatalogName(form.name);
		}
	});

	function makeId(prefix: string): string {
		return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
	}

	function defaultsForType(type: FormType): Partial<ConnectionForm> {
		if (type === 'clickhouse')
			return { port: '8123', database: 'default', username: 'default', secure: 'false' };
		if (type === 'mysql')
			return { port: '3306', database: 'mydb', username: 'root', secure: 'false' };
		return { port: '5432', database: 'postgres', username: 'postgres', secure: 'disable' };
	}

	function resetForm(): void {
		editingId = null;
		form = {
			id: null,
			type: 'postgres',
			name: 'Local Postgres',
			catalogName: 'local_postgres',
			host: 'localhost',
			port: '5432',
			database: 'postgres',
			username: 'postgres',
			secure: 'disable',
			password: ''
		};
	}

	function editConnection(connection: Connection): void {
		if (
			connection.type !== 'postgres' &&
			connection.type !== 'clickhouse' &&
			connection.type !== 'mysql'
		)
			return;
		if (editingId === connection.id) return;

		editingId = connection.id;
		let secure: ConnectionForm['secure'];
		if (connection.type === 'postgres') {
			secure = connection.ssl ? (connection.sslMode ?? 'require') : 'disable';
		} else if (connection.type === 'clickhouse') {
			secure = connection.secure ? 'true' : 'false';
		} else {
			secure = connection.ssl ? 'true' : 'false';
		}

		form = {
			id: connection.id,
			type: connection.type,
			name: connection.name,
			catalogName: connection.catalogName,
			host: connection.host,
			port: String(connection.port),
			database: connection.database,
			username: connection.username,
			secure,
			// Secrets are write-only once saved — leave blank to keep the stored password.
			password: ''
		};
	}

	function validateCatalogName(value: string): boolean {
		return /^[a-z][a-z0-9_]{0,63}$/.test(value);
	}

	function buildConnectionFromForm(): PostgresConnection | ClickHouseConnection | MySQLDataSource {
		const port = Number(form.port);
		if (!Number.isFinite(port) || port <= 0)
			throw new Error('Port must be a valid positive number.');
		if (!form.name.trim() || !form.host.trim() || !form.database.trim() || !form.username.trim()) {
			throw new Error('Name, host, database, and username are required.');
		}
		if (!validateCatalogName(form.catalogName)) {
			throw new Error(
				'Source ID must start with a letter and contain only lowercase letters, digits, and underscores (max 64 chars).'
			);
		}

		if (form.type === 'clickhouse') {
			return {
				id: form.id ?? makeId('ch'),
				name: form.name.trim(),
				type: 'clickhouse',
				catalogName: form.catalogName,
				host: form.host.trim(),
				port,
				database: form.database.trim(),
				username: form.username.trim(),
				secure: form.secure === 'true'
			};
		}

		if (form.type === 'mysql') {
			return {
				id: form.id ?? makeId('mysql'),
				name: form.name.trim(),
				type: 'mysql',
				catalogName: form.catalogName,
				host: form.host.trim(),
				port,
				database: form.database.trim(),
				username: form.username.trim(),
				ssl: form.secure === 'true'
			};
		}

		const pgSslMode = form.secure as PostgresSSLMode;
		return {
			id: form.id ?? makeId('pg'),
			name: form.name.trim(),
			type: 'postgres',
			catalogName: form.catalogName,
			host: form.host.trim(),
			port,
			database: form.database.trim(),
			username: form.username.trim(),
			ssl: pgSslMode !== 'disable',
			sslMode: pgSslMode !== 'disable' ? pgSslMode : undefined
		};
	}

	// When the form password field is empty (e.g. after a successful save clears it),
	async function runConnectionTest(): Promise<void> {
		testing = true;
		try {
			const connection = buildConnectionFromForm();
			const formPassword = form.password.trim();
			// If left blank, the server falls back to the already-saved secret (if any).
			await testConnection(connection, formPassword ? { password: formPassword } : undefined);
			toast.success(`Source ready: ${connection.name}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Source test failed.');
		} finally {
			testing = false;
		}
	}

	async function runSchemaPreview(): Promise<void> {
		loadingSchema = true;
		try {
			// Schema discovery always reads the secret server-side, so this only works for
			// an already-saved connection (a brand new one gets its first discovery via Save).
			const connection = buildConnectionFromForm();
			const result = await fetchConnectionSchema(connection);
			setExternalConnectionSchema(connection.id, connection.name, result.tables);
			toast.success(`${result.tables.length} tables discovered`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Table discovery failed.');
		} finally {
			loadingSchema = false;
		}
	}

	async function saveConnection(): Promise<void> {
		saving = true;
		try {
			const connection = buildConnectionFromForm();
			const formPassword = form.password.trim();

			// Register with Trino (writes catalog file + waits for catalog to appear).
			// Validates the password before anything gets persisted.
			await testConnection(connection, formPassword ? { password: formPassword } : undefined);

			// Only update the stored secret when the user explicitly typed a new password.
			// If the field was empty, the previously-saved secret (if any) is left as-is.
			if (formPassword) {
				await setConnectionSecret(connection.id, { password: formPassword });
			}

			// Discover schema now that the catalog (and secret, if new) are in place.
			const schema = await fetchConnectionSchema(connection);

			upsertConnection(connection);
			setExternalConnectionSchema(connection.id, connection.name, schema.tables);

			toast.success(`Source ready: ${connection.name} · ${schema.tables.length} tables discovered`);

			// Clear password from form — it's now in the server-side secret store.
			// Don't leave plaintext credentials sitting in component state.
			form = { ...form, password: '' };

			if (!editingId) {
				form = { ...form, id: connection.id };
				editingId = connection.id;
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to register source.');
		} finally {
			saving = false;
		}
	}

	async function deleteCurrentConnection(): Promise<void> {
		if (!editingId) return;
		const connection = connections.find((c) => c.id === editingId);
		if (connection && connection.type !== 'duckdb-wasm') {
			await removeConnectionSource(connection);
		}
		removeConnection(editingId);
		toast.success('Source removed');
		resetForm();
	}

	function typeLabel(type: FormType): string {
		if (type === 'postgres') return 'Postgres';
		if (type === 'clickhouse') return 'ClickHouse';
		return 'MySQL';
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between gap-2">
		<h2 class="text-sm font-semibold">Data sources</h2>
		<Button variant="outline" size="sm" class="h-7 px-2 text-2xs" onclick={resetForm}>
			Add source
		</Button>
	</div>

	{#if externalConnections.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each externalConnections as connection (connection.id)}
				<button
					class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-2xs hover:bg-accent {editingId ===
					connection.id
						? 'border-primary/60 bg-accent'
						: ''}"
					onclick={() => editConnection(connection)}
				>
					{#if connection.type === 'postgres' || connection.type === 'clickhouse' || connection.type === 'mysql'}
						<CheckCircle2 class="h-2.5 w-2.5 text-chart-1" />
					{/if}
					<span class="font-mono">{connection.name}</span>
				</button>
			{/each}
		</div>
	{/if}

	<div class="space-y-2 rounded border bg-background p-2">
		<div class="grid grid-cols-2 gap-2">
			<div class="col-span-2">
				<label for="connection-type" class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
					>Type</label
				>
				<Select.Root
					type="single"
					value={form.type}
					onValueChange={(value) => {
						const t = value as FormType;
						form = { ...form, type: t, ...defaultsForType(t) };
					}}
				>
					<Select.Trigger id="connection-type" class="h-7 text-xs"
						>{typeLabel(form.type)}</Select.Trigger
					>
					<Select.Content>
						<Select.Item value="postgres" class="text-xs">Postgres</Select.Item>
						<Select.Item value="clickhouse" class="text-xs">ClickHouse</Select.Item>
						<Select.Item value="mysql" class="text-xs">MySQL</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>

			<div class="col-span-2">
				<label for="connection-name" class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
					>Name</label
				>
				<Input
					id="connection-name"
					class="h-7 font-mono text-xs"
					bind:value={form.name}
					placeholder="My database"
				/>
			</div>

			<div class="col-span-2">
				<label
					for="connection-catalog"
					class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Source ID</label
				>
				<Input
					id="connection-catalog"
					class="h-7 font-mono text-xs"
					bind:value={form.catalogName}
					placeholder="my_database"
					disabled={!!editingId}
				/>
				{#if !editingId}
					<p class="mt-0.5 text-2xs text-muted-foreground/70">
						Use in cross-source queries: <span class="font-mono"
							>{form.catalogName || '…'}.schema.table</span
						>
					</p>
				{:else}
					<p class="mt-0.5 text-2xs text-muted-foreground/70">
						Fixed after creation · reference as <span class="font-mono"
							>{form.catalogName}.schema.table</span
						>
					</p>
				{/if}
			</div>

			<div>
				<label for="connection-host" class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
					>Host</label
				>
				<Input
					id="connection-host"
					class="h-7 font-mono text-xs"
					bind:value={form.host}
					placeholder="localhost"
				/>
				{#if form.host === 'localhost' || form.host === '127.0.0.1'}
					<p class="mt-0.5 text-2xs text-warning">
						Running via Docker? Use <span class="font-mono">host.docker.internal</span>
						(Mac/Windows) or the service name (e.g. <span class="font-mono">db</span>) instead.
					</p>
				{/if}
			</div>
			<div>
				<label for="connection-port" class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
					>Port</label
				>
				<Input
					id="connection-port"
					class="h-7 font-mono text-xs"
					bind:value={form.port}
					placeholder="5432"
				/>
			</div>

			<div>
				<label
					for="connection-database"
					class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Database</label
				>
				<Input
					id="connection-database"
					class="h-7 font-mono text-xs"
					bind:value={form.database}
					placeholder="postgres"
				/>
			</div>
			<div>
				<label
					for="connection-username"
					class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Username</label
				>
				<Input
					id="connection-username"
					class="h-7 font-mono text-xs"
					bind:value={form.username}
					placeholder="postgres"
				/>
			</div>

			<div>
				<label
					for="connection-password"
					class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Password</label
				>
				<Input
					id="connection-password"
					type="password"
					class="h-7 font-mono text-xs"
					bind:value={form.password}
					placeholder={editingId ? 'Leave blank to keep current password' : 'Password'}
				/>
			</div>
			<div>
				<label
					for="connection-secure"
					class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
					>{form.type === 'postgres' ? 'SSL' : 'TLS'}</label
				>
				{#if form.type === 'postgres'}
					{@const pgSecureLabel =
						form.secure === 'disable'
							? 'Disabled'
							: form.secure === 'verify-full'
								? 'Enabled (verify cert)'
								: 'Enabled (no cert check)'}
					<Select.Root
						type="single"
						value={form.secure}
						onValueChange={(value) => (form.secure = value as PostgresSSLMode)}
					>
						<Select.Trigger id="connection-secure" class="h-7 text-xs">{pgSecureLabel}</Select.Trigger>
						<Select.Content>
							<Select.Item value="disable" class="text-xs">Disabled</Select.Item>
							<Select.Item value="require" class="text-xs">Enabled (no cert check)</Select.Item>
							<Select.Item value="verify-full" class="text-xs">Enabled (verify cert)</Select.Item>
						</Select.Content>
					</Select.Root>
				{:else}
					<Select.Root
						type="single"
						value={form.secure}
						onValueChange={(value) => (form.secure = value as 'false' | 'true')}
					>
						<Select.Trigger id="connection-secure" class="h-7 text-xs"
							>{form.secure === 'true' ? 'Enabled' : 'Disabled'}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="false" class="text-xs">Disabled</Select.Item>
							<Select.Item value="true" class="text-xs">Enabled</Select.Item>
						</Select.Content>
					</Select.Root>
				{/if}
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-1.5 pt-1">
			<Button
				variant="outline"
				size="sm"
				class="h-7 gap-1 px-2 text-2xs"
				disabled={testing}
				onclick={runConnectionTest}
			>
				<PlugZap class="h-3 w-3" />
				{testing ? 'Connecting...' : 'Test'}
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-7 px-2 text-2xs"
				disabled={loadingSchema}
				onclick={runSchemaPreview}
			>
				{loadingSchema ? 'Discovering tables...' : 'Tables'}
			</Button>
			<Button size="sm" class="h-7 gap-1 px-2 text-2xs" disabled={saving} onclick={saveConnection}>
				<Save class="h-3 w-3" />
				{saving ? 'Registering...' : 'Save'}
			</Button>
			{#if editingId}
				<Button
					variant="destructive"
					size="sm"
					class="h-7 gap-1 px-2 text-2xs"
					onclick={deleteCurrentConnection}
				>
					<Trash2 class="h-3 w-3" />
					Delete
				</Button>
			{/if}
		</div>
	</div>
</div>
