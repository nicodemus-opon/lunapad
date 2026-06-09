import fs from 'node:fs/promises';
import path from 'node:path';
import type {
	ClickHouseConnection,
	Connection,
	ConnectionSecret,
	DuckDBWASMConnection,
	MySQLDataSource,
	PostgresConnection
} from '$lib/types/connection';

export type ExternalMaterializationMode = 'table' | 'view' | 'incremental';
export type ExternalRelationType = 'table' | 'view';

interface SchemaTable {
	name: string;
	schema?: string;
	columns: string[];
	columnTypes: string[];
}

// ── Config ────────────────────────────────────────────────────────────────────

// In Docker Compose the app service sets TRINO_URL=http://trino:8080.
// Override via the TRINO_URL environment variable when running Trino elsewhere.
const TRINO_URL = (process.env.TRINO_URL ?? 'http://trino:8080').replace(/\/$/, '');

// TRINO_CATALOG_DIR must point to the directory Trino reads catalog .properties
// files from (bind-mounted into the Trino container).
// In Docker Compose it is set to /trino-catalog by the app service environment.
// Read at call time (not module init) so tests can override via process.env.
const getCatalogDir = () => process.env.TRINO_CATALOG_DIR;

// ── Trino HTTP client ─────────────────────────────────────────────────────────

interface TrinoColumn {
	name: string;
	type: string;
}

interface TrinoResponse {
	id?: string;
	nextUri?: string;
	columns?: TrinoColumn[];
	data?: unknown[][];
	error?: { message: string; errorCode?: number };
}

function buildTrinoHeaders(catalogName?: string, schema?: string): Record<string, string> {
	const headers: Record<string, string> = {
		'X-Trino-User': 'lunapad',
		'Content-Type': 'text/plain; charset=utf-8'
	};
	if (catalogName) headers['X-Trino-Catalog'] = catalogName;
	if (schema) headers['X-Trino-Schema'] = schema;
	return headers;
}

async function trinoRequest(
	sql: string,
	catalogName?: string,
	schema?: string,
	signal?: AbortSignal
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
	let response: Response;
	try {
		response = await fetch(`${TRINO_URL}/v1/statement`, {
			method: 'POST',
			headers: buildTrinoHeaders(catalogName, schema),
			body: sql,
			signal
		});
	} catch (err) {
		// Node 18+ fetch wraps the real error in err.cause
		const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
		const code = e.code ?? e.cause?.code;
		if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'UND_ERR_CONNECT_TIMEOUT') {
			throw new Error('Query engine is starting, please retry in a moment.');
		}
		throw err;
	}

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(text || `Trino request failed with status ${response.status}.`);
	}

	let result = (await response.json()) as TrinoResponse;
	if (result.error) throw new Error(result.error.message || 'Trino query error.');

	const queryId = result.id;
	let abortRequested = false;

	const abortHandler = () => {
		abortRequested = true;
		if (queryId) {
			fetch(`${TRINO_URL}/v1/query/${queryId}`, { method: 'DELETE' }).catch(() => {});
		}
	};
	signal?.addEventListener('abort', abortHandler, { once: true });

	try {
		let columns: TrinoColumn[] = [];
		const allRows: Record<string, unknown>[] = [];

		const processPage = (page: TrinoResponse) => {
			if (page.columns && columns.length === 0) columns = page.columns;
			if (page.data && columns.length > 0) {
				for (const row of page.data) {
					allRows.push(Object.fromEntries(
						columns.map((col, i) => {
							let value = (row as unknown[])[i];
							if (col.type.startsWith('varbinary') && typeof value === 'string') {
								try { value = Buffer.from(value, 'base64').toString('utf8'); } catch { /* keep original */ }
							}
							return [col.name, value];
						})
					));
				}
			}
		};

		processPage(result);

		while (result.nextUri) {
			if (abortRequested) {
				throw Object.assign(new Error('Query cancelled'), { name: 'AbortError' });
			}
			let poll: Response;
			try {
				poll = await fetch(result.nextUri, { signal });
			} catch (err) {
				const e = err as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
				const code = e.code ?? e.cause?.code;
				if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'UND_ERR_CONNECT_TIMEOUT') {
					throw new Error('Query engine is starting, please retry in a moment.');
				}
				throw err;
			}
			if (!poll.ok) {
				const text = await poll.text().catch(() => '');
				throw new Error(text || `Trino poll failed with status ${poll.status}.`);
			}
			result = (await poll.json()) as TrinoResponse;
			if (result.error) throw new Error(result.error.message || 'Trino query error.');
			processPage(result);
		}

		return { columns: columns.map((c) => c.name), rows: allRows };
	} finally {
		signal?.removeEventListener('abort', abortHandler);
	}
}

