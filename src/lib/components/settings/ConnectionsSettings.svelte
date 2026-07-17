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
		type ConnectionSecret,
		type MariaDBConnection,
		type MySQLDataSource,
		type OracleIdentifierType,
		type PostgresConnection,
		type PostgresSSLMode,
		type RedshiftConnection,
		type SingleStoreConnection,
		type MongoDBConnection,
		type ElasticsearchConnection,
		type SQLServerConnection,
		type OracleConnection,
		type SnowflakeConnection,
		type CassandraConnection,
		type GoogleSheetsConnection,
		type BigQueryConnection
	} from '$lib/types/connection';
	import { toast } from 'svelte-sonner';
	import { Save, PlugZap, Trash2, CheckCircle2 } from '@lucide/svelte';

	type FormType =
		| 'postgres'
		| 'clickhouse'
		| 'mysql'
		| 'mariadb'
		| 'sqlserver'
		| 'oracle'
		| 'redshift'
		| 'snowflake'
		| 'singlestore'
		| 'cassandra'
		| 'gsheets'
		| 'mongodb'
		| 'elasticsearch'
		| 'bigquery';

	type FieldGroup = 'standard' | 'oracle' | 'snowflake' | 'cassandra' | 'gsheets' | 'bigquery';

	function fieldGroupFor(type: FormType): FieldGroup {
		if (type === 'oracle') return 'oracle';
		if (type === 'snowflake') return 'snowflake';
		if (type === 'cassandra') return 'cassandra';
		if (type === 'gsheets') return 'gsheets';
		if (type === 'bigquery') return 'bigquery';
		return 'standard';
	}

	interface ConnectionForm {
		id: string | null;
		type: FormType;
		name: string;
		catalogName: string;
		// Standard group (postgres/clickhouse/mysql/mariadb/redshift/singlestore/mongodb/elasticsearch/sqlserver)
		host: string;
		port: string;
		database: string;
		username: string;
		/** For Postgres: 'disable' | 'require' | 'verify-full'. For other standard-group types: 'false' | 'true'. */
		secure: 'false' | 'true' | PostgresSSLMode;
		password: string;
		// SQL Server only
		trustServerCertificate: 'false' | 'true';
		// Oracle only
		identifierType: OracleIdentifierType;
		serviceName: string;
		// Snowflake only
		account: string;
		warehouse: string;
		role: string;
		// Cassandra only
		contactPoints: string;
		localDatacenter: string;
		// Google Sheets only
		metadataSheetId: string;
		credentialsJson: string;
		// BigQuery only (also uses credentialsJson above)
		projectId: string;
		parentProjectId: string;
	}

	const connections = $derived(getConnections());
	const externalConnections = $derived(
		connections.filter((connection) => connection.id !== BUILTIN_DUCKDB_CONNECTION_ID)
	);

	let editingId = $state<string | null>(null);
	let saving = $state(false);
	let testing = $state(false);
	let loadingSchema = $state(false);
	let operationError = $state<string | null>(null);

	function emptyForm(type: FormType = 'postgres'): ConnectionForm {
		return {
			id: null,
			type,
			name: 'Local Postgres',
			catalogName: 'local_postgres',
			host: 'localhost',
			port: '5432',
			database: 'postgres',
			username: 'postgres',
			secure: 'disable',
			password: '',
			trustServerCertificate: 'false',
			identifierType: 'service_name',
			serviceName: '',
			account: '',
			warehouse: '',
			role: '',
			contactPoints: '',
			localDatacenter: 'datacenter1',
			metadataSheetId: '',
			credentialsJson: '',
			projectId: '',
			parentProjectId: ''
		};
	}

	let form = $state<ConnectionForm>(emptyForm());
	const group = $derived(fieldGroupFor(form.type));

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
		if (type === 'mariadb')
			return { port: '3306', database: 'mydb', username: 'root', secure: 'false' };
		if (type === 'redshift')
			return { port: '5439', database: 'dev', username: 'awsuser', secure: 'true' };
		if (type === 'singlestore')
			return { port: '3306', database: 'mydb', username: 'root', secure: 'true' };
		if (type === 'mongodb')
			return { port: '27017', database: 'mydb', username: '', secure: 'false' };
		if (type === 'elasticsearch') return { port: '9200', database: 'default', username: '' };
		if (type === 'sqlserver')
			return {
				port: '1433',
				database: 'master',
				username: 'sa',
				secure: 'true',
				trustServerCertificate: 'true'
			};
		if (type === 'oracle')
			return {
				port: '1521',
				username: 'system',
				identifierType: 'service_name',
				serviceName: 'ORCLPDB1'
			};
		if (type === 'snowflake')
			return { warehouse: 'COMPUTE_WH', database: 'MYDB', username: '', role: '' };
		if (type === 'cassandra')
			return { port: '9042', contactPoints: '', localDatacenter: 'datacenter1', username: '' };
		if (type === 'gsheets') return { metadataSheetId: '', credentialsJson: '' };
		if (type === 'bigquery') return { projectId: '', parentProjectId: '', credentialsJson: '' };
		return { port: '5432', database: 'postgres', username: 'postgres', secure: 'disable' };
	}

	function resetForm(): void {
		editingId = null;
		form = emptyForm();
	}

	function editConnection(connection: Connection): void {
		if (connection.type === 'duckdb-wasm') return;
		if (editingId === connection.id) return;
		editingId = connection.id;

		if (connection.type === 'oracle') {
			form = {
				...emptyForm('oracle'),
				id: connection.id,
				name: connection.name,
				catalogName: connection.catalogName,
				host: connection.host,
				port: String(connection.port),
				username: connection.username,
				identifierType: connection.identifierType,
				serviceName: connection.serviceName
			};
			return;
		}

		if (connection.type === 'snowflake') {
			form = {
				...emptyForm('snowflake'),
				id: connection.id,
				name: connection.name,
				catalogName: connection.catalogName,
				account: connection.account,
				warehouse: connection.warehouse,
				database: connection.database,
				username: connection.username,
				role: connection.role ?? ''
			};
			return;
		}

		if (connection.type === 'cassandra') {
			form = {
				...emptyForm('cassandra'),
				id: connection.id,
				name: connection.name,
				catalogName: connection.catalogName,
				contactPoints: connection.contactPoints,
				port: String(connection.port),
				localDatacenter: connection.localDatacenter,
				username: connection.username ?? ''
			};
			return;
		}

		if (connection.type === 'gsheets') {
			form = {
				...emptyForm('gsheets'),
				id: connection.id,
				name: connection.name,
				catalogName: connection.catalogName,
				metadataSheetId: connection.metadataSheetId,
				// Credentials are write-only once saved — leave blank to keep the stored value.
				credentialsJson: ''
			};
			return;
		}

		if (connection.type === 'bigquery') {
			form = {
				...emptyForm('bigquery'),
				id: connection.id,
				name: connection.name,
				catalogName: connection.catalogName,
				projectId: connection.projectId,
				parentProjectId: connection.parentProjectId ?? '',
				// Credentials are write-only once saved — leave blank to keep the stored value.
				credentialsJson: ''
			};
			return;
		}

		// Standard group: postgres, clickhouse, mysql, mariadb, redshift, singlestore, mongodb, elasticsearch, sqlserver
		let secure: ConnectionForm['secure'] = 'false';
		let trustServerCertificate: ConnectionForm['trustServerCertificate'] = 'false';
		if (connection.type === 'postgres') {
			secure = connection.ssl ? (connection.sslMode ?? 'require') : 'disable';
		} else if (connection.type === 'clickhouse') {
			secure = connection.secure ? 'true' : 'false';
		} else if (connection.type === 'sqlserver') {
			secure = connection.encrypt ? 'true' : 'false';
			trustServerCertificate = connection.trustServerCertificate ? 'true' : 'false';
		} else if (connection.type === 'elasticsearch') {
			secure = 'false';
		} else {
			secure = connection.ssl ? 'true' : 'false';
		}

		form = {
			...emptyForm(connection.type),
			id: connection.id,
			name: connection.name,
			catalogName: connection.catalogName,
			host: connection.host,
			port: String(connection.port),
			database: connection.database,
			username: connection.username ?? '',
			secure,
			trustServerCertificate,
			// Secrets are write-only once saved — leave blank to keep the stored password.
			password: ''
		};
	}

	function validateCatalogName(value: string): boolean {
		return /^[a-z][a-z0-9_]{0,63}$/.test(value);
	}

	function parsePort(value: string): number {
		const port = Number(value);
		if (!Number.isFinite(port) || port <= 0)
			throw new Error('Port must be a valid positive number.');
		return port;
	}

	function buildConnectionFromForm(): Connection {
		if (!form.name.trim()) throw new Error('Name is required.');
		if (!validateCatalogName(form.catalogName)) {
			throw new Error(
				'Source ID must start with a letter and contain only lowercase letters, digits, and underscores (max 64 chars).'
			);
		}

		if (form.type === 'gsheets') {
			if (!form.metadataSheetId.trim()) throw new Error('Metadata sheet ID is required.');
			return {
				id: form.id ?? makeId('gsheets'),
				name: form.name.trim(),
				type: 'gsheets',
				catalogName: form.catalogName,
				metadataSheetId: form.metadataSheetId.trim()
			} satisfies GoogleSheetsConnection;
		}

		if (form.type === 'bigquery') {
			if (!form.projectId.trim()) throw new Error('Project ID is required.');
			return {
				id: form.id ?? makeId('bq'),
				name: form.name.trim(),
				type: 'bigquery',
				catalogName: form.catalogName,
				projectId: form.projectId.trim(),
				parentProjectId: form.parentProjectId.trim() || undefined
			} satisfies BigQueryConnection;
		}

		if (form.type === 'snowflake') {
			if (
				!form.account.trim() ||
				!form.warehouse.trim() ||
				!form.database.trim() ||
				!form.username.trim()
			) {
				throw new Error('Account, warehouse, database, and username are required.');
			}
			return {
				id: form.id ?? makeId('sf'),
				name: form.name.trim(),
				type: 'snowflake',
				catalogName: form.catalogName,
				account: form.account.trim(),
				warehouse: form.warehouse.trim(),
				database: form.database.trim(),
				username: form.username.trim(),
				role: form.role.trim() || undefined
			} satisfies SnowflakeConnection;
		}

		if (form.type === 'cassandra') {
			if (!form.contactPoints.trim() || !form.localDatacenter.trim()) {
				throw new Error('Contact points and local datacenter are required.');
			}
			const port = parsePort(form.port);
			return {
				id: form.id ?? makeId('cass'),
				name: form.name.trim(),
				type: 'cassandra',
				catalogName: form.catalogName,
				contactPoints: form.contactPoints.trim(),
				port,
				localDatacenter: form.localDatacenter.trim(),
				username: form.username.trim() || undefined
			} satisfies CassandraConnection;
		}

		if (form.type === 'oracle') {
			if (!form.host.trim() || !form.username.trim() || !form.serviceName.trim()) {
				throw new Error('Host, username, and SID/Service Name are required.');
			}
			const port = parsePort(form.port);
			return {
				id: form.id ?? makeId('ora'),
				name: form.name.trim(),
				type: 'oracle',
				catalogName: form.catalogName,
				host: form.host.trim(),
				port,
				username: form.username.trim(),
				identifierType: form.identifierType,
				serviceName: form.serviceName.trim()
			} satisfies OracleConnection;
		}

		// Standard group
		const port = parsePort(form.port);
		if (!form.host.trim()) throw new Error('Host is required.');
		if (!form.database.trim()) throw new Error('Database is required.');
		if (form.type !== 'elasticsearch' && !form.username.trim()) {
			throw new Error('Username is required.');
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
			} satisfies ClickHouseConnection;
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
			} satisfies MySQLDataSource;
		}

		if (form.type === 'mariadb') {
			return {
				id: form.id ?? makeId('maria'),
				name: form.name.trim(),
				type: 'mariadb',
				catalogName: form.catalogName,
				host: form.host.trim(),
				port,
				database: form.database.trim(),
				username: form.username.trim(),
				ssl: form.secure === 'true'
			} satisfies MariaDBConnection;
		}

		if (form.type === 'redshift') {
			return {
				id: form.id ?? makeId('rs'),
				name: form.name.trim(),
				type: 'redshift',
				catalogName: form.catalogName,
				host: form.host.trim(),
				port,
				database: form.database.trim(),
				username: form.username.trim(),
				ssl: form.secure === 'true'
			} satisfies RedshiftConnection;
		}

		if (form.type === 'singlestore') {
			return {
				id: form.id ?? makeId('ss'),
				name: form.name.trim(),
				type: 'singlestore',
				catalogName: form.catalogName,
				host: form.host.trim(),
				port,
				database: form.database.trim(),
				username: form.username.trim(),
				ssl: form.secure === 'true'
			} satisfies SingleStoreConnection;
		}

		if (form.type === 'mongodb') {
			return {
				id: form.id ?? makeId('mongo'),
				name: form.name.trim(),
				type: 'mongodb',
				catalogName: form.catalogName,
				host: form.host.trim(),
				port,
				database: form.database.trim(),
				username: form.username.trim(),
				ssl: form.secure === 'true'
			} satisfies MongoDBConnection;
		}

		if (form.type === 'elasticsearch') {
			return {
				id: form.id ?? makeId('es'),
				name: form.name.trim(),
				type: 'elasticsearch',
				catalogName: form.catalogName,
				host: form.host.trim(),
				port,
				database: form.database.trim(),
				username: form.username.trim() || undefined
			} satisfies ElasticsearchConnection;
		}

		if (form.type === 'sqlserver') {
			return {
				id: form.id ?? makeId('mssql'),
				name: form.name.trim(),
				type: 'sqlserver',
				catalogName: form.catalogName,
				host: form.host.trim(),
				port,
				database: form.database.trim(),
				username: form.username.trim(),
				encrypt: form.secure === 'true',
				trustServerCertificate: form.trustServerCertificate === 'true'
			} satisfies SQLServerConnection;
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
		} satisfies PostgresConnection;
	}

	// Google Sheets and BigQuery authenticate via a service-account JSON blob instead of a password.
	function buildSecretFromForm(): ConnectionSecret | undefined {
		if (form.type === 'gsheets' || form.type === 'bigquery') {
			const json = form.credentialsJson.trim();
			return json ? { credentialsJson: json } : undefined;
		}
		const formPassword = form.password.trim();
		return formPassword ? { password: formPassword } : undefined;
	}

	async function runConnectionTest(): Promise<void> {
		testing = true;
		operationError = null;
		try {
			const connection = buildConnectionFromForm();
			// If left blank, the server falls back to the already-saved secret (if any).
			await testConnection(connection, buildSecretFromForm());
			toast.success(`Source ready: ${connection.name}`);
		} catch (err) {
			operationError = err instanceof Error ? err.message : 'Source test failed.';
			toast.error(operationError);
		} finally {
			testing = false;
		}
	}

	async function runSchemaPreview(): Promise<void> {
		loadingSchema = true;
		operationError = null;
		try {
			// Schema discovery always reads the secret server-side, so this only works for
			// an already-saved connection (a brand new one gets its first discovery via Save).
			const connection = buildConnectionFromForm();
			const result = await fetchConnectionSchema(connection);
			setExternalConnectionSchema(connection.id, connection.name, result.tables);
			toast.success(`${result.tables.length} tables discovered`);
		} catch (err) {
			operationError = err instanceof Error ? err.message : 'Table discovery failed.';
			toast.error(operationError);
		} finally {
			loadingSchema = false;
		}
	}

	async function saveConnection(): Promise<void> {
		saving = true;
		operationError = null;
		try {
			const connection = buildConnectionFromForm();
			const secret = buildSecretFromForm();

			// Register with Trino (writes catalog file + waits for catalog to appear).
			// Validates credentials before anything gets persisted.
			await testConnection(connection, secret);

			// Only update the stored secret when the user explicitly entered a new one.
			// If the field was empty, the previously-saved secret (if any) is left as-is.
			if (secret) {
				await setConnectionSecret(connection.id, secret);
			}

			// Discover schema now that the catalog (and secret, if new) are in place.
			const schema = await fetchConnectionSchema(connection);

			upsertConnection(connection);
			setExternalConnectionSchema(connection.id, connection.name, schema.tables);

			toast.success(`Source ready: ${connection.name} · ${schema.tables.length} tables discovered`);

			// Clear secret fields from the form — they're now in the server-side secret store.
			// Don't leave plaintext credentials sitting in component state.
			form = { ...form, password: '', credentialsJson: '' };

			if (!editingId) {
				form = { ...form, id: connection.id };
				editingId = connection.id;
			}
		} catch (err) {
			operationError = err instanceof Error ? err.message : 'Failed to register source.';
			toast.error(operationError);
		} finally {
			saving = false;
		}
	}

	async function deleteCurrentConnection(): Promise<void> {
		if (!editingId) return;
		operationError = null;
		try {
			const connection = connections.find((c) => c.id === editingId);
			if (connection && connection.type !== 'duckdb-wasm') {
				await removeConnectionSource(connection);
			}
			removeConnection(editingId);
			toast.success('Source removed');
			resetForm();
		} catch (err) {
			operationError = err instanceof Error ? err.message : 'Failed to remove source.';
			toast.error(operationError);
		}
	}

	function typeLabel(type: FormType): string {
		switch (type) {
			case 'postgres':
				return 'Postgres';
			case 'clickhouse':
				return 'ClickHouse';
			case 'mysql':
				return 'MySQL';
			case 'mariadb':
				return 'MariaDB';
			case 'sqlserver':
				return 'SQL Server';
			case 'oracle':
				return 'Oracle';
			case 'redshift':
				return 'Redshift';
			case 'snowflake':
				return 'Snowflake';
			case 'singlestore':
				return 'SingleStore';
			case 'cassandra':
				return 'Cassandra';
			case 'gsheets':
				return 'Google Sheets';
			case 'mongodb':
				return 'MongoDB';
			case 'elasticsearch':
				return 'Elasticsearch';
			case 'bigquery':
				return 'BigQuery';
		}
	}
