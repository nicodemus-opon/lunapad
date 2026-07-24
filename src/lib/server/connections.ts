import fs from 'node:fs/promises';
import path from 'node:path';
import { assertReadableSQL } from '$lib/utils/sql-readonly';
import {
	catalogTypeMappingProperties,
	catalogTypeMappingSession
} from '$lib/server/trino-type-mapping';
import type {
	ClickHouseConnection,
	Connection,
	ConnectionSecret,
	DuckDBWASMConnection,
	MySQLDataSource,
	PostgresConnection
} from '$lib/types/connection';
import {
	forTrino,
	physicalCatalogPrefixFor,
	rewriteTenantCatalogReferences,
	tenantTrinoUser,
	type ExternalConnection
} from './trino-catalog-isolation.js';
import { listConnectionsMetadata } from './connections-store.js';
import { getSecret } from './connection-secrets.js';

// Service-account JSON credentials are shared across all Google-auth connectors
// (Google Sheets, BigQuery) — each gets its own file, named by suffix, alongside
// the catalog's .properties file.
function serviceAccountCredentialsPath(
	catalogDir: string,
	catalogName: string,
	suffix: string
): string {
	return path.join(catalogDir, 'secrets', `${catalogName}-${suffix}.json`);
}

async function writeServiceAccountCredentialsFile(
	catalogName: string,
	suffix: string,
	secret: ConnectionSecret | undefined,
	catalogDir: string
): Promise<string> {
	if (!secret?.credentialsJson) {
		throw new Error('This connection requires a service-account credentials JSON.');
	}
	try {
		JSON.parse(secret.credentialsJson);
	} catch {
		throw new Error('Service-account credentials must be valid JSON.');
	}

	const filePath = serviceAccountCredentialsPath(catalogDir, catalogName, suffix);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, secret.credentialsJson, { encoding: 'utf-8', mode: 0o600 });
	return filePath;
}

export type ExternalMaterializationMode = 'table' | 'view' | 'incremental';
export type ExternalRelationType = 'table' | 'view';

export interface TrinoCatalogSyncStatus {
	connectionId: string;
	sourceAlias: string;
	physicalCatalogName: string;
	status: 'registered' | 'skipped' | 'failed';
	message?: string;
}

export interface TrinoCatalogStatus {
	connectionId: string;
	sourceAlias: string;
	physicalCatalogName: string;
	trinoUser: string;
	catalogFile: string | null;
	catalogFileExists: boolean;
	accessControlConfigured: boolean;
	status: 'ready' | 'registering' | 'failed';
	message?: string;
}

interface SchemaTable {
	name: string;
	schema?: string;
	columns: string[];
	columnTypes: string[];
	/** Table-level comment, when the underlying catalog exposes one (currently Postgres/ClickHouse only). */
	description?: string;
	/** Parallel to `columns` — column-level comments, when available. */
	columnDescriptions?: string[];
	foreignKeys?: Array<{
		column: string;
		referencedTable: string;
		referencedColumn: string;
		source: 'catalog' | 'heuristic';
	}>;
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

const TRINO_ACCESS_CONTROL_FILE = 'lunapad-access-control.json';

type TrinoAccessRuleSet = {
	catalogs: Array<{ user?: string; catalog?: string; allow: 'owner' | 'all' | 'read-only' | 'none' }>;
	schemas: Array<{ user?: string; catalog?: string; owner: boolean }>;
	tables: Array<{
		user?: string;
		catalog?: string;
		privileges: Array<'SELECT' | 'INSERT' | 'DELETE' | 'UPDATE' | 'OWNERSHIP'>;
	}>;
	queries: Array<{ user?: string; allow: Array<'execute' | 'view' | 'kill'> }>;
};

// The shared `lunapad` user (used only when no tenant/orgId is in scope — self-hosted mode,
// or a request without an active org) must never see tenant-isolated physical catalogs
// (the `lp_<orghash>_*` namespace from PHYSICAL_PREFIX in trino-catalog-isolation.ts).
// Per-org users get their own narrower catalog grant appended by ensureTenantTrinoAccess
// below — this base rule must stay excluded from that namespace so a missing orgId never
// silently reopens access to every org's catalogs at once.
const NON_TENANT_CATALOG_PATTERN = '(?!lp_).*';
const TENANT_CATALOG_PATTERN = 'lp_.*';
const CATALOG_MANAGER_TRINO_USER =
	process.env.TRINO_CATALOG_MANAGER_USER ?? 'lunapad_catalog_manager';

function baseTrinoAccessRules(): TrinoAccessRuleSet {
	return {
		catalogs: [
			// CREATE CATALOG / DROP CATALOG require AccessMode.OWNER in Trino's file-based
			// access control — 'all' only grants query/select access, not catalog management.
			{ user: 'lunapad', catalog: NON_TENANT_CATALOG_PATTERN, allow: 'owner' },
			{ user: CATALOG_MANAGER_TRINO_USER, catalog: TENANT_CATALOG_PATTERN, allow: 'owner' }
		],
		schemas: [{ user: 'lunapad', catalog: NON_TENANT_CATALOG_PATTERN, owner: true }],
		tables: [
			{
				user: 'lunapad',
				catalog: NON_TENANT_CATALOG_PATTERN,
				privileges: ['SELECT', 'INSERT', 'DELETE', 'UPDATE', 'OWNERSHIP']
			}
		],
		queries: [{ allow: ['execute'] }]
	};
}

function catalogManagerTrinoUser(orgId?: string | null): string {
	return orgId ? CATALOG_MANAGER_TRINO_USER : tenantTrinoUser(orgId);
}

const accessControlLocks = new Map<string, Promise<void>>();

async function withAccessControlLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	const previous = accessControlLocks.get(filePath) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const chained = previous.then(() => current);
	accessControlLocks.set(filePath, chained);
	await previous;
	try {
		return await fn();
	} finally {
		release();
		if (accessControlLocks.get(filePath) === chained) accessControlLocks.delete(filePath);
	}
}

function getTrinoAccessControlPath(catalogDir: string): string {
	return (
		process.env.TRINO_ACCESS_CONTROL_RULES_FILE ?? path.join(catalogDir, TRINO_ACCESS_CONTROL_FILE)
	);
}