async function trinoExec(sql: string, catalogName: string, schema = 'public'): Promise<void> {
	await trinoRequest(sql, catalogName, schema);
}

// ── Catalog file management + Trino restart ───────────────────────────────────
// Trino 481 loads catalogs from .properties files at startup (catalog.management=dynamic).
// Adding a new catalog requires writing the file and restarting Trino.
// Trino's graceful shutdown API (PUT /v1/info/state) combined with Docker's
// restart: unless-stopped handles this automatically.

function escapePropertiesValue(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/\r?\n/g, '\\n')
		.replace(/\t/g, '\\t')
		.replace(/[=:#!]/g, (c) => `\\${c}`);
}

function buildCatalogFileContent(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	secret: ConnectionSecret | undefined
): string {
	const pass = escapePropertiesValue(secret?.password ?? '');

	if (connection.type === 'postgres') {
		// sslMode: 'require' = SSL without cert check; 'verify-full' = full chain + hostname
		const pgSslMode = connection.sslMode ?? 'require';
		const sslParam = connection.ssl ? `?ssl=true&sslmode=${pgSslMode}` : '';
		return [
			'connector.name=postgresql',
			`connection-url=jdbc:postgresql://${connection.host}:${connection.port}/${connection.database}${sslParam}`,
			`connection-user=${escapePropertiesValue(connection.username)}`,
			pass ? `connection-password=${pass}` : ''
		].filter(Boolean).join('\n') + '\n';
	}

	if (connection.type === 'clickhouse') {
		// sslmode=none skips cert verification — standard for private/self-signed ClickHouse deployments
		const sslParam = connection.secure ? '?ssl=true&sslmode=none' : '';
		return [
			'connector.name=clickhouse',
			`connection-url=jdbc:clickhouse://${connection.host}:${connection.port}/${connection.database}${sslParam}`,
			`connection-user=${escapePropertiesValue(connection.username)}`,
			pass ? `connection-password=${pass}` : ''
		].filter(Boolean).join('\n') + '\n';
	}

	if (connection.type === 'mysql') {
		// trustServerCertificate=true allows self-signed certs on private MySQL instances
		const sslParam = connection.ssl ? '?useSSL=true&trustServerCertificate=true' : '';
		return [
			'connector.name=mysql',
			`connection-url=jdbc:mysql://${connection.host}:${connection.port}/${connection.database}${sslParam}`,
			`connection-user=${escapePropertiesValue(connection.username)}`,
			pass ? `connection-password=${pass}` : ''
		].filter(Boolean).join('\n') + '\n';
	}

	throw new Error(`Unsupported connection type: ${(connection as Connection).type}`);
}

async function writeCatalogFile(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	secret: ConnectionSecret | undefined,
	catalogDir: string
): Promise<{ changed: boolean }> {
	const content = buildCatalogFileContent(connection, secret);
	const filePath = path.join(catalogDir, `${connection.catalogName}.properties`);

	// Read existing file to detect credential changes. If content differs, the
	// caller must restart Trino even when the catalog is already active —
	// otherwise the new credentials won't take effect until the next restart.
	let changed = true;
	try {
		const existing = await fs.readFile(filePath, 'utf-8');
		changed = existing !== content;
	} catch {
		// ENOENT or any read error → treat as new file
	}

	try {
		await fs.mkdir(catalogDir, { recursive: true });
		await fs.writeFile(filePath, content, 'utf-8');
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'EACCES' || code === 'EPERM') {
			throw new Error(
				`Cannot write to catalog directory "${catalogDir}". ` +
				`Set TRINO_CATALOG_DIR to the path mounted into the Trino container.`
			);
		}
		throw err;
	}

	return { changed };
}

async function isCatalogActive(catalogName: string): Promise<boolean> {
	try {
		const result = await trinoRequest('SHOW CATALOGS');
		return result.rows.some((r) =>
			String(Object.values(r)[0] ?? '').toLowerCase() === catalogName.toLowerCase()
		);
	} catch {
		return false;
	}
}

async function triggerTrinoRestart(): Promise<void> {
	// Graceful shutdown — Docker's restart:unless-stopped brings Trino back up
	await fetch(`${TRINO_URL}/v1/info/state`, {
		method: 'PUT',
		headers: { 'X-Trino-User': 'lunapad', 'Content-Type': 'text/plain' },
		body: 'SHUTTING_DOWN'
	}).catch(() => {}); // ignore if already shutting down
}