</script>

<div class="space-y-4">
	<div class="flex items-start justify-between gap-3">
		<div>
			<h2 class="text-sm font-semibold">Data sources</h2>
			<p class="mt-1 text-xs text-muted-foreground">
				Add warehouses and files that notebooks can query alongside DuckDB.
			</p>
		</div>
		<Button variant="outline" size="sm" class="h-7 px-2 text-2xs" onclick={resetForm}>
			Add source
		</Button>
	</div>

	{#if operationError}
		<p class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
			{operationError}
		</p>
	{/if}

	{#if externalConnections.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each externalConnections as connection (connection.id)}
				<button
					class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-2xs hover:bg-accent {editingId ===
					connection.id
						? 'border-primary bg-accent'
						: ''}"
					onclick={() => editConnection(connection)}
				>
					<CheckCircle2 class="h-2.5 w-2.5 text-success" />
					<span class="font-mono">{connection.name}</span>
				</button>
			{/each}
		</div>
	{:else}
		<p class="rounded-md border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
			No external sources yet. DuckDB is always available; add a warehouse when you need live data.
		</p>
	{/if}

	<div class="space-y-3 rounded-md border border-border bg-background p-3">
		<div class="grid gap-2 sm:grid-cols-2">
			<div class="sm:col-span-2">
				<label
					for="connection-type"
					class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Type</label
				>
				<Select.Root
					type="single"
					value={form.type}
					onValueChange={(value) => {
						const t = value as FormType;
						form = {
							...emptyForm(t),
							id: form.id,
							name: form.name,
							catalogName: form.catalogName,
							...defaultsForType(t)
						};
					}}
				>
					<Select.Trigger id="connection-type" class="h-7 text-xs"
						>{typeLabel(form.type)}</Select.Trigger
					>
					<Select.Content>
						<Select.Group>
							<Select.GroupHeading class="text-2xs">Relational</Select.GroupHeading>
							<Select.Item value="postgres" class="text-xs">Postgres</Select.Item>
							<Select.Item value="mysql" class="text-xs">MySQL</Select.Item>
							<Select.Item value="mariadb" class="text-xs">MariaDB</Select.Item>
							<Select.Item value="sqlserver" class="text-xs">SQL Server</Select.Item>
							<Select.Item value="oracle" class="text-xs">Oracle</Select.Item>
							<Select.Item value="redshift" class="text-xs">Redshift</Select.Item>
							<Select.Item value="singlestore" class="text-xs">SingleStore</Select.Item>
							<Select.Item value="snowflake" class="text-xs">Snowflake</Select.Item>
						</Select.Group>
						<Select.Group>
							<Select.GroupHeading class="text-2xs">NoSQL / Search</Select.GroupHeading>
							<Select.Item value="mongodb" class="text-xs">MongoDB</Select.Item>
							<Select.Item value="cassandra" class="text-xs">Cassandra</Select.Item>
							<Select.Item value="elasticsearch" class="text-xs">Elasticsearch</Select.Item>
						</Select.Group>
						<Select.Group>
							<Select.GroupHeading class="text-2xs">Other</Select.GroupHeading>
							<Select.Item value="clickhouse" class="text-xs">ClickHouse</Select.Item>
							<Select.Item value="gsheets" class="text-xs">Google Sheets</Select.Item>
							<Select.Item value="bigquery" class="text-xs">BigQuery</Select.Item>
						</Select.Group>
					</Select.Content>
				</Select.Root>
			</div>

			<div class="sm:col-span-2">
				<label
					for="connection-name"
					class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Name</label
				>
				<Input
					id="connection-name"
					class="h-7 font-mono text-xs"
					bind:value={form.name}
					placeholder="My database"
				/>
			</div>

			<div class="sm:col-span-2">
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

			{#if group === 'gsheets'}
				<div class="sm:col-span-2">
					<label
						for="connection-sheet-id"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Metadata sheet ID</label
					>
					<Input
						id="connection-sheet-id"
						class="h-7 font-mono text-xs"
						bind:value={form.metadataSheetId}
						placeholder="1Yt0... (the metadata sheet's URL ID)"
					/>
					<p class="mt-0.5 text-2xs text-muted-foreground/70">
						A sheet with columns Table Name, Sheet ID — shared with the service account below.
					</p>
				</div>
				<div class="sm:col-span-2">
					<label
						for="connection-credentials"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Service account JSON</label
					>
					<textarea
						id="connection-credentials"
						class="h-20 w-full rounded border bg-background p-1.5 font-mono text-2xs"
						bind:value={form.credentialsJson}
						placeholder={editingId
							? 'Leave blank to keep current credentials'
							: 'Paste service-account JSON'}
					></textarea>
				</div>
			{:else if group === 'bigquery'}
				<div>
					<label
						for="connection-project-id"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Project ID</label
					>
					<Input
						id="connection-project-id"
						class="h-7 font-mono text-xs"
						bind:value={form.projectId}
						placeholder="my-gcp-project"
					/>
				</div>
				<div>
					<label
						for="connection-parent-project-id"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Billing project (optional)</label
					>
					<Input
						id="connection-parent-project-id"
						class="h-7 font-mono text-xs"
						bind:value={form.parentProjectId}
						placeholder="my-billing-project"
					/>
				</div>
				<div class="sm:col-span-2">
					<label
						for="connection-credentials"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Service account JSON</label
					>
					<textarea
						id="connection-credentials"
						class="h-20 w-full rounded border bg-background p-1.5 font-mono text-2xs"
						bind:value={form.credentialsJson}
						placeholder={editingId
							? 'Leave blank to keep current credentials'
							: 'Paste service-account JSON'}
					></textarea>
				</div>
			{:else if group === 'snowflake'}
				<div>
					<label
						for="connection-account"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Account</label
					>
					<Input
						id="connection-account"
						class="h-7 font-mono text-xs"
						bind:value={form.account}
						placeholder="xy12345.us-east-1"
					/>
				</div>
				<div>
					<label
						for="connection-warehouse"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Warehouse</label
					>
					<Input
						id="connection-warehouse"
						class="h-7 font-mono text-xs"
						bind:value={form.warehouse}
						placeholder="COMPUTE_WH"
					/>
				</div>
				<div>
					<label
						for="connection-database"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Database</label
					>
					<Input
						id="connection-database"
						class="h-7 font-mono text-xs"
						bind:value={form.database}
						placeholder="MYDB"
					/>
				</div>
				<div>
					<label
						for="connection-role"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Role (optional)</label
					>
					<Input
						id="connection-role"
						class="h-7 font-mono text-xs"
						bind:value={form.role}
						placeholder="ANALYST"
					/>
				</div>
				<div>
					<label
						for="connection-username"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Username</label
					>
					<Input
						id="connection-username"
						class="h-7 font-mono text-xs"
						bind:value={form.username}
					/>
				</div>
				<div>
					<label
						for="connection-password"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Password</label
					>
					<Input
						id="connection-password"
						type="password"
						class="h-7 font-mono text-xs"
						bind:value={form.password}
						placeholder={editingId ? 'Leave blank to keep current password' : 'Password'}
					/>
				</div>
			{:else if group === 'cassandra'}
				<div class="sm:col-span-2">
					<label
						for="connection-contact-points"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Contact points</label
					>
					<Input
						id="connection-contact-points"
						class="h-7 font-mono text-xs"
						bind:value={form.contactPoints}
						placeholder="10.0.0.1,10.0.0.2"
					/>
					<p class="mt-0.5 text-2xs text-muted-foreground/70">
						Comma-separated cluster contact-point hosts.
					</p>
				</div>
				<div>
					<label
						for="connection-port"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Port</label
					>
					<Input
						id="connection-port"
						class="h-7 font-mono text-xs"
						bind:value={form.port}
						placeholder="9042"
					/>
				</div>
				<div>
					<label
						for="connection-local-dc"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Local datacenter</label
					>
					<Input
						id="connection-local-dc"
						class="h-7 font-mono text-xs"
						bind:value={form.localDatacenter}
						placeholder="datacenter1"
					/>
				</div>
				<div>
					<label
						for="connection-username"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Username (optional)</label
					>
					<Input
						id="connection-username"
						class="h-7 font-mono text-xs"
						bind:value={form.username}
					/>
				</div>
				<div>
					<label
						for="connection-password"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Password (optional)</label
					>
					<Input
						id="connection-password"
						type="password"
						class="h-7 font-mono text-xs"
						bind:value={form.password}
						placeholder={editingId ? 'Leave blank to keep current password' : 'Password'}
					/>
				</div>
			{:else if group === 'oracle'}
				<div>
					<label
						for="connection-host"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Host</label
					>
					<Input
						id="connection-host"
						class="h-7 font-mono text-xs"
						bind:value={form.host}
						placeholder="localhost"
					/>
				</div>
				<div>
					<label
						for="connection-port"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Port</label
					>
					<Input
						id="connection-port"
						class="h-7 font-mono text-xs"
						bind:value={form.port}
						placeholder="1521"
					/>
				</div>
				<div>
					<label
						for="connection-identifier-type"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Identifier type</label
					>
					<Select.Root
						type="single"
						value={form.identifierType}
						onValueChange={(value) => (form.identifierType = value as OracleIdentifierType)}
					>
						<Select.Trigger id="connection-identifier-type" class="h-7 text-xs"
							>{form.identifierType === 'sid' ? 'SID' : 'Service Name'}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="service_name" class="text-xs">Service Name</Select.Item>
							<Select.Item value="sid" class="text-xs">SID</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<div>
					<label
						for="connection-service-name"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>{form.identifierType === 'sid' ? 'SID' : 'Service Name'}</label
					>
					<Input
						id="connection-service-name"
						class="h-7 font-mono text-xs"
						bind:value={form.serviceName}
						placeholder="ORCLPDB1"
					/>
				</div>
				<div>
					<label
						for="connection-username"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Username</label
					>
					<Input
						id="connection-username"
						class="h-7 font-mono text-xs"
						bind:value={form.username}
					/>
				</div>
				<div>
					<label
						for="connection-password"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>Password</label
					>
					<Input
						id="connection-password"
						type="password"
						class="h-7 font-mono text-xs"
						bind:value={form.password}
						placeholder={editingId ? 'Leave blank to keep current password' : 'Password'}
					/>
				</div>
			{:else}
				<div>
					<label
						for="connection-host"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Host</label
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
					<label
						for="connection-port"
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase">Port</label
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
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>{form.type === 'elasticsearch' ? 'Default schema' : 'Database'}</label
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
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>{form.type === 'elasticsearch' ? 'Username (optional)' : 'Username'}</label
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
						class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
						>{form.type === 'elasticsearch' ? 'Password (optional)' : 'Password'}</label
					>
					<Input
						id="connection-password"
						type="password"
						class="h-7 font-mono text-xs"
						bind:value={form.password}
						placeholder={editingId ? 'Leave blank to keep current password' : 'Password'}
					/>
				</div>
				{#if form.type !== 'elasticsearch'}
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
								<Select.Trigger id="connection-secure" class="h-7 text-xs"
									>{pgSecureLabel}</Select.Trigger
								>
								<Select.Content>
									<Select.Item value="disable" class="text-xs">Disabled</Select.Item>
									<Select.Item value="require" class="text-xs">Enabled (no cert check)</Select.Item>
									<Select.Item value="verify-full" class="text-xs"
										>Enabled (verify cert)</Select.Item
									>
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
				{/if}
				{#if form.type === 'sqlserver' && form.secure === 'true'}
					<div>
						<label
							for="connection-trust-cert"
							class="mb-1 block text-2xs tracking-wide text-muted-foreground uppercase"
							>Trust server certificate</label
						>
						<Select.Root
							type="single"
							value={form.trustServerCertificate}
							onValueChange={(value) => (form.trustServerCertificate = value as 'false' | 'true')}
						>
							<Select.Trigger id="connection-trust-cert" class="h-7 text-xs"
								>{form.trustServerCertificate === 'true'
									? 'Trusted'
									: 'Verify cert'}</Select.Trigger
							>
							<Select.Content>
								<Select.Item value="true" class="text-xs">Trusted (no cert check)</Select.Item>
								<Select.Item value="false" class="text-xs">Verify cert</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
				{/if}
			{/if}
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