function normalizeTrinoAccessRules(value: unknown): TrinoAccessRuleSet {
	const base = baseTrinoAccessRules();
	if (!value || typeof value !== 'object') return base;
	const maybe = value as Partial<TrinoAccessRuleSet>;
	return {
		catalogs: Array.isArray(maybe.catalogs) ? maybe.catalogs : base.catalogs,
		schemas: Array.isArray(maybe.schemas) ? maybe.schemas : base.schemas,
		tables: Array.isArray(maybe.tables) ? maybe.tables : base.tables,
		queries: Array.isArray(maybe.queries) ? maybe.queries : base.queries
	};
}

async function readTrinoAccessRules(filePath: string): Promise<TrinoAccessRuleSet> {
	try {
		return normalizeTrinoAccessRules(JSON.parse(await fs.readFile(filePath, 'utf-8')));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return baseTrinoAccessRules();
		throw err;
	}
}

async function writeTrinoAccessRules(filePath: string, rules: TrinoAccessRuleSet): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.tmp`;
	await fs.writeFile(tmp, `${JSON.stringify(rules, null, 2)}\n`, {
		encoding: 'utf-8',
		mode: 0o600
	});
	await fs.rename(tmp, filePath);
}

// Upgrades a stale on-disk rules file written before the base `lunapad` rule was scoped
// away from tenant catalogs — without this, an already-provisioned deployment would keep
// its old blanket `catalog: ".*"` grant forever, since this function only ever appends new
// per-org rules and never otherwise rewrites the base ones.
function hardenBaseTrinoRules(rules: TrinoAccessRuleSet): boolean {
	let changed = false;
	for (const rule of [...rules.catalogs, ...rules.schemas, ...rules.tables]) {
		if (rule.user === 'lunapad' && (rule.catalog === '.*' || rule.catalog === undefined)) {
			rule.catalog = NON_TENANT_CATALOG_PATTERN;
			changed = true;
		}
	}
	// CREATE CATALOG / DROP CATALOG require AccessMode.OWNER — upgrade any rule written by an
	// older build that granted only 'all' (query access), which silently broke catalog
	// registration for whichever user runs it (lunapad or the catalog manager).
	for (const rule of rules.catalogs) {
		if (
			(rule.user === 'lunapad' || rule.user === CATALOG_MANAGER_TRINO_USER) &&
			rule.allow === 'all'
		) {
			rule.allow = 'owner';
			changed = true;
		}
	}
	if (
		!rules.catalogs.some(
			(rule) => rule.user === CATALOG_MANAGER_TRINO_USER && rule.catalog === TENANT_CATALOG_PATTERN
		)
	) {
		rules.catalogs.push({
			user: CATALOG_MANAGER_TRINO_USER,
			catalog: TENANT_CATALOG_PATTERN,
			allow: 'owner'
		});
		changed = true;
	}
	// The above only ever *upgrades* an existing 'lunapad' rule — it does nothing if the
	// base rules are entirely absent (e.g. a rules file seeded from scratch, such as the
	// inert stub docker-compose writes before the app has ever run). Add them from scratch
	// when missing so a bare/empty rules file self-heals into a working base ruleset.
	if (
		!rules.catalogs.some((rule) => rule.user === 'lunapad' && rule.catalog === NON_TENANT_CATALOG_PATTERN)
	) {
		rules.catalogs.push({ user: 'lunapad', catalog: NON_TENANT_CATALOG_PATTERN, allow: 'owner' });
		changed = true;
	}
	if (
		!rules.schemas.some((rule) => rule.user === 'lunapad' && rule.catalog === NON_TENANT_CATALOG_PATTERN)
	) {
		rules.schemas.push({ user: 'lunapad', catalog: NON_TENANT_CATALOG_PATTERN, owner: true });
		changed = true;
	}
	if (
		!rules.tables.some((rule) => rule.user === 'lunapad' && rule.catalog === NON_TENANT_CATALOG_PATTERN)
	) {
		rules.tables.push({
			user: 'lunapad',
			catalog: NON_TENANT_CATALOG_PATTERN,
			privileges: ['SELECT', 'INSERT', 'DELETE', 'UPDATE', 'OWNERSHIP']
		});
		changed = true;
	}
	if (!rules.queries.some((rule) => rule.allow.includes('execute'))) {
		rules.queries.push({ allow: ['execute'] });
		changed = true;
	}
	return changed;
}

async function ensureTenantTrinoAccess(orgId?: string | null): Promise<void> {
	if (!orgId) return;
	const catalogDir = getCatalogDir();
	if (!catalogDir) return;
	const filePath = getTrinoAccessControlPath(catalogDir);
	const user = tenantTrinoUser(orgId);
	const catalog = `${physicalCatalogPrefixFor(orgId)}.*`;

	await withAccessControlLock(filePath, async () => {
		const rules = await readTrinoAccessRules(filePath);
		let changed = hardenBaseTrinoRules(rules);
		if (!rules.catalogs.some((rule) => rule.user === user && rule.catalog === catalog)) {
			rules.catalogs.push({ user, catalog, allow: 'all' });
			changed = true;
		}
		if (!rules.schemas.some((rule) => rule.user === user && rule.catalog === catalog)) {
			rules.schemas.push({ user, catalog, owner: true });
			changed = true;
		}
		if (!rules.tables.some((rule) => rule.user === user && rule.catalog === catalog)) {
			rules.tables.push({
				user,
				catalog,
				privileges: ['SELECT', 'INSERT', 'DELETE', 'UPDATE', 'OWNERSHIP']
			});
			changed = true;
		}
		if (changed) await writeTrinoAccessRules(filePath, rules);
	});
}

// Guarantees the access-control file has at least the base rules, independent of any
// orgId — ensureTenantTrinoAccess above only ever runs (and only ever writes) once a
// tenant-scoped request occurs. On a fresh checkout/volume the file won't exist yet;
// docker-compose also seeds an inert empty-rules stub before Trino's own first boot
// (so the app container, which only starts once Trino is already healthy, isn't in
// that path) — either way this reuses hardenBaseTrinoRules to fill in whatever base
// rules are missing, not just create the file when absent. Called once at server boot
// (see hooks.server.ts) as a recovery path for both cases.
export async function ensureBaseTrinoAccessFile(): Promise<void> {
	const catalogDir = getCatalogDir();
	if (!catalogDir) return;
	const filePath = getTrinoAccessControlPath(catalogDir);

	await withAccessControlLock(filePath, async () => {
		let existed = true;
		try {
			await fs.access(filePath);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
			existed = false;
		}
		const rules = await readTrinoAccessRules(filePath);
		const changed = hardenBaseTrinoRules(rules);
		if (!existed || changed) await writeTrinoAccessRules(filePath, rules);
	});
}

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

interface TrinoRequestOptions {
	signal?: AbortSignal;
	session?: string;
	trinoUser?: string;
}

function trinoOptsForConnection(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	orgId?: string | null
): TrinoRequestOptions {
	const session = catalogTypeMappingSession(connection.catalogName, connection.type);
	return {
		...(session ? { session } : {}),
		trinoUser: tenantTrinoUser(orgId)
	};
}

function buildTrinoHeaders(
	catalogName?: string,
	schema?: string,
	opts?: Pick<TrinoRequestOptions, 'session' | 'trinoUser'>
): Record<string, string> {
	const headers: Record<string, string> = {
		'X-Trino-User': opts?.trinoUser ?? 'lunapad',
		'Content-Type': 'text/plain; charset=utf-8'
	};
	if (catalogName) headers['X-Trino-Catalog'] = catalogName;
	if (schema) headers['X-Trino-Schema'] = schema;
	if (opts?.session) headers['X-Trino-Session'] = opts.session;
	return headers;
}

async function trinoRequest(
	sql: string,
	catalogName?: string,
	schema?: string,
	opts?: TrinoRequestOptions
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
	const signal = opts?.signal;
	let response: Response;
	try {
		response = await fetch(`${TRINO_URL}/v1/statement`, {
			method: 'POST',
			headers: buildTrinoHeaders(catalogName, schema, opts),
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
					allRows.push(
						Object.fromEntries(
							columns.map((col, i) => {
								let value = (row as unknown[])[i];
								if (col.type?.startsWith('varbinary') && typeof value === 'string') {
									try {
										value = Buffer.from(value, 'base64').toString('utf8');
									} catch {
										/* keep original */
									}
								}
								return [col.name, value];
							})
						)
					);
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

async function trinoExec(
	sql: string,
	catalogName: string,
	schema = 'public',
	opts?: TrinoRequestOptions
): Promise<void> {
	await trinoRequest(sql, catalogName, schema, opts);
}

// ── Catalog registration via Trino's dynamic catalog SQL ──────────────────────
// Trino 481 (catalog.management=dynamic, catalog.store=file) persists a catalog's
// config once it's created. A plain restart reloads that persisted state rather
// than re-reading the .properties file, so writing the file and restarting Trino
// (the previous approach) never actually applies edits to an existing catalog —
// only brand-new catalogs pick up correctly. CREATE/DROP CATALOG SQL applies
// immediately and is the only way edits reliably take effect; Trino itself keeps
// the .properties file on disk in sync (and removes it on DROP CATALOG).

interface CatalogSpec {
	connectorName: string;
	properties: Record<string, string>;
}

async function buildCatalogSpec(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	secret: ConnectionSecret | undefined,
	catalogDir: string
): Promise<CatalogSpec> {
	const pass = secret?.password ?? '';

	if (connection.type === 'postgres') {
		// sslMode: 'require' = SSL without cert check; 'verify-full' = full chain + hostname
		const pgSslMode = connection.sslMode ?? 'require';
		const sslParam = connection.ssl ? `?ssl=true&sslmode=${pgSslMode}` : '';
		const properties: Record<string, string> = {
			'connection-url': `jdbc:postgresql://${connection.host}:${connection.port}/${connection.database}${sslParam}`,
			'connection-user': connection.username
		};
		if (pass) properties['connection-password'] = pass;
		return { connectorName: 'postgresql', properties };
	}

	if (connection.type === 'clickhouse') {
		// sslmode=none skips cert verification — standard for private/self-signed ClickHouse deployments
		const sslParam = connection.secure ? '?ssl=true&sslmode=none' : '';
		const properties: Record<string, string> = {
			'connection-url': `jdbc:clickhouse://${connection.host}:${connection.port}/${connection.database}${sslParam}`,
			'connection-user': connection.username
		};
		if (pass) properties['connection-password'] = pass;
		return { connectorName: 'clickhouse', properties };
	}

	if (connection.type === 'mysql') {
		// trustServerCertificate=true allows self-signed certs on private MySQL instances
		const sslParam = connection.ssl ? '?useSSL=true&trustServerCertificate=true' : '';
		const properties: Record<string, string> = {
			'connection-url': `jdbc:mysql://${connection.host}:${connection.port}/${connection.database}${sslParam}`,
			'connection-user': connection.username
		};
		if (pass) properties['connection-password'] = pass;
		return { connectorName: 'mysql', properties };
	}

	if (connection.type === 'mariadb') {
		const sslParam = connection.ssl ? '?useSsl=true&trustServerCertificate=true' : '';
		const properties: Record<string, string> = {
			'connection-url': `jdbc:mariadb://${connection.host}:${connection.port}/${connection.database}${sslParam}`,
			'connection-user': connection.username
		};
		if (pass) properties['connection-password'] = pass;
		return { connectorName: 'mariadb', properties };
	}

	if (connection.type === 'redshift') {
		// Redshift JDBC uses semicolon-delimited URL params, not a `?key=value` query string.
		const sslParam = connection.ssl ? ';SSL=TRUE;' : '';
		const properties: Record<string, string> = {
			'connection-url': `jdbc:redshift://${connection.host}:${connection.port}/${connection.database}${sslParam}`,
			'connection-user': connection.username
		};
		if (pass) properties['connection-password'] = pass;
		return { connectorName: 'redshift', properties };
	}

	if (connection.type === 'singlestore') {
		const sslParam = connection.ssl ? '?useSsl=true' : '';
		const properties: Record<string, string> = {
			'connection-url': `jdbc:singlestore://${connection.host}:${connection.port}/${connection.database}${sslParam}`,
			'connection-user': connection.username
		};
		if (pass) properties['connection-password'] = pass;
		return { connectorName: 'singlestore', properties };
	}

	if (connection.type === 'mongodb') {
		const auth = connection.username
			? `${encodeURIComponent(connection.username)}:${encodeURIComponent(secret?.password ?? '')}@`
			: '';
		const tlsParam = connection.ssl ? '?tls=true' : '';
		const connectionUrl = `mongodb://${auth}${connection.host}:${connection.port}/${connection.database}${tlsParam}`;
		return { connectorName: 'mongodb', properties: { 'mongodb.connection-url': connectionUrl } };
	}

	if (connection.type === 'elasticsearch') {
		const properties: Record<string, string> = {
			'elasticsearch.host': connection.host,
			'elasticsearch.port': String(connection.port),
			'elasticsearch.default-schema-name': connection.database
		};
		if (connection.username) {
			properties['elasticsearch.security'] = 'PASSWORD';
			properties['elasticsearch.auth.user'] = connection.username;
			if (pass) properties['elasticsearch.auth.password'] = pass;
		}
		return { connectorName: 'elasticsearch', properties };
	}

	if (connection.type === 'sqlserver') {
		const encrypt = connection.encrypt ? 'true' : 'false';
		const trustCert = connection.trustServerCertificate ? 'true' : 'false';
		const properties: Record<string, string> = {
			'connection-url': `jdbc:sqlserver://${connection.host}:${connection.port};databaseName=${connection.database};encrypt=${encrypt};trustServerCertificate=${trustCert}`,
			'connection-user': connection.username
		};
		if (pass) properties['connection-password'] = pass;
		return { connectorName: 'sqlserver', properties };
	}

	if (connection.type === 'oracle') {
		const url =
			connection.identifierType === 'sid'
				? `jdbc:oracle:thin:@${connection.host}:${connection.port}:${connection.serviceName}`
				: `jdbc:oracle:thin:@//${connection.host}:${connection.port}/${connection.serviceName}`;
		const properties: Record<string, string> = {
			'connection-url': url,
			'connection-user': connection.username
		};
		if (pass) properties['connection-password'] = pass;
		return { connectorName: 'oracle', properties };
	}

	if (connection.type === 'snowflake') {
		const properties: Record<string, string> = {
			'connection-url': `jdbc:snowflake://${connection.account}.snowflakecomputing.com`,
			'connection-user': connection.username,
			'snowflake.account': connection.account,
			'snowflake.database': connection.database,
			'snowflake.warehouse': connection.warehouse
		};
		if (pass) properties['connection-password'] = pass;
		if (connection.role) properties['snowflake.role'] = connection.role;
		return { connectorName: 'snowflake', properties };
	}

	if (connection.type === 'cassandra') {
		const properties: Record<string, string> = {
			'cassandra.contact-points': connection.contactPoints,
			'cassandra.native-protocol-port': String(connection.port),
			'cassandra.load-policy.dc-aware.local-dc': connection.localDatacenter
		};
		if (connection.username) {
			properties['cassandra.security'] = 'PASSWORD';
			properties['cassandra.username'] = connection.username;
			if (pass) properties['cassandra.password'] = pass;
		}
		return { connectorName: 'cassandra', properties };
	}

	if (connection.type === 'gsheets') {
		const credentialsPath = await writeServiceAccountCredentialsFile(
			connection.catalogName,
			'gsheets',
			secret,
			catalogDir
		);
		return {
			connectorName: 'gsheets',
			properties: {
				'gsheets.metadata-sheet-id': connection.metadataSheetId,
				'gsheets.credentials-path': credentialsPath
			}
		};
	}

	if (connection.type === 'bigquery') {
		const credentialsPath = await writeServiceAccountCredentialsFile(
			connection.catalogName,
			'bigquery',
			secret,
			catalogDir
		);
		const properties: Record<string, string> = {
			'bigquery.project-id': connection.projectId,
			'bigquery.credentials-file': credentialsPath
		};
		if (connection.parentProjectId)
			properties['bigquery.parent-project-id'] = connection.parentProjectId;
		return { connectorName: 'bigquery', properties };
	}

	throw new Error(`Unsupported connection type: ${(connection as Connection).type}`);
}