// Wait for Trino to go offline before polling for it to come back up.
// Without this, waitForTrinoReady() may pick up the OLD Trino instance still
// in its graceful-shutdown window and return prematurely, before the new instance
// with the freshly-written catalog files has started.
async function waitForTrinoDown(timeoutMs = 30_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			await fetch(`${TRINO_URL}/v1/info`, { signal: AbortSignal.timeout(2_000) });
			// Still responding — keep waiting
		} catch {
			return; // Connection refused or timeout: Trino is down
		}
		await new Promise((r) => setTimeout(r, 1_000));
	}
	// Timed out without detecting shutdown — proceed anyway (may already be restarting)
}

async function waitForTrinoReady(timeoutMs = 60_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const resp = await fetch(`${TRINO_URL}/v1/info`);
			if (resp.ok) {
				const info = (await resp.json()) as { starting?: boolean };
				if (!info.starting) return;
			}
		} catch {}
		await new Promise((r) => setTimeout(r, 2_000));
	}
	throw new Error('Query engine did not come back online. Run: docker compose logs trino');
}

export async function registerCatalog(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	secret: ConnectionSecret | undefined
): Promise<void> {
	if (!/^[a-z][a-z0-9_]{0,63}$/.test(connection.catalogName)) {
		throw new Error(
			`Invalid source ID "${connection.catalogName}". Must start with a lowercase letter and contain only lowercase letters, digits, and underscores (max 64 chars).`
		);
	}

	const catalogDir = getCatalogDir();
	if (!catalogDir) {
		throw new Error(
			'External connections require the Docker Compose stack. ' +
			'Run `docker compose up` to start Trino, then retry.'
		);
	}

	const { changed } = await writeCatalogFile(connection, secret, catalogDir);

	// Skip restart only when the catalog is already active AND the file content
	// didn't change. If credentials were updated we must restart so Trino picks
	// up the new catalog file — Trino reads properties only at startup.
	if (!changed && await isCatalogActive(connection.catalogName)) return;

	// Trigger graceful restart so Trino picks up the new catalog file.
	// Wait for the old instance to go offline first — otherwise waitForTrinoReady
	// may return while polling the still-running old instance (which doesn't have
	// the new catalog), causing a false "not loaded" error.
	await triggerTrinoRestart();
	await waitForTrinoDown();
	await waitForTrinoReady();

	if (!(await isCatalogActive(connection.catalogName))) {
		throw new Error(
			`Catalog "${connection.catalogName}" was not loaded after restart. ` +
			`Check the connection settings and run: docker compose logs trino`
		);
	}
}

export async function unregisterCatalog(catalogName: string): Promise<void> {
	// Remove the catalog file. The catalog remains active until the next Trino restart.
	const delDir = getCatalogDir();
	if (delDir) {
		try {
			await fs.unlink(path.join(delDir, `${catalogName}.properties`));
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
		}
	}
}

// ── SQL validation ────────────────────────────────────────────────────────────

const WRITE_KEYWORD_RE =
	/\b(insert|update|delete|drop|create|alter|truncate|replace|merge|grant|revoke|call|execute|exec|copy|vacuum|analyze|refresh|set\s+local|set\s+session|do\b)\b/i;

function assertReadableSQL(sql: string): void {
	const normalized = sql.trim().toLowerCase();
	if (!normalized) throw new Error('SQL query is required.');
	if (normalized.includes(';')) throw new Error('Only a single SQL statement is allowed.');
	if (
		!normalized.startsWith('select') &&
		!normalized.startsWith('with') &&
		!normalized.startsWith('values') &&
		!normalized.startsWith('explain')
	) {
		throw new Error('Only read-only SQL statements are allowed for external connections.');
	}
	if (WRITE_KEYWORD_RE.test(normalized)) {
		throw new Error('Only read-only SQL statements are allowed for external connections.');
	}
}

function stripTrailingSemicolon(sql: string): string {
	return sql.trim().replace(/;\s*$/, '');
}

function normalizeExternalRelationName(name: string): string {
	const normalized = name.trim();
	if (!normalized) throw new Error('Materialization target name is required.');
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
		throw new Error('Materialization target name must be a simple identifier (letters, digits, underscore).');
	}
	return normalized;
}

function normalizeExternalSchemaName(name: string): string {
	const normalized = name.trim();
	if (!normalized) throw new Error('Materialization target schema is required.');
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
		throw new Error('Materialization target schema must be a simple identifier (letters, digits, underscore).');
	}
	return normalized;
}