function buildDropCatalogSQL(catalogName: string): string {
	return `DROP CATALOG IF EXISTS ${quoteTrinoIdent(catalogName)}`;
}

function buildCreateCatalogSQL(catalogName: string, spec: CatalogSpec): string {
	const withClause = Object.entries(spec.properties)
		.map(([key, value]) => `${quoteTrinoIdent(key)} = ${quoteLiteral(value)}`)
		.join(', ');
	return `CREATE CATALOG ${quoteTrinoIdent(catalogName)} USING ${spec.connectorName} WITH (${withClause})`;
}

const catalogLocks = new Map<string, Promise<void>>();

async function withCatalogLock<T>(catalogName: string, fn: () => Promise<T>): Promise<T> {
	const previous = catalogLocks.get(catalogName) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const chained = previous.then(() => current);
	catalogLocks.set(catalogName, chained);
	await previous;
	try {
		return await fn();
	} finally {
		release();
		if (catalogLocks.get(catalogName) === chained) catalogLocks.delete(catalogName);
	}
}

export async function registerCatalog(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	secret: ConnectionSecret | undefined,
	orgId?: string | null
): Promise<void> {
	const trinoConnection = forTrino(connection, orgId) as ExternalConnection;
	if (!/^[a-z][a-z0-9_]{0,63}$/.test(trinoConnection.catalogName)) {
		throw new Error(
			`Invalid source ID "${trinoConnection.catalogName}". Must start with a lowercase letter and contain only lowercase letters, digits, and underscores (max 64 chars).`
		);
	}

	const catalogDir = getCatalogDir();
	if (!catalogDir) {
		throw new Error(
			'External connections require the Docker Compose stack. ' +
				'Run `docker compose up` to start Trino, then retry.'
		);
	}
	await ensureTenantTrinoAccess(orgId);

	const spec = await buildCatalogSpec(trinoConnection, secret, catalogDir);
	const fullSpec: CatalogSpec = {
		...spec,
		properties: { ...spec.properties, ...catalogTypeMappingProperties(trinoConnection.type) }
	};

	await withCatalogLock(trinoConnection.catalogName, async () => {
		// DROP + CREATE so edits to an already-registered catalog (host, port, database,
		// credentials, ...) actually take effect — see comment above.
		await trinoRequest(buildDropCatalogSQL(trinoConnection.catalogName), undefined, undefined, {
			trinoUser: catalogManagerTrinoUser(orgId)
		});
		await trinoRequest(
			buildCreateCatalogSQL(trinoConnection.catalogName, fullSpec),
			undefined,
			undefined,
			{
				trinoUser: catalogManagerTrinoUser(orgId)
			}
		);
	});
}

export async function unregisterCatalog(
	connectionOrCatalogName: string | Exclude<Connection, DuckDBWASMConnection>,
	orgId?: string | null
): Promise<void> {
	const catalogName =
		typeof connectionOrCatalogName === 'string'
			? connectionOrCatalogName
			: (forTrino(connectionOrCatalogName, orgId) as ExternalConnection).catalogName;
	await ensureTenantTrinoAccess(orgId);
	await trinoRequest(buildDropCatalogSQL(catalogName), undefined, undefined, {
		trinoUser: catalogManagerTrinoUser(orgId)
	}).catch(() => {});

	// Google-auth connectors write service-account credentials alongside the catalog
	// file — clean up to avoid orphaned secrets sitting on disk after removal.
	const delDir = getCatalogDir();
	if (delDir) {
		for (const suffix of ['gsheets', 'bigquery']) {
			try {
				await fs.unlink(serviceAccountCredentialsPath(delDir, catalogName, suffix));
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
			}
		}
	}
}

export async function reconcileTrinoCatalogs(orgId: string): Promise<TrinoCatalogSyncStatus[]> {
	const connections = await listConnectionsMetadata(orgId, { includePhysicalCatalogName: true });
	const statuses: TrinoCatalogSyncStatus[] = [];
	for (const connection of connections) {
		if (connection.type === 'duckdb-wasm') continue;
		const trinoConnection = forTrino(connection, orgId) as ExternalConnection;
		const physicalCatalogName = trinoConnection.catalogName;
		try {
			const secret = await getSecret(connection.id, orgId);
			await registerCatalog(connection, secret ?? undefined, orgId);
			statuses.push({
				connectionId: connection.id,
				sourceAlias: connection.catalogName,
				physicalCatalogName,
				status: 'registered'
			});
		} catch (err) {
			statuses.push({
				connectionId: connection.id,
				sourceAlias: connection.catalogName,
				physicalCatalogName,
				status: 'failed',
				message: err instanceof Error ? err.message : 'Failed to register catalog.'
			});
		}
	}
	return statuses;
}