function normalizeMaterializeSQL(sql: string): string {
	const normalized = stripTrailingSemicolon(sql);
	if (!normalized) throw new Error('Materialization SQL is required.');
	if (normalized.includes(';')) throw new Error('Only a single SQL statement is allowed for materialization SQL.');
	return normalized;
}

// ── Identifier quoting (Trino uses standard SQL double-quote style) ───────────

function quoteTrinoIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

function quoteTrinoPath(...parts: string[]): string {
	return parts.map(quoteTrinoIdent).join('.');
}

function quoteLiteral(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

// ── Default schema per connection type ────────────────────────────────────────

function defaultSchema(connection: Exclude<Connection, DuckDBWASMConnection>): string {
	if (connection.type === 'postgres') return 'public';
	return connection.database;
}

// ── Materialization via Trino ─────────────────────────────────────────────────

async function getTrinoRelationType(
	catalogName: string,
	targetSchema: string,
	targetName: string
): Promise<ExternalRelationType | null> {
	const sql = `
		SELECT table_type
		FROM ${quoteTrinoIdent(catalogName)}.information_schema.tables
		WHERE table_schema = ${quoteLiteral(targetSchema)}
		  AND table_name = ${quoteLiteral(targetName)}
		LIMIT 1
	`;
	try {
		const result = await trinoRequest(sql, catalogName, targetSchema);
		const tableType = String(result.rows[0]?.table_type ?? '').toUpperCase();
		if (tableType === 'VIEW') return 'view';
		if (tableType === 'BASE TABLE') return 'table';
		return null;
	} catch {
		return null;
	}
}

async function materializeTrinoConnection(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	targetSchema: string,
	targetName: string,
	sql: string,
	mode: ExternalMaterializationMode
): Promise<{ name: string; type: ExternalRelationType }> {
	const catalogName = connection.catalogName;
	const ident = quoteTrinoPath(catalogName, targetSchema, targetName);
	const sourceSQL = normalizeMaterializeSQL(sql);
	const schema = defaultSchema(connection);

	if (mode === 'view') {
		const existingType = await getTrinoRelationType(catalogName, targetSchema, targetName);
		if (existingType === 'table') {
			await trinoExec(`DROP TABLE IF EXISTS ${ident}`, catalogName, schema);
		}
		await trinoExec(`CREATE OR REPLACE VIEW ${ident} AS ${sourceSQL}`, catalogName, schema);
		return { name: targetName, type: 'view' };
	}

	if (mode === 'table') {
		const existingType = await getTrinoRelationType(catalogName, targetSchema, targetName);
		if (existingType === 'view') {
			await trinoExec(`DROP VIEW IF EXISTS ${ident}`, catalogName, schema);
		} else if (existingType === 'table') {
			await trinoExec(`DROP TABLE IF EXISTS ${ident}`, catalogName, schema);
		}
		await trinoExec(`CREATE TABLE ${ident} AS ${sourceSQL}`, catalogName, schema);
		return { name: targetName, type: 'table' };
	}

	// incremental
	const existingType = await getTrinoRelationType(catalogName, targetSchema, targetName);
	if (existingType === 'view') {
		await trinoExec(`DROP VIEW IF EXISTS ${ident}`, catalogName, schema);
	}
	if (existingType !== 'table') {
		await trinoExec(`CREATE TABLE ${ident} AS ${sourceSQL}`, catalogName, schema);
		return { name: targetName, type: 'table' };
	}
	await trinoExec(`INSERT INTO ${ident} SELECT * FROM (${sourceSQL})`, catalogName, schema);
	return { name: targetName, type: 'table' };
}

// ── Public API ────────────────────────────────────────────────────────────────

// If a Trino operation fails because the catalog was lost (e.g., after restart),
// auto-register and retry once. This makes queries resilient to Trino restarts.
function isCatalogNotFoundError(err: unknown): boolean {
	const msg = String(err instanceof Error ? err.message : err).toLowerCase();
	return msg.includes('catalog') && (msg.includes('not found') || msg.includes('does not exist'));
}

export async function testExternalConnection(
	connection: Connection,
	secret?: ConnectionSecret
): Promise<{ ok: boolean }> {
	if (connection.type === 'duckdb-wasm') {
		throw new Error(`Connection type '${connection.type}' is not supported.`);
	}
	// Register (or re-register) the catalog, then verify connectivity.
	// Use information_schema.schemata instead of SELECT 1 — Trino evaluates
	// SELECT 1 in the coordinator without touching the connector, so it passes
	// even when the underlying database is unreachable.
	await registerCatalog(connection, secret);
	// Query a real catalog table so Trino must open a JDBC connection to the
	// underlying database. SELECT 1 is evaluated in the Trino coordinator and
	// passes even when the database is completely unreachable. We also check
	// rows.length because an unreachable DB may cause Trino to silently return
	// 0 rows instead of throwing.
	const probe = await trinoRequest(
		`SELECT 1 FROM ${quoteTrinoIdent(connection.catalogName)}.information_schema.schemata LIMIT 1`,
		connection.catalogName,
		defaultSchema(connection)
	);
	if (probe.rows.length === 0) {
		throw new Error(
			`Connected to Trino but got no response from the ${connection.type} database. ` +
			`Check the host, port, and that the database is accepting TCP/IP connections.`
		);
	}
	return { ok: true };
}

export async function queryExternalConnection(
	connection: Connection,
	secret: ConnectionSecret | undefined,
	sql: string,
	signal?: AbortSignal
): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
	if (connection.type === 'duckdb-wasm') {
		throw new Error(`Connection type '${connection.type}' is not supported.`);
	}
	assertReadableSQL(sql);
	try {
		return await trinoRequest(sql, connection.catalogName, defaultSchema(connection), signal);
	} catch (err) {
		if (isCatalogNotFoundError(err)) {
			await registerCatalog(connection, secret);
			return trinoRequest(sql, connection.catalogName, defaultSchema(connection), signal);
		}
		throw err;
	}
}