export async function getTrinoCatalogStatuses(orgId: string): Promise<TrinoCatalogStatus[]> {
	const connections = await listConnectionsMetadata(orgId, { includePhysicalCatalogName: true });
	const catalogDir = getCatalogDir();
	const accessFile = catalogDir ? getTrinoAccessControlPath(catalogDir) : null;
	const accessRules = accessFile ? await readTrinoAccessRules(accessFile).catch(() => null) : null;
	const user = tenantTrinoUser(orgId);
	const prefix = physicalCatalogPrefixFor(orgId);
	const hasAccessRule = Boolean(
		accessRules?.catalogs.some((rule) => rule.user === user && rule.catalog === `${prefix}.*`)
	);

	const statuses: TrinoCatalogStatus[] = [];
	for (const connection of connections) {
		if (connection.type === 'duckdb-wasm') continue;
		const trinoConnection = forTrino(connection, orgId) as ExternalConnection;
		const physicalCatalogName = trinoConnection.catalogName;
		const catalogFile = catalogDir
			? path.join(catalogDir, `${physicalCatalogName}.properties`)
			: null;
		const catalogFileExists = catalogFile
			? await fs
					.access(catalogFile)
					.then(() => true)
					.catch(() => false)
			: false;
		const ready = catalogFileExists && hasAccessRule;
		statuses.push({
			connectionId: connection.id,
			sourceAlias: connection.catalogName,
			physicalCatalogName,
			trinoUser: user,
			catalogFile,
			catalogFileExists,
			accessControlConfigured: hasAccessRule,
			status: ready ? 'ready' : catalogFileExists ? 'registering' : 'failed',
			...(ready
				? {}
				: {
						message: !catalogFileExists
							? 'Catalog file is missing; reconcile this workspace.'
							: 'Tenant access-control rule is missing.'
					})
		});
	}
	return statuses;
}

// ── SQL validation ────────────────────────────────────────────────────────────

function stripTrailingSemicolon(sql: string): string {
	return sql.trim().replace(/;\s*$/, '');
}

function normalizeExternalRelationName(name: string): string {
	const normalized = name.trim();
	if (!normalized) throw new Error('Materialization target name is required.');
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
		throw new Error(
			'Materialization target name must be a simple identifier (letters, digits, underscore).'
		);
	}
	return normalized;
}

function normalizeExternalSchemaName(name: string): string {
	const normalized = name.trim();
	if (!normalized) throw new Error('Materialization target schema is required.');
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
		throw new Error(
			'Materialization target schema must be a simple identifier (letters, digits, underscore).'
		);
	}
	return normalized;
}

function normalizeMaterializeSQL(sql: string): string {
	const normalized = stripTrailingSemicolon(sql);
	if (!normalized) throw new Error('Materialization SQL is required.');
	if (normalized.includes(';'))
		throw new Error('Only a single SQL statement is allowed for materialization SQL.');
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
	// Oracle maps schema to "Oracle database", which has no clean static default from
	// our fields, Cassandra has no keyspace concept on the connection type at all, and
	// BigQuery's schema is a dataset with no single default — returning '' lets
	// buildTrinoHeaders omit the schema header safely and forces an explicit schema for
	// materialize, rather than guessing wrong.
	if (
		connection.type === 'oracle' ||
		connection.type === 'cassandra' ||
		connection.type === 'bigquery'
	)
		return '';
	if (connection.type === 'gsheets') return 'default';
	if (connection.type === 'snowflake') return connection.database;
	return connection.database;
}

// ── Materialization via Trino ─────────────────────────────────────────────────

async function getTrinoRelationType(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	orgId: string | undefined | null,
	targetSchema: string,
	targetName: string
): Promise<ExternalRelationType | null> {
	const catalogName = connection.catalogName;
	const sql = `
		SELECT table_type
		FROM ${quoteTrinoIdent(catalogName)}.information_schema.tables
		WHERE table_schema = ${quoteLiteral(targetSchema)}
		  AND table_name = ${quoteLiteral(targetName)}
		LIMIT 1
	`;
	try {
		const result = await trinoRequest(
			sql,
			catalogName,
			targetSchema,
			trinoOptsForConnection(connection, orgId)
		);
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
	orgId: string | undefined | null,
	targetSchema: string,
	targetName: string,
	sql: string,
	mode: ExternalMaterializationMode
): Promise<{ name: string; type: ExternalRelationType }> {
	const catalogName = connection.catalogName;
	const ident = quoteTrinoPath(catalogName, targetSchema, targetName);
	const sourceSQL = normalizeMaterializeSQL(sql);
	const schema = defaultSchema(connection);
	const trinoOpts = trinoOptsForConnection(connection, orgId);

	if (mode === 'view') {
		const existingType = await getTrinoRelationType(connection, orgId, targetSchema, targetName);
		if (existingType === 'table') {
			await trinoExec(`DROP TABLE IF EXISTS ${ident}`, catalogName, schema, trinoOpts);
		}
		await trinoExec(
			`CREATE OR REPLACE VIEW ${ident} AS ${sourceSQL}`,
			catalogName,
			schema,
			trinoOpts
		);
		return { name: targetName, type: 'view' };
	}

	if (mode === 'table') {
		const existingType = await getTrinoRelationType(connection, orgId, targetSchema, targetName);
		if (existingType === 'view') {
			await trinoExec(`DROP VIEW IF EXISTS ${ident}`, catalogName, schema, trinoOpts);
		} else if (existingType === 'table') {
			await trinoExec(`DROP TABLE IF EXISTS ${ident}`, catalogName, schema, trinoOpts);
		}
		await trinoExec(`CREATE TABLE ${ident} AS ${sourceSQL}`, catalogName, schema, trinoOpts);
		return { name: targetName, type: 'table' };
	}

	// incremental
	const existingType = await getTrinoRelationType(connection, orgId, targetSchema, targetName);
	if (existingType === 'view') {
		await trinoExec(`DROP VIEW IF EXISTS ${ident}`, catalogName, schema, trinoOpts);
	}
	if (existingType !== 'table') {
		await trinoExec(`CREATE TABLE ${ident} AS ${sourceSQL}`, catalogName, schema, trinoOpts);
		return { name: targetName, type: 'table' };
	}
	await trinoExec(
		`INSERT INTO ${ident} SELECT * FROM (${sourceSQL})`,
		catalogName,
		schema,
		trinoOpts
	);
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
	secret?: ConnectionSecret,
	orgId?: string | null
): Promise<{ ok: boolean }> {
	if (connection.type === 'duckdb-wasm') {
		throw new Error(`Connection type '${connection.type}' is not supported.`);
	}
	const trinoConnection = forTrino(connection, orgId) as ExternalConnection;
	// Register (or re-register) the catalog, then verify connectivity.
	// Use information_schema.schemata instead of SELECT 1 — Trino evaluates
	// SELECT 1 in the coordinator without touching the connector, so it passes
	// even when the underlying database is unreachable.
	await registerCatalog(connection, secret, orgId);
	// Query a real catalog table so Trino must open a JDBC connection to the
	// underlying database. SELECT 1 is evaluated in the Trino coordinator and
	// passes even when the database is completely unreachable. We also check
	// rows.length because an unreachable DB may cause Trino to silently return
	// 0 rows instead of throwing.
	const probe = await trinoRequest(
		`SELECT 1 FROM ${quoteTrinoIdent(trinoConnection.catalogName)}.information_schema.schemata LIMIT 1`,
		trinoConnection.catalogName,
		defaultSchema(trinoConnection),
		trinoOptsForConnection(trinoConnection, orgId)
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
	signal?: AbortSignal,
	orgId?: string | null,
	availableConnections: Connection[] = [connection]
): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
	if (connection.type === 'duckdb-wasm') {
		throw new Error(`Connection type '${connection.type}' is not supported.`);
	}
	assertReadableSQL(sql);
	const trinoConnection = forTrino(connection, orgId) as ExternalConnection;
	const rewrittenSql = rewriteTenantCatalogReferences(sql, orgId, availableConnections);
	await ensureTenantTrinoAccess(orgId);
	const trinoOpts = {
		...trinoOptsForConnection(trinoConnection, orgId),
		signal
	};
	try {
		return await trinoRequest(
			rewrittenSql,
			trinoConnection.catalogName,
			defaultSchema(trinoConnection),
			trinoOpts
		);
	} catch (err) {
		if (isCatalogNotFoundError(err)) {
			await registerCatalog(connection, secret, orgId);
			return trinoRequest(
				rewrittenSql,
				trinoConnection.catalogName,
				defaultSchema(trinoConnection),
				trinoOpts
			);
		}
		throw err;
	}
}

// ── Best-effort table/column comment enrichment ───────────────────────────────
// Every external connection routes through Trino — there is no native per-connector driver
// code path in this file, only `trinoRequest`. Comment/description support is not part of the
// standard `information_schema` columns Trino implements, so for the two connector types where
// it matters most we issue a second, best-effort query via the JDBC passthrough table function
// (`<catalog>.system.query(query => '...')`, supported by Trino's postgresql/clickhouse
// connectors) against the underlying catalog's own comment-bearing system tables. A failure
// here (unsupported Trino version, connector without passthrough, permissions) must never
// break schema fetch itself — callers depend on this for live "refresh schema" UX.
//
// TODO(RAG-followup): the other 12 ConnectionType variants (mysql/mariadb/sqlserver/oracle/
// redshift/snowflake/singlestore have their own comment-catalog dialect and are reasonable,
// symmetric follow-up work; cassandra/gsheets/mongodb/elasticsearch likely have no meaningful
// "column comment" concept at all) are intentionally not covered here.

interface CatalogComment {
	schema: string;
	table: string;
	/** Null for a table-level comment, set for a column-level comment. */
	column: string | null;
	comment: string;
}

function buildCommentPassthroughQuery(connectionType: 'postgres' | 'clickhouse'): string {
	if (connectionType === 'postgres') {
		return `SELECT n.nspname AS table_schem, c.relname AS table_name, a.attname AS column_name, d.description AS comment
			FROM pg_description d
			JOIN pg_class c ON d.objoid = c.oid
			JOIN pg_namespace n ON c.relnamespace = n.oid
			LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid AND d.objsubid > 0
			WHERE d.description IS NOT NULL AND d.description != ''`;
	}
	return `SELECT database AS table_schem, table AS table_name, name AS column_name, comment
		FROM system.columns
		WHERE comment != ''
		UNION ALL
		SELECT database AS table_schem, table AS table_name, NULL AS column_name, comment
		FROM system.tables
		WHERE comment != ''`;
}

async function fetchCatalogComments(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	catalogName: string,
	connSchema: string,
	orgId?: string | null
): Promise<CatalogComment[]> {
	if (connection.type !== 'postgres' && connection.type !== 'clickhouse') return [];
	try {
		const passthroughSql = buildCommentPassthroughQuery(connection.type);
		const wrapped = `SELECT * FROM TABLE(${quoteTrinoIdent(catalogName)}.system.query(query => ${quoteLiteral(passthroughSql)}))`;
		const result = await trinoRequest(
			wrapped,
			catalogName,
			connSchema,
			trinoOptsForConnection(connection, orgId)
		);
		return result.rows
			.map((row) => ({
				schema: String(row.table_schem ?? ''),
				table: String(row.table_name ?? ''),
				column: row.column_name == null ? null : String(row.column_name),
				comment: String(row.comment ?? '')
			}))
			.filter((c) => c.table && c.comment);
	} catch {
		// Best-effort only — missing passthrough support, an older Trino version, or
		// insufficient permissions must not break schema fetch.
		return [];
	}
}

export async function fetchExternalConnectionSchema(
	connection: Connection,
	secret?: ConnectionSecret,
	orgId?: string | null
): Promise<{ tables: SchemaTable[] }> {
	if (connection.type === 'duckdb-wasm') {
		throw new Error(`Connection type '${connection.type}' is not supported.`);
	}

	const trinoConnection = forTrino(connection, orgId) as ExternalConnection;
	const catalogName = trinoConnection.catalogName;
	await ensureTenantTrinoAccess(orgId);

	// Query the catalog's own information_schema instead of system.jdbc.columns.
	// system.jdbc.columns opens a fresh JDBC connection to the underlying DB which
	// can fail even when the catalog is active (e.g. hostname resolution differs
	// inside the Trino container). information_schema goes through the same
	// connector path as regular queries.
	const schemaQuery = `SELECT table_schema AS table_schem, table_name, column_name, data_type AS type_name
		 FROM ${quoteTrinoIdent(catalogName)}.information_schema.columns
		 WHERE table_schema NOT IN ('information_schema', 'pg_catalog', '$internal', 'system', 'performance_schema', 'mysql', 'sys')
		 ORDER BY table_schema, table_name, ordinal_position`;

	const connSchema = defaultSchema(trinoConnection);
	const trinoOpts = trinoOptsForConnection(trinoConnection, orgId);
	let result: Awaited<ReturnType<typeof trinoRequest>>;
	try {
		result = await trinoRequest(schemaQuery, catalogName, connSchema, trinoOpts);
	} catch (err) {
		if (isCatalogNotFoundError(err)) {
			await registerCatalog(connection, secret, orgId);
			result = await trinoRequest(schemaQuery, catalogName, connSchema, trinoOpts);
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

	const comments = await fetchCatalogComments(trinoConnection, catalogName, connSchema, orgId);
	for (const c of comments) {
		const key = `${c.schema}.${c.table}`;
		const t = tables.get(key);
		if (!t) continue;
		if (c.column === null) {
			t.description = c.comment;
		} else {
			const colIdx = t.columns.indexOf(c.column);
			if (colIdx === -1) continue;
			if (!t.columnDescriptions) t.columnDescriptions = new Array(t.columns.length).fill(undefined);
			t.columnDescriptions[colIdx] = c.comment;
		}
	}

	const foreignKeys = await fetchCatalogForeignKeys(
		trinoConnection,
		catalogName,
		connSchema,
		orgId
	);
	for (const fk of foreignKeys) {
		const key = `${fk.schema}.${fk.table}`;
		const t = tables.get(key);
		if (!t) continue;
		if (!t.foreignKeys) t.foreignKeys = [];
		t.foreignKeys.push({
			column: fk.column,
			referencedTable: fk.referencedSchema
				? `${fk.referencedSchema}.${fk.referencedTable}`
				: fk.referencedTable,
			referencedColumn: fk.referencedColumn,
			source: 'catalog'
		});
	}

	return { tables: [...tables.values()] };
}

interface CatalogForeignKey {
	schema: string;
	table: string;
	column: string;
	referencedSchema: string;
	referencedTable: string;
	referencedColumn: string;
}

function buildForeignKeyPassthroughQuery(connectionType: 'postgres'): string {
	return `SELECT
		tc.table_schema AS source_schema,
		tc.table_name AS source_table,
		kcu.column_name AS source_column,
		ccu.table_schema AS referenced_schema,
		ccu.table_name AS referenced_table,
		ccu.column_name AS referenced_column
	FROM information_schema.table_constraints tc
	JOIN information_schema.key_column_usage kcu
		ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
	JOIN information_schema.constraint_column_usage ccu
		ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
	WHERE tc.constraint_type = 'FOREIGN KEY'`;
}

async function fetchCatalogForeignKeys(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	catalogName: string,
	connSchema: string,
	orgId?: string | null
): Promise<CatalogForeignKey[]> {
	// Real FK metadata only where passthrough to native information_schema works.
	if (connection.type !== 'postgres') return [];
	try {
		const passthroughSql = buildForeignKeyPassthroughQuery('postgres');
		const wrapped = `SELECT * FROM TABLE(${quoteTrinoIdent(catalogName)}.system.query(query => ${quoteLiteral(passthroughSql)}))`;
		const result = await trinoRequest(
			wrapped,
			catalogName,
			connSchema,
			trinoOptsForConnection(connection, orgId)
		);
		return result.rows
			.map((row) => ({
				schema: String(row.source_schema ?? ''),
				table: String(row.source_table ?? ''),
				column: String(row.source_column ?? ''),
				referencedSchema: String(row.referenced_schema ?? ''),
				referencedTable: String(row.referenced_table ?? ''),
				referencedColumn: String(row.referenced_column ?? '')
			}))
			.filter((fk) => fk.table && fk.column && fk.referencedTable && fk.referencedColumn);
	} catch {
		return [];
	}
}

// ── File upload via Trino ─────────────────────────────────────────────────────

function duckdbTypeToTrino(type: string): string {
	const t = type.toUpperCase().split('(')[0].trim();
	const map: Record<string, string> = {
		BIGINT: 'BIGINT',
		INT8: 'BIGINT',
		HUGEINT: 'BIGINT',
		INTEGER: 'INTEGER',
		INT4: 'INTEGER',
		INT: 'INTEGER',
		SMALLINT: 'SMALLINT',
		INT2: 'SMALLINT',
		TINYINT: 'TINYINT',
		INT1: 'TINYINT',
		DOUBLE: 'DOUBLE',
		FLOAT8: 'DOUBLE',
		FLOAT: 'REAL',
		FLOAT4: 'REAL',
		REAL: 'REAL',
		BOOLEAN: 'BOOLEAN',
		BOOL: 'BOOLEAN',
		DATE: 'DATE',
		TIMESTAMP: 'TIMESTAMP(6)',
		BLOB: 'VARBINARY',
		DECIMAL: 'DECIMAL(38,18)',
		NUMERIC: 'DECIMAL(38,18)'
	};
	return map[t] ?? 'VARCHAR';
}

function serializeTrinoValue(value: unknown): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
	if (typeof value === 'number') return isFinite(value) ? String(value) : 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

async function uploadTrinoTable(
	connection: Exclude<Connection, DuckDBWASMConnection>,
	orgId: string | undefined | null,
	targetSchema: string,
	targetName: string,
	columns: { name: string; type: string }[],
	rows: unknown[][],
	mode: 'replace' | 'append'
): Promise<{ rowsInserted: number }> {
	const catalogName = connection.catalogName;
	const ident = quoteTrinoPath(catalogName, targetSchema, targetName);
	const colDefs = columns
		.map((c) => `${quoteTrinoIdent(c.name)} ${duckdbTypeToTrino(c.type)}`)
		.join(', ');
	const colNames = columns.map((c) => quoteTrinoIdent(c.name)).join(', ');
	const trinoOpts = trinoOptsForConnection(connection, orgId);

	if (mode === 'replace') {
		await trinoExec(`DROP TABLE IF EXISTS ${ident}`, catalogName, targetSchema, trinoOpts);
		await trinoExec(`CREATE TABLE ${ident} (${colDefs})`, catalogName, targetSchema, trinoOpts);
	}

	const BATCH = 500;
	for (let i = 0; i < rows.length; i += BATCH) {
		const batch = rows.slice(i, i + BATCH);
		const valueRows = batch
			.map((row) => `(${row.map(serializeTrinoValue).join(', ')})`)
			.join(',\n');
		await trinoExec(
			`INSERT INTO ${ident} (${colNames}) VALUES\n${valueRows}`,
			catalogName,
			targetSchema,
			trinoOpts
		);
	}

	return { rowsInserted: rows.length };
}

export async function uploadToExternalConnection(
	connection: Connection,
	secret: ConnectionSecret | undefined,
	tableName: string,
	schema: string | undefined,
	columns: { name: string; type: string }[],
	rows: unknown[][],
	mode: 'replace' | 'append',
	orgId?: string | null
): Promise<{ rowsInserted: number }> {
	if (connection.type === 'duckdb-wasm') {
		throw new Error(`Connection type 'duckdb-wasm' is not supported for server-side upload.`);
	}

	const normalizedName = normalizeExternalRelationName(tableName);
	const trinoConnection = forTrino(connection, orgId) as ExternalConnection;
	const normalizedSchema = normalizeExternalSchemaName(schema ?? defaultSchema(trinoConnection));
	await ensureTenantTrinoAccess(orgId);

	try {
		return await uploadTrinoTable(
			trinoConnection,
			orgId,
			normalizedSchema,
			normalizedName,
			columns,
			rows,
			mode
		);
	} catch (err) {
		if (isCatalogNotFoundError(err)) {
			await registerCatalog(connection, secret, orgId);
			return uploadTrinoTable(
				trinoConnection,
				orgId,
				normalizedSchema,
				normalizedName,
				columns,
				rows,
				mode
			);
		}
		throw err;
	}
}

export async function materializeExternalConnection(
	connection: Connection,
	secret: ConnectionSecret | undefined,
	targetName: string,
	targetSchema: string | undefined,
	sql: string,
	mode: ExternalMaterializationMode,
	orgId?: string | null,
	availableConnections: Connection[] = [connection]
): Promise<{ name: string; type: ExternalRelationType }> {
	if (connection.type === 'duckdb-wasm') {
		throw new Error(`Connection type '${connection.type}' is not supported.`);
	}

	const trinoConnection = forTrino(connection, orgId) as ExternalConnection;
	const rewrittenSql = rewriteTenantCatalogReferences(sql, orgId, availableConnections);
	await ensureTenantTrinoAccess(orgId);
	const normalizedTargetName = normalizeExternalRelationName(targetName);
	const normalizedTargetSchema = normalizeExternalSchemaName(
		targetSchema ?? defaultSchema(trinoConnection)
	);

	try {
		return await materializeTrinoConnection(
			trinoConnection,
			orgId,
			normalizedTargetSchema,
			normalizedTargetName,
			rewrittenSql,
			mode
		);
	} catch (err) {
		if (isCatalogNotFoundError(err)) {
			await registerCatalog(connection, secret, orgId);
			return materializeTrinoConnection(
				trinoConnection,
				orgId,
				normalizedTargetSchema,
				normalizedTargetName,
				rewrittenSql,
				mode
			);
		}
		throw err;
	}
}