export async function fetchExternalConnectionSchema(
	connection: Connection,
	secret?: ConnectionSecret
): Promise<{ tables: SchemaTable[] }> {
	if (connection.type === 'duckdb-wasm') {
		throw new Error(`Connection type '${connection.type}' is not supported.`);
	}

	const catalogName = connection.catalogName;

	// Query the catalog's own information_schema instead of system.jdbc.columns.
	// system.jdbc.columns opens a fresh JDBC connection to the underlying DB which
	// can fail even when the catalog is active (e.g. hostname resolution differs
	// inside the Trino container). information_schema goes through the same
	// connector path as regular queries.
	const schemaQuery = `SELECT table_schema AS table_schem, table_name, column_name, data_type AS type_name
		 FROM ${quoteTrinoIdent(catalogName)}.information_schema.columns
		 WHERE table_schema NOT IN ('information_schema', 'pg_catalog', '$internal', 'system', 'performance_schema', 'mysql', 'sys')
		 ORDER BY table_schema, table_name, ordinal_position`;

	const connSchema = defaultSchema(connection as Exclude<Connection, DuckDBWASMConnection>);
	let result: Awaited<ReturnType<typeof trinoRequest>>;
	try {
		result = await trinoRequest(schemaQuery, catalogName, connSchema);
	} catch (err) {
		if (isCatalogNotFoundError(err)) {
			await registerCatalog(connection, secret);
			result = await trinoRequest(schemaQuery, catalogName, connSchema);
		} else {
			throw err;
		}
	}

	const tables = new Map<string, SchemaTable>();
	for (const row of result.rows) {
		const schema = String(row.table_schem ?? '');
		const table = String(row.table_name ?? '');
		const column = String(row.column_name ?? '');
		const type = String(row.type_name ?? '');
		if (!table || !column) continue;

		const key = `${schema}.${table}`;
		const existing = tables.get(key);
		if (existing) {
			existing.columns.push(column);
			existing.columnTypes.push(type);
			continue;
		}

		tables.set(key, {
			name: table,
			schema,
			columns: [column],
			columnTypes: [type]
		});
	}

	return { tables: [...tables.values()] };
}

export async function materializeExternalConnection(
	connection: Connection,
	secret: ConnectionSecret | undefined,
	targetName: string,
	targetSchema: string | undefined,
	sql: string,
	mode: ExternalMaterializationMode
): Promise<{ name: string; type: ExternalRelationType }> {
	if (connection.type === 'duckdb-wasm') {
		throw new Error(`Connection type '${connection.type}' is not supported.`);
	}

	const normalizedTargetName = normalizeExternalRelationName(targetName);
	const normalizedTargetSchema = normalizeExternalSchemaName(
		targetSchema ?? defaultSchema(connection)
	);

	try {
		return await materializeTrinoConnection(
			connection,
			normalizedTargetSchema,
			normalizedTargetName,
			sql,
			mode
		);
	} catch (err) {
		if (isCatalogNotFoundError(err)) {
			await registerCatalog(connection, secret);
			return materializeTrinoConnection(
				connection,
				normalizedTargetSchema,
				normalizedTargetName,
				sql,
				mode
			);
		}
		throw err;
	}
}
